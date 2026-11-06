import { randomUUID } from 'node:crypto';
import { checkFailureText, checkPassed } from '../../../shared/bots/taskCheck';
import { TRANSCRIPT_LABELS } from '../../../shared/bots/transcript';
import type { ProjectedMessage } from '../../../shared/types/agent';
import {
  type BotChat,
  type Delegation,
  GROUP_TASK_BLOCKED_STREAK_MAX,
  GROUP_TASK_RUNS_MAX,
  GROUP_TASK_TEXT_MAX,
  GROUP_TASK_TITLE_MAX,
  type GroupProgressPhase,
  type GroupTask,
  type GroupTaskRun,
  type HumanEntryRefs,
  parseTaskCheck,
  stalledTaskRun,
  type TaskCheck,
  taskBlock,
} from '../../../shared/types/bot';
import type { BotEvent, BotSendResult } from '../../../shared/types/botIpc';
import type { BotStore } from './botStore';
import type { BotChatStore } from './chatStore';
import { delegationResultBody, isActiveDelegation } from './delegationBatch';
import type { GroupTaskStore } from './groupTaskStore';
import { previousRunsText } from './previousRuns';

/** 'human' = 人类（UI）；其余为成员 botId */
export type TaskActor = string;
export type TaskResult = { ok: true; task: GroupTask } | { ok: false; error: string };
export type TaskGate =
  | {
      ok: true;
      taskId: string;
      seq: number;
      check?: TaskCheck;
      /** 原执行人接着做：失败后重试 / 待验收时追加 / 缺信息卡住后答复 */
      trigger?: 'retry' | 'append' | 'reply';
      /** 目标成员在本任务上排队 / 执行中的那次执行：同发起会话并入，否则排成下一次 */
      active?: string;
      /** 目标成员在本任务的子会话（任务 × 成员），由委派服务判断能否续用 */
      session?: string;
      returnReason?: string;
    }
  | { ok: false; error: string };

interface Deps {
  store: GroupTaskStore;
  chats: BotChatStore;
  bots: BotStore;
  emit: (event: BotEvent) => void;
  /** 以人类身份在群里发消息（复用群路由） */
  send?: (chatId: string, text: string, refs?: HumanEntryRefs) => Promise<BotSendResult>;
  cancelDelegation?: (id: string) => void;
  /** 成员在该群当前会话的消息（complete 验收读最终工具结果） */
  sessionMessages?: (chatId: string, botId: string) => Promise<readonly ProjectedMessage[]>;
  /** 委派记录（旧任务没有 runs / sessions 时只读派生） */
  delegations?: () => readonly Delegation[];
  /** 退回返工：在原执行人的任务会话里新开一次执行 */
  rework?: (input: {
    chatId: string;
    delegationId: string;
    actor: TaskActor;
    reason: string;
  }) => { ok: true } | { ok: false; error: string };
  /** 人在任务卡回复缺信息卡住的任务：在原执行人的任务会话里新开一次执行 */
  reply?: (input: {
    chatId: string;
    delegationId: string;
    text: string;
  }) => { ok: true } | { ok: false; error: string };
  /** 人在任务卡回复执行中的任务：插入当前执行 */
  interject?: (input: {
    delegationId: string;
    text: string;
    deliveryId?: string;
  }) => Promise<{ ok: true } | { ok: false; error: string }>;
  now?: () => number;
  /** 开工进度延后多久写（测试用），缺省 60 秒 */
  progressDelayMs?: number;
}

export const GROUP_TASK_ACTIONS = [
  'list',
  'add',
  'claim',
  'update',
  'complete',
  'cancel',
  'accept',
  'reject',
] as const;

const short = (text: string, max = 80) => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
};
const label = (task: GroupTask) => `#${task.seq} ${task.title}`;
const progressId = (delegationId: string, phase: GroupProgressPhase) =>
  `progress:${delegationId}:${phase}`;
const pending = (check: TaskCheck | undefined) =>
  check ? { check: { kind: check.kind, text: check.text } } : {};
/** 进入 done 时清掉上次退回原因 */
const settled = ({ returnReason: _reason, ...task }: GroupTask): GroupTask => task;
/** 离开卡住：清掉原因（连续次数保留） */
const unblocked = ({ blockedReason: _r, blockedNeed: _n, ...task }: GroupTask): GroupTask => task;
/** 人直接完成 / 取消：卡住原因与连续次数一并清掉 */
const cleared = ({ blockedStreak: _s, ...task }: GroupTask): GroupTask => unblocked(task);
/** 交付：该成员的连续卡住次数清零 */
function streakCleared(task: GroupTask, botId: string): GroupTask {
  const { blockedStreak, ...rest } = task;
  const { [botId]: _cleared, ...others } = blockedStreak ?? {};
  return Object.keys(others).length ? { ...rest, blockedStreak: others } : rest;
}
const FAILURE_TEXT: Record<NonNullable<Delegation['failure']>, string> = {
  timeout: '超时',
  interrupted: '中断',
  denied: '被拒',
  error: '出错',
  check: '验收未通过',
};
/** 执行跑满这么久还没结束才在群里发「开工」，短执行只发交付 */
const PROGRESS_STARTED_DELAY_MS = 60_000;
const PROGRESS_RESULT_MAX = 120;
/** 续跑类执行的开工写「接着做」；重试、追加不发开工 */
const CONTINUED: ReadonlySet<string> = new Set(['reply', 'rework']);
const SILENT_START: ReadonlySet<string> = new Set(['retry', 'append']);
const CHECK_INVALID = 'check must be { kind: "output-contains", text } with 1-200 characters.';
const AUTO_TITLE_MAX = 60;

function runOf(record: Delegation): GroupTaskRun {
  return {
    id: record.id,
    botId: record.targetBotId,
    trigger: record.trigger ?? 'delegate',
    state: record.state,
    ...(record.failure ? { failure: record.failure } : {}),
    createdAt: record.createdAt,
    ...(record.startedAt !== undefined ? { startedAt: record.startedAt } : {}),
    ...(record.finishedAt !== undefined ? { finishedAt: record.finishedAt } : {}),
    ...(record.depth > 1 ? { nested: true as const } : {}),
    ...(record.appends?.length ? { appends: record.appends.length } : {}),
  };
}

function sameRun(a: GroupTaskRun, b: GroupTaskRun): boolean {
  const left: Record<string, unknown> = { ...a };
  const right: Record<string, unknown> = { ...b };
  return [...new Set([...Object.keys(left), ...Object.keys(right)])].every(
    (key) => left[key] === right[key]
  );
}

/**
 * 委派 → 任务状态机（纯函数）。返回 undefined 表示不变。
 * 创建：todo，或发起人自己认领中且无委派的任务、执行失败的任务、原执行人续做的待验收任务
 * → doing / 负责人 = 目标 / 记 delegationId；
 * 卡住的任务 → doing / 负责人 = 目标 / 记 delegationId；
 * 终态：仅当任务仍由这条委派负责（doing + 同 delegationId）——完成 → 带结果摘要，
 * 执行人即创建人直接 done，否则 review 待验收；缺信息 / 失败 → 卡住，保留负责人与委派
 * （缺信息计该成员连续次数，交付清零）；取消 → 退回 todo。
 */
export function taskAfterDelegation(
  task: GroupTask,
  record: Delegation,
  now: number
): GroupTask | undefined {
  if (record.taskId !== task.id) return undefined;
  if (isActiveDelegation(record)) {
    if (task.delegationId === record.id) return undefined;
    const free =
      (task.delegationId === undefined &&
        (task.status === 'todo' ||
          (task.status === 'doing' && task.assigneeBotId === record.parentBotId))) ||
      stalledTaskRun(task) !== undefined ||
      task.status === 'blocked' ||
      (task.status === 'review' &&
        task.assigneeBotId === record.targetBotId &&
        record.trigger !== undefined &&
        record.trigger !== 'delegate');
    if (!free) return undefined;
    return {
      ...unblocked(task),
      ...pending(task.check),
      status: 'doing',
      assigneeBotId: record.targetBotId,
      delegationId: record.id,
      updatedAt: now,
    };
  }
  if (task.status !== 'doing' || task.delegationId !== record.id) return undefined;
  const verdict =
    task.check && record.check?.passed !== undefined
      ? { check: { ...task.check, passed: record.check.passed } }
      : {};
  if (record.state === 'completed') {
    const result = delegationResultBody(record).trim().slice(0, GROUP_TASK_TEXT_MAX);
    const next = {
      ...streakCleared(task, record.targetBotId),
      ...verdict,
      ...(result ? { result } : {}),
      updatedAt: now,
    };
    return record.targetBotId === task.createdBy
      ? { ...settled(next), status: 'done' }
      : { ...next, status: 'review' };
  }
  if (record.state === 'blocked') {
    const streak = task.blockedStreak?.[record.targetBotId] ?? 0;
    return {
      ...task,
      status: 'blocked',
      blockedReason: 'need',
      ...(record.blocked ? { blockedNeed: record.blocked.need } : {}),
      blockedStreak: { ...task.blockedStreak, [record.targetBotId]: streak + 1 },
      updatedAt: now,
    };
  }
  if (record.state === 'failed') {
    return {
      ...unblocked(task),
      ...verdict,
      ...(record.failure === 'check' && record.error ? { result: record.error } : {}),
      status: 'blocked',
      blockedReason: 'failed',
      updatedAt: now,
    };
  }
  const { assigneeBotId: _assignee, delegationId: _delegation, ...rest } = task;
  return {
    ...rest,
    ...verdict,
    ...(record.failure === 'check' && record.error ? { result: record.error } : {}),
    status: 'todo',
    updatedAt: now,
  };
}

/** 群任务看板：成员工具、人类 UI 与委派联动共用；每次变更推 tasks 事件，关键变更写 system 时间线 */
export class GroupTaskService {
  /** 人在任务卡答复卡住的任务、新执行正在落盘：sync 把答复写进同一行 */
  private humanReply?: { taskId: string; text: string };
  /** 等着写开工进度的执行 */
  private readonly starting = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private readonly deps: Deps) {}

  list(chatId: string): GroupTask[] {
    if (!this.group(chatId)) return [];
    return this.deps.store.list(this.board(chatId)).map((task) => {
      if (task.runs) return task;
      const runs = this.derivedRuns(task.id);
      return runs.length ? { ...task, runs } : task;
    });
  }

  add(
    chatId: string,
    actor: TaskActor,
    input: { title: string; detail?: string; check?: TaskCheck }
  ): TaskResult {
    const denied = this.check(chatId, actor);
    if (denied) return denied;
    if (!input.title.trim()) return { ok: false, error: 'Title must not be empty.' };
    if (input.title.trim().length > GROUP_TASK_TITLE_MAX)
      return { ok: false, error: `Title must be at most ${GROUP_TASK_TITLE_MAX} characters.` };
    const check = input.check && parseTaskCheck(input.check);
    if (input.check && !check) return { ok: false, error: CHECK_INVALID };
    const task = this.deps.store.create(
      this.board(chatId),
      {
        title: input.title,
        ...(input.detail ? { detail: input.detail } : {}),
        ...pending(check),
        createdBy: actor,
      },
      this.now()
    );
    if (!task) return { ok: false, error: 'Task not saved.' };
    this.changed(chatId, `${this.name(actor)} 新建了任务 ${label(task)}`, actor);
    return { ok: true, task };
  }

  update(
    chatId: string,
    actor: TaskActor,
    ref: string,
    patch: { title?: string; detail?: string; check?: TaskCheck | null }
  ): TaskResult {
    const found = this.resolve(chatId, actor, ref);
    if (!found.ok) return found;
    const title = patch.title?.trim();
    if (patch.title !== undefined && (!title || title.length > GROUP_TASK_TITLE_MAX))
      return { ok: false, error: 'Title must be 1-200 characters.' };
    const check = patch.check ? parseTaskCheck(patch.check) : undefined;
    if (patch.check && !check) return { ok: false, error: CHECK_INVALID };
    if (patch.check !== undefined && actor !== 'human' && found.task.createdBy !== actor)
      return {
        ok: false,
        error: `Only the creator of task #${found.task.seq} can change its check.`,
      };
    const { detail: _detail, check: current, ...rest } = found.task;
    const detail = patch.detail === undefined ? found.task.detail : patch.detail.trim();
    return this.write(chatId, {
      ...rest,
      ...(title ? { title } : {}),
      ...(detail ? { detail: detail.slice(0, GROUP_TASK_TEXT_MAX) } : {}),
      ...(patch.check === undefined || (check && current?.text === check.text)
        ? current
          ? { check: current }
          : {}
        : pending(check)),
      updatedAt: this.now(),
    });
  }

  /** 同步「读-判-写」：Main 单线程，第二个认领必然看到第一个的结果 */
  claim(chatId: string, botId: string, ref: string): TaskResult {
    if (botId === 'human') return { ok: false, error: 'Only members can claim tasks.' };
    const found = this.resolve(chatId, botId, ref);
    if (!found.ok) return found;
    const task = found.task;
    if (task.status !== 'todo' || task.assigneeBotId) return { ok: false, error: busy(task, this) };
    const now = this.now();
    return this.write(
      chatId,
      {
        ...task,
        ...pending(task.check),
        status: 'doing',
        assigneeBotId: botId,
        claimedAt: now,
        updatedAt: now,
      },
      `${this.name(botId)} 认领了 ${label(task)}`,
      botId
    );
  }

  /** outputs：成员会话消息，带 check 的任务由成员完成时必须提供且通过 */
  complete(
    chatId: string,
    actor: TaskActor,
    ref: string,
    result?: string,
    outputs?: readonly ProjectedMessage[]
  ): TaskResult {
    const found = this.resolve(chatId, actor, ref);
    if (!found.ok) return found;
    const task = found.task;
    if (task.status === 'done' || task.status === 'canceled')
      return { ok: false, error: busy(task, this) };
    if (task.status === 'review' && actor !== 'human')
      return {
        ok: false,
        error: `Task #${task.seq} is awaiting review; only ${this.name(task.createdBy)} or a human can accept or reject it.`,
      };
    const text = result?.trim().slice(0, GROUP_TASK_TEXT_MAX);
    if (actor !== 'human') {
      if (task.delegationId)
        return {
          ok: false,
          error: `Task #${task.seq} is being handled by a delegation; it completes automatically when the delegation finishes.`,
        };
      if (task.status !== 'doing' || task.assigneeBotId !== actor)
        return {
          ok: false,
          error: task.assigneeBotId
            ? `Only the assignee (${this.name(task.assigneeBotId)}) can complete task #${task.seq}.`
            : `Claim task #${task.seq} before completing it.`,
        };
      if (!text) return { ok: false, error: 'Describe the result when completing a task.' };
      if (task.check && !(outputs && checkPassed(task.check, outputs, task.claimedAt ?? 0)))
        return {
          ok: false,
          error: `Acceptance check failed (${checkFailureText(task.check)}): none of your final tool outputs since claiming task #${task.seq} contains "${task.check.text}". Do the work so a tool output (e.g. a command) shows it, then complete again.`,
        };
    }
    const passed =
      actor !== 'human' && task.check ? { check: { ...task.check, passed: true } } : {};
    return this.linkedAfter(
      task,
      this.write(
        chatId,
        {
          ...cleared(settled(task)),
          ...passed,
          status: 'done',
          ...(text ? { result: text } : {}),
          updatedAt: this.now(),
        },
        `${this.name(actor)} 完成了 ${label(task)}${text ? `：${short(text)}` : ''}`,
        actor
      )
    );
  }

  /** 成员 complete：带 check 时先读其会话再同步判定（读期间状态变化由 complete 重新校验） */
  private async completeChecked(
    chatId: string,
    botId: string,
    ref: string,
    result?: string
  ): Promise<TaskResult> {
    let outputs: readonly ProjectedMessage[] | undefined;
    try {
      outputs = await this.deps.sessionMessages?.(chatId, botId);
    } catch (cause) {
      console.warn('[bots] task check read failed', cause);
    }
    return this.complete(chatId, botId, ref, result, outputs);
  }

  cancel(chatId: string, actor: TaskActor, ref: string): TaskResult {
    const found = this.resolve(chatId, actor, ref);
    if (!found.ok) return found;
    const task = found.task;
    if (task.status === 'done' || task.status === 'canceled')
      return { ok: false, error: busy(task, this) };
    if (task.status === 'review' && actor !== 'human' && !this.reviewer(task, actor))
      return {
        ok: false,
        error: `Only the task creator (${this.name(task.createdBy)}) or a human can cancel task #${task.seq} while it awaits review.`,
      };
    if (actor !== 'human' && task.delegationId && task.status === 'doing' && !stalledTaskRun(task))
      return {
        ok: false,
        error: `Task #${task.seq} is being handled by a delegation; the delegator can cancel it with check_delegation.`,
      };
    // 卡住的任务：执行人自己不能取消，创建人 / 委派人可以
    if (
      actor !== 'human' &&
      (task.status === 'blocked'
        ? task.createdBy !== actor && this.delegator(task) !== actor
        : task.createdBy !== actor && task.assigneeBotId !== actor)
    )
      return {
        ok: false,
        error:
          task.status === 'blocked'
            ? `Only the creator, the delegator or a human can cancel blocked task #${task.seq}.`
            : `Only the creator or the assignee can cancel task #${task.seq}.`,
      };
    return this.linkedAfter(
      task,
      this.write(
        chatId,
        { ...cleared(task), status: 'canceled', updatedAt: this.now() },
        `${this.name(actor)} 取消了 ${label(task)}`,
        actor
      )
    );
  }

  /** 验收通过：review → done */
  accept(chatId: string, actor: TaskActor, ref: string): TaskResult {
    const found = this.reviewing(chatId, actor, ref);
    if (!found.ok) return found;
    const task = found.task;
    return this.write(
      chatId,
      { ...settled(task), status: 'done', updatedAt: this.now() },
      `${this.name(actor)} 验收通过了 ${label(task)}`,
      actor
    );
  }

  /**
   * 验收退回：review → todo，清负责人与委派、记原因，可再认领 / 指派 / 委派；
   * rework：同一执行人在本任务会话里新开一次执行，带退回理由，交付后回到待验收
   */
  reject(
    chatId: string,
    actor: TaskActor,
    ref: string,
    reason: string,
    rework = false
  ): TaskResult {
    const found = this.reviewing(chatId, actor, ref);
    if (!found.ok) return found;
    const text = reason.trim().slice(0, GROUP_TASK_TEXT_MAX);
    if (!text) return { ok: false, error: 'Give a reason when rejecting a task.' };
    if (rework) return this.rework(chatId, actor, found.task, text);
    const {
      assigneeBotId: _assignee,
      delegationId: _delegation,
      claimedAt: _claimed,
      ...rest
    } = found.task;
    return this.write(
      chatId,
      { ...rest, status: 'todo', returnReason: text, updatedAt: this.now() },
      `${this.name(actor)} 退回了 ${label(found.task)}：${short(text)}`,
      actor
    );
  }

  private rework(chatId: string, actor: TaskActor, task: GroupTask, reason: string): TaskResult {
    if (!task.delegationId || !task.assigneeBotId)
      return {
        ok: false,
        error: `Task #${task.seq} was not delivered by a delegation; reject it without rework.`,
      };
    const sent = this.deps.rework?.({
      chatId,
      delegationId: task.delegationId,
      actor,
      reason,
    }) ?? { ok: false as const, error: 'Rework is unavailable.' };
    if (!sent.ok) return sent;
    const current = this.deps.store.find(this.board(chatId), task.id) ?? task;
    return this.write(
      chatId,
      { ...current, returnReason: reason, updatedAt: this.now() },
      `${this.name(actor)} 退回了 ${label(task)}，让 ${this.name(task.assigneeBotId)} 返工：${short(reason)}`,
      actor
    );
  }

  /** 验收人：人类或任务创建人（执行人除外） */
  private reviewer(task: GroupTask, actor: TaskActor): boolean {
    return actor === 'human' || (task.createdBy === actor && task.assigneeBotId !== actor);
  }

  private reviewing(chatId: string, actor: TaskActor, ref: string): TaskResult {
    const found = this.resolve(chatId, actor, ref);
    if (!found.ok) return found;
    const task = found.task;
    if (task.status !== 'review')
      return { ok: false, error: `Task #${task.seq} is not awaiting review.` };
    if (!this.reviewer(task, actor))
      return {
        ok: false,
        error: `Only the task creator (${this.name(task.createdBy)}) or a human can review task #${task.seq}.`,
      };
    return found;
  }

  /** 人类指派：置 doing / 负责人，再以人类身份 @ 成员；投递失败回滚 */
  async assign(chatId: string, ref: string, botId: string): Promise<TaskResult> {
    const found = this.resolve(chatId, 'human', ref);
    if (!found.ok) return found;
    const task = found.task;
    const chat = this.group(chatId);
    const bot = this.deps.bots.get(botId);
    if (!chat?.members.includes(botId) || !bot || bot.archivedAt !== undefined)
      return { ok: false, error: 'Member unavailable.' };
    const stalled = stalledTaskRun(task) !== undefined;
    if (
      task.status === 'done' ||
      task.status === 'canceled' ||
      (task.delegationId && !stalled && task.status !== 'blocked')
    )
      return { ok: false, error: busy(task, this) };
    const { delegationId: _delegation, ...free } = unblocked(task);
    const now = this.now();
    const written = this.write(chatId, {
      ...free,
      ...pending(task.check),
      status: 'doing',
      assigneeBotId: botId,
      claimedAt: now,
      updatedAt: now,
    });
    if (!written.ok) return written;
    const sent = this.deps.send
      ? await this.deps.send(
          this.timeline(chatId),
          `@${bot.name} 请处理任务 #${task.seq}：${task.title}`,
          // 改派：新成员这一轮附上之前的执行与退回理由（不进群时间线正文）
          { task: task.id }
        )
      : { ok: false as const, error: 'group-not-ready' };
    if (sent.ok) return written;
    const current = this.deps.store.find(this.board(chatId), task.id);
    if (current?.updatedAt === written.task.updatedAt && current.assigneeBotId === botId)
      this.write(chatId, { ...task, updatedAt: this.now() });
    return { ok: false, error: sent.error };
  }

  /**
   * 任务卡回复框（人）：缺信息卡住 → 原执行人在任务会话里接着做；执行中 → 插入当前执行；
   * 执行失败只能重试 / 改派 / 取消；其他状态只记评论
   */
  async reply(
    chatId: string,
    ref: string,
    input: string,
    options?: { deliveryId: string }
  ): Promise<TaskResult> {
    const found = this.resolve(chatId, 'human', ref);
    if (!found.ok) return found;
    const task = found.task;
    const text = input.trim().slice(0, GROUP_TASK_TEXT_MAX);
    if (!text) return { ok: false, error: 'Reply must not be empty.' };
    const block = task.status === 'blocked' ? (task.blockedReason ?? 'failed') : undefined;
    if (block === 'failed' || stalledTaskRun(task))
      return { ok: false, error: `Task #${task.seq} failed to run; retry, reassign or cancel it.` };
    const current =
      task.status === 'doing' && task.delegationId
        ? this.deps.delegations?.().find((record) => record.id === task.delegationId)
        : undefined;
    const running = current && isActiveDelegation(current) ? current : undefined;
    const line = `${this.name('human')} ${block || running ? '回复了' : '评论了'} ${label(task)}：${short(text)}`;
    if (block === 'need' && task.delegationId) {
      // 新执行落盘时 sync 写「用户 回复了 …，X 接着做」一行；没成就什么都不写
      if (!options) this.humanReply = { taskId: task.id, text };
      let sent: { ok: true } | { ok: false; error: string };
      try {
        sent = this.deps.reply?.({ chatId, delegationId: task.delegationId, text }) ?? {
          ok: false,
          error: 'Reply is unavailable.',
        };
      } finally {
        this.humanReply = undefined;
      }
      if (!sent.ok) return sent;
    } else if (running) {
      const sent = (await this.deps.interject?.({
        delegationId: running.id,
        text,
        ...(options ? { deliveryId: options.deliveryId } : {}),
      })) ?? {
        ok: false as const,
        error: 'Reply is unavailable.',
      };
      if (!sent.ok) return sent;
      if (!options) this.changed(chatId, line);
    } else this.changed(chatId, line);
    return { ok: true, task: this.deps.store.find(this.board(chatId), task.id) ?? task };
  }

  remove(chatId: string, ref: string): { ok: true } | { ok: false; error: string } {
    const found = this.resolve(chatId, 'human', ref);
    if (!found.ok) return found;
    if (!this.deps.store.remove(this.board(chatId), found.task.id))
      return { ok: false, error: 'not-found' };
    this.cancelLinked(found.task);
    this.deps.emit({ kind: 'tasks', chatId: this.board(chatId) });
    return { ok: true };
  }

  /** 群里没给 taskId 的委派：静默建卡，标题取首个非空行，不调模型 */
  open(
    chatId: string,
    botId: string,
    text: string,
    check?: TaskCheck
  ): { taskId: string; seq: number } | undefined {
    if (!this.group(chatId)) return undefined;
    const line = text.split('\n').find((item) => item.trim()) ?? '';
    const title = Array.from(line.trim()).slice(0, AUTO_TITLE_MAX).join('');
    const task = this.deps.store.create(
      this.board(chatId),
      { title, detail: text, ...pending(check), createdBy: botId },
      this.now()
    );
    return task && { taskId: task.id, seq: task.seq };
  }

  /** 任务的历次执行（深度 1）与退回理由，拼成 <previous-runs>；没有就空串 */
  previousRuns(chatId: string, taskId: string): string {
    const task = this.group(chatId) && this.deps.store.find(this.board(chatId), taskId);
    if (!task) return '';
    const runs = (this.deps.delegations?.() ?? [])
      .filter((record) => record.taskId === task.id && record.depth === 1)
      .sort((a, b) => a.createdAt - b.createdAt);
    const text = previousRunsText(runs, {
      name: (id) => this.name(id),
      ...(task.returnReason ? { returnReason: task.returnReason } : {}),
    });
    return text && `Earlier runs of task #${task.seq}:\n${text}`;
  }

  /** 撤销 open 建的卡（委派最终被拒） */
  discard(chatId: string, taskId: string): void {
    this.deps.store.remove(this.board(chatId), taskId);
  }

  /**
   * 委派带 taskId 前的校验：返回规范 taskId。目标是原执行人且任务卡住 / 待验收时续做（trigger）；
   * 卡住的任务可由创建人或委派人改派他人。缺信息连续卡住满次数后只有人（human）能答复。
   * 会话只按本群看板里的任务真实 id + 成员推导。
   */
  gate(
    chatId: string | null,
    ref: string,
    parentBotId: string,
    targetBotId?: string,
    human = false
  ): TaskGate {
    if (!chatId || !this.group(chatId))
      return { ok: false, error: 'Tasks are only available in group chats.' };
    const task = this.deps.store.find(this.board(chatId), ref);
    if (!task)
      return {
        ok: false,
        error: `Task ${ref.startsWith('#') ? ref : `#${ref}`} not found in this group.`,
      };
    const session = targetBotId ? this.sessionOf(task, targetBotId) : undefined;
    const pass = (trigger?: 'retry' | 'append' | 'reply', active?: string): TaskGate => ({
      ok: true,
      taskId: task.id,
      seq: task.seq,
      ...pending(task.check),
      ...(trigger ? { trigger } : {}),
      ...(active ? { active } : {}),
      ...(session ? { session } : {}),
      ...(task.returnReason ? { returnReason: task.returnReason } : {}),
    });
    if (
      !task.delegationId &&
      (task.status === 'todo' || (task.status === 'doing' && task.assigneeBotId === parentBotId))
    )
      return pass();
    const owner = parentBotId === task.createdBy || parentBotId === this.delegator(task);
    if (owner && targetBotId) {
      if (task.status === 'blocked' && task.blockedReason === 'need') {
        if (targetBotId !== task.assigneeBotId) return pass();
        if (!human && (task.blockedStreak?.[targetBotId] ?? 0) >= GROUP_TASK_BLOCKED_STREAK_MAX)
          return {
            ok: false,
            error: `Task #${task.seq} has been blocked ${GROUP_TASK_BLOCKED_STREAK_MAX} times in a row on ${this.name(targetBotId)}; only a human can answer it now. Ask the human in the group.`,
          };
        return pass('reply');
      }
      if (stalledTaskRun(task))
        return pass(targetBotId === task.assigneeBotId ? 'retry' : undefined);
      if (task.status === 'review' && targetBotId === task.assigneeBotId) return pass('append');
      const current = task.delegationId
        ? this.deps.delegations?.().find((record) => record.id === task.delegationId)
        : undefined;
      if (
        task.status === 'doing' &&
        current &&
        isActiveDelegation(current) &&
        current.targetBotId === targetBotId
      )
        return pass('append', current.id);
    }
    return { ok: false, error: busy(task, this) };
  }

  /** 任务 × 成员的子会话；旧任务没有 sessions 时取该成员在本任务最近一次执行的 */
  private sessionOf(task: GroupTask, botId: string): string | undefined {
    return (
      task.sessions?.[botId] ??
      (this.deps.delegations?.() ?? [])
        .filter(
          (record) =>
            record.taskId === task.id && record.targetBotId === botId && record.depth === 1
        )
        .sort((a, b) => a.createdAt - b.createdAt)
        .at(-1)?.childConversationId
    );
  }

  private delegator(task: GroupTask): string | undefined {
    return task.delegationId
      ? this.deps.delegations?.().find((record) => record.id === task.delegationId)?.parentBotId
      : undefined;
  }

  /** 委派记录每次落盘后调用：按状态机同步任务并记执行摘要；nestedIn 为嵌套执行所属的上层任务 */
  sync(record: Delegation, nestedIn?: string): void {
    const taskId = record.taskId ?? nestedIn;
    if (!taskId || !record.chatId || !this.group(record.chatId)) return;
    const task = this.deps.store.find(this.board(record.chatId), taskId);
    if (!task) return;
    const now = this.now();
    const linked = record.taskId ? taskAfterDelegation(task, record, now) : undefined;
    const tracked = this.tracked(linked ?? task, record);
    if (!linked) {
      if (tracked) this.write(record.chatId, { ...tracked, updatedAt: now });
      if (!record.taskId) {
        // 深度 2 嵌套执行只公开卡住
        if (record.state === 'blocked') this.progress(record, task, 'blocked');
      } else if (task.delegationId === record.id) this.scheduleStarted(record);
      return;
    }
    const next = tracked ?? linked;
    const target = this.name(record.targetBotId);
    const parent = this.name(record.parentBotId);
    // 开工 / 卡住 / 交付由 progress 条目公开，这里只留发起方动作与退回待办
    const text = isActiveDelegation(record)
      ? record.trigger === 'retry'
        ? `${parent} 让 ${target} 重试 ${label(task)}`
        : record.trigger === 'append'
          ? `${parent} 给 ${label(task)} 追加了要求，${target} 接着做`
          : record.trigger === 'reply' && this.humanReply?.taskId === task.id
            ? `${this.name('human')} 回复了 ${label(task)}：${short(this.humanReply.text)}`
            : undefined
      : next.status === 'todo'
        ? `${label(task)} 的委派未完成，已退回待办`
        : undefined;
    this.write(record.chatId, next, text, record.parentBotId);
    if (isActiveDelegation(record)) this.scheduleStarted(record);
    else {
      this.clearStarted(record.id);
      if (next.status === 'blocked') this.progress(record, next, 'blocked');
      else if (next.status === 'review' || next.status === 'done')
        this.progress(record, next, 'delivered');
    }
  }

  /** 开工进度：执行开工满 60 秒仍未结束、任务仍由它负责才写；排队、重试、追加、嵌套不写 */
  private scheduleStarted(record: Delegation): void {
    if (
      record.state !== 'running' ||
      record.depth !== 1 ||
      !record.chatId ||
      SILENT_START.has(record.trigger ?? 'delegate') ||
      this.starting.has(record.id) ||
      this.deps.chats.hasEntry(record.chatId, progressId(record.id, 'started'))
    )
      return;
    const delay =
      (record.startedAt ?? this.now()) +
      (this.deps.progressDelayMs ?? PROGRESS_STARTED_DELAY_MS) -
      this.now();
    const timer = setTimeout(
      () => {
        this.starting.delete(record.id);
        const current = this.deps.delegations?.().find((item) => item.id === record.id);
        if (current?.state !== 'running' || !current.taskId || !current.chatId) return;
        if (!this.group(current.chatId)) return;
        const task = this.deps.store.find(this.board(current.chatId), current.taskId);
        if (task?.delegationId === current.id) this.progress(current, task, 'started');
      },
      Math.max(0, delay)
    );
    timer.unref?.();
    this.starting.set(record.id, timer);
  }

  private clearStarted(id: string): void {
    clearTimeout(this.starting.get(id));
    this.starting.delete(id);
  }

  /** 以执行人名义写进发起委派的话题；同一执行同一阶段只写一次 */
  private progress(record: Delegation, task: GroupTask, phase: GroupProgressPhase): void {
    const chatId = record.chatId;
    const id = progressId(record.id, phase);
    if (!chatId || this.deps.chats.hasEntry(chatId, id)) return;
    const entry = this.deps.chats.appendEntry(chatId, {
      kind: 'progress',
      id,
      at: this.now(),
      botId: record.targetBotId,
      taskId: task.id,
      taskSeq: task.seq,
      delegationId: record.id,
      phase,
      text: this.progressText(record, task, phase),
    });
    if (entry) this.deps.emit({ kind: 'timeline', chatId, seq: entry.seq });
  }

  private progressText(record: Delegation, task: GroupTask, phase: GroupProgressPhase): string {
    const seq = task.seq;
    if (phase === 'started')
      return CONTINUED.has(record.trigger ?? 'delegate')
        ? `接着做 #${seq}`
        : `开工 #${seq}『${task.title}』`;
    if (phase === 'blocked') {
      if (record.state !== 'blocked')
        return `#${seq} 执行失败：${FAILURE_TEXT[record.failure ?? 'error']}`;
      const waiting = record.blocked?.waitFor === 'human' ? 'human' : record.parentBotId;
      return `#${seq} 卡住了，缺：${short(record.blocked?.need ?? '', 300)} @${this.name(waiting)}`;
    }
    const line =
      (record.result ?? '')
        .split('\n')
        .map((item) => item.trim())
        .find(Boolean) ?? '';
    return line ? `交付 #${seq}：${short(line, PROGRESS_RESULT_MAX)}` : `交付 #${seq}`;
  }

  /** 把执行写进 runs，深度 1 的记执行人子会话；没变化返回 undefined */
  private tracked(task: GroupTask, record: Delegation): GroupTask | undefined {
    const run = runOf(record);
    const runs = task.runs ?? this.derivedRuns(task.id);
    const index = runs.findIndex((item) => item.id === run.id);
    const runChanged = index < 0 || !sameRun(runs[index], run);
    const session =
      record.taskId &&
      record.depth === 1 &&
      task.sessions?.[record.targetBotId] !== record.childConversationId;
    if (!runChanged && !session) return undefined;
    const nextRuns =
      index < 0 ? [...runs, run] : runs.map((item, at) => (at === index ? run : item));
    return {
      ...task,
      runs: nextRuns.slice(-GROUP_TASK_RUNS_MAX),
      ...(session
        ? { sessions: { ...task.sessions, [record.targetBotId]: record.childConversationId } }
        : {}),
    };
  }

  /** 旧任务：按 taskId 从现存委派记录派生（只读） */
  private derivedRuns(taskId: string): GroupTaskRun[] {
    return (this.deps.delegations?.() ?? [])
      .filter((record) => record.taskId === taskId)
      .sort((a, b) => a.createdAt - b.createdAt)
      .slice(-GROUP_TASK_RUNS_MAX)
      .map(runOf);
  }

  /** 成员离开某群 / 被删除：其认领中的任务退回 todo */
  releaseMember(chatId: string, botId: string): void {
    if (!this.deps.chats.get(chatId)) return;
    for (const task of this.deps.store.list(this.board(chatId))) {
      if ((task.status !== 'doing' && task.status !== 'blocked') || task.assigneeBotId !== botId)
        continue;
      const {
        assigneeBotId: _assignee,
        delegationId: _delegation,
        claimedAt: _claimed,
        ...rest
      } = unblocked(task);
      this.linkedAfter(
        task,
        this.write(
          chatId,
          { ...rest, status: 'todo', updatedAt: this.now() },
          `${label(task)} 的负责人已离开，退回待办`
        )
      );
    }
  }

  releaseBot(botId: string): void {
    for (const chat of this.deps.chats.list())
      if (chat.kind === 'group' && !chat.parentId) this.releaseMember(chat.id, botId);
  }

  forget(chatId: string): void {
    this.deps.store.forget(this.board(chatId));
  }

  /** group_tasks 工具入口；参数已在 worker 侧归一化，这里仍按 unknown 收窄；带 check 的 complete 异步 */
  tool(chatId: string, botId: string, params: Record<string, unknown>): unknown {
    const text = (key: string) =>
      typeof params[key] === 'string' ? (params[key] as string) : undefined;
    const id = text('id');
    const needId = (run: (ref: string) => TaskResult): unknown =>
      id ? this.view(run(id)) : { ok: false, error: `Specify id for action ${params.action}.` };
    const check = params.check === undefined ? undefined : parseTaskCheck(params.check);
    if (params.check !== undefined && !check) return { ok: false, error: CHECK_INVALID };
    switch (params.action) {
      case 'list': {
        const denied = this.check(chatId, botId);
        if (denied) return denied;
        const tasks = this.deps.store
          .list(this.board(chatId))
          .filter((task) => task.status !== 'canceled');
        return { ok: true, tasks: tasks.map((task) => this.brief(task)) };
      }
      case 'add': {
        const title = text('title');
        if (!title) return { ok: false, error: 'Specify title for action add.' };
        const detail = text('detail');
        return this.view(
          this.add(chatId, botId, {
            title,
            ...(detail ? { detail } : {}),
            ...(check ? { check } : {}),
          })
        );
      }
      case 'claim':
        return needId((ref) => this.claim(chatId, botId, ref));
      case 'update': {
        const title = text('title');
        const detail = text('detail');
        if (title === undefined && detail === undefined && !check)
          return { ok: false, error: 'Specify title, detail or check for action update.' };
        return needId((ref) =>
          this.update(chatId, botId, ref, {
            ...(title !== undefined ? { title } : {}),
            ...(detail !== undefined ? { detail } : {}),
            ...(check ? { check } : {}),
          })
        );
      }
      case 'complete': {
        const task = id ? this.deps.store.find(this.board(chatId), id) : undefined;
        if (id && task?.check && task.assigneeBotId === botId && !task.delegationId)
          return this.completeChecked(chatId, botId, id, text('result')).then((result) =>
            this.view(result)
          );
        return needId((ref) => this.complete(chatId, botId, ref, text('result')));
      }
      case 'cancel':
        return needId((ref) => this.cancel(chatId, botId, ref));
      case 'accept':
        return needId((ref) => this.accept(chatId, botId, ref));
      case 'reject':
        return needId((ref) =>
          this.reject(chatId, botId, ref, text('reason') ?? '', params.rework === true)
        );
      default:
        return {
          ok: false,
          error: `Unknown action. Use one of: ${GROUP_TASK_ACTIONS.join(', ')}.`,
        };
    }
  }

  name(actor: TaskActor): string {
    if (actor === 'human') return TRANSCRIPT_LABELS.human;
    return this.deps.bots.get(actor)?.name ?? TRANSCRIPT_LABELS.deleted;
  }

  private brief(task: GroupTask) {
    const block = taskBlock(task);
    return {
      id: `#${task.seq}`,
      title: task.title,
      status: task.status,
      ...(block ? { blockedReason: block.reason } : {}),
      ...(block?.reason === 'need' ? { need: block.need } : {}),
      ...(task.detail ? { detail: task.detail } : {}),
      ...(task.assigneeBotId ? { assignee: this.name(task.assigneeBotId) } : {}),
      createdBy: this.name(task.createdBy),
      ...(task.result ? { result: task.result } : {}),
      ...(task.returnReason ? { returnReason: task.returnReason } : {}),
      ...(block?.reason === 'failed' ? { failure: block.failure } : {}),
      ...(task.check ? { check: task.check.text } : {}),
      ...(task.check?.passed !== undefined ? { checkPassed: task.check.passed } : {}),
    };
  }

  private view(result: TaskResult): unknown {
    return result.ok ? { ok: true, task: this.brief(result.task) } : result;
  }

  private group(chatId: string): BotChat | undefined {
    const chat = this.deps.chats.rootOf(chatId);
    return chat?.kind === 'group' ? chat : undefined;
  }

  /** 看板按根群存放，话题共用 */
  private board(chatId: string): string {
    return this.deps.chats.rootOf(chatId)?.id ?? chatId;
  }

  /** 人类 / 系统的看板动态写进根群当前话题；指定话题时写该话题 */
  private timeline(chatId: string): string {
    if (this.deps.chats.get(chatId)?.parentId) return chatId;
    return this.deps.chats.activeThread(chatId)?.id ?? chatId;
  }

  /** 群存在且未归档；成员动作要求仍在群里且未归档 */
  private check(chatId: string, actor: TaskActor): { ok: false; error: string } | undefined {
    const chat = this.group(chatId);
    if (!chat) return { ok: false, error: 'Tasks are only available in group chats.' };
    if (chat.archivedAt !== undefined) return { ok: false, error: 'This group is archived.' };
    if (actor === 'human') return undefined;
    const bot = this.deps.bots.get(actor);
    if (!bot || bot.archivedAt !== undefined || !chat.members.includes(actor))
      return { ok: false, error: 'You are not a member of this group.' };
    return undefined;
  }

  private resolve(chatId: string, actor: TaskActor, ref: string): TaskResult {
    const denied = this.check(chatId, actor);
    if (denied) return denied;
    const task = this.deps.store.find(this.board(chatId), ref);
    return task
      ? { ok: true, task }
      : {
          ok: false,
          error: `Task ${ref.startsWith('#') ? ref : `#${ref}`} not found in this group.`,
        };
  }

  /** 先落新状态再取消关联委派：委派终态同步时任务已不归它负责，不会二次改写 */
  private linkedAfter(previous: GroupTask, result: TaskResult): TaskResult {
    if (result.ok) this.cancelLinked(previous);
    return result;
  }

  private cancelLinked(task: GroupTask): void {
    if (task.delegationId && task.status === 'doing')
      this.deps.cancelDelegation?.(task.delegationId);
  }

  /** actor 为成员时动态写进其所在话题 */
  private write(
    chatId: string,
    task: GroupTask,
    systemText?: string,
    actor: TaskActor = 'human'
  ): TaskResult {
    const saved = this.deps.store.save(this.board(chatId), task);
    if (!saved) return { ok: false, error: 'Task not saved.' };
    this.changed(chatId, systemText, actor);
    return { ok: true, task: saved };
  }

  private changed(chatId: string, systemText?: string, actor: TaskActor = 'human'): void {
    if (systemText) {
      const target = actor === 'human' ? this.timeline(chatId) : chatId;
      const entry = this.deps.chats.appendEntry(target, {
        kind: 'system',
        id: randomUUID(),
        at: this.now(),
        text: systemText,
      });
      if (entry) this.deps.emit({ kind: 'timeline', chatId: target, seq: entry.seq });
    }
    this.deps.emit({ kind: 'tasks', chatId: this.board(chatId) });
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }
}

function busy(task: GroupTask, service: GroupTaskService): string {
  if (task.status === 'done') return `Task #${task.seq} is already done.`;
  if (task.status === 'canceled') return `Task #${task.seq} was canceled.`;
  if (task.status === 'review')
    return `Task #${task.seq} is awaiting review by ${service.name(task.createdBy)}.`;
  if (task.status === 'blocked')
    return `Task #${task.seq} is blocked on ${service.name(task.assigneeBotId ?? '')}; only its creator, its delegator or a human can unblock, reassign or cancel it.`;
  if (task.delegationId)
    return `Task #${task.seq} is already delegated to ${service.name(task.assigneeBotId ?? '')}.`;
  return `Task #${task.seq} is already claimed by ${service.name(task.assigneeBotId ?? '')}.`;
}
