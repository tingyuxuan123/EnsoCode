import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { checkFailureText, checkPassed } from '../../../shared/bots/taskCheck';
import type { ProjectedMessage } from '../../../shared/types/agent';
import {
  type BotPermissions,
  botNameKey,
  DELEGATION_APPENDS_MAX,
  DELEGATION_BLOCKED_NEED_MAX,
  DELEGATION_BLOCKED_STOP_MINUTES,
  DELEGATION_TIMEOUT_MINUTES,
  type Delegation,
  type DelegationTrigger,
  type TaskCheck,
} from '../../../shared/types/bot';
import type { BotEvent, BotSendResult } from '../../../shared/types/botIpc';
import { BOT_BUDGET_ERROR } from '../../../shared/usage/botUsage';
import {
  BOT_BLOCKED_STOP,
  type BotAuthorityPort,
  type BotDeliverResult,
  type BotSessionHost,
  type BotTurnFinished,
} from './botSessionHost';
import type { BotStore } from './botStore';
import type { BotChatStore } from './chatStore';
import {
  isActiveDelegation as active,
  batchDeliveryId,
  batchResultText,
  batchWaitingNotice,
  delegationBatches,
  delegationResultBody,
  escapeXml,
  TASK_FOLLOWUP_PREFIX,
} from './delegationBatch';
import { delegatedBotPermissions, delegationPolicy } from './delegationPolicy';
import type { DelegationStore } from './delegationStore';
import type { TaskGate } from './groupTasks';
import { previousRunsText } from './previousRuns';
import { rewoundDelegations } from './rewind';

interface Deps {
  bots: BotStore;
  chats: BotChatStore;
  authority: BotAuthorityPort;
  host: BotSessionHost;
  store: DelegationStore;
  emit: (event: BotEvent) => void;
  /** 一分钟的毫秒数，测试用来压缩时限 */
  minuteMs?: number;
  /** 群任务看板联动：taskId 校验、自动建卡与每次落盘后的状态同步 */
  tasks?: {
    gate(
      chatId: string | null,
      ref: string,
      parentBotId: string,
      targetBotId?: string,
      human?: boolean
    ): TaskGate;
    open(
      chatId: string,
      botId: string,
      text: string,
      check?: TaskCheck
    ): { taskId: string; seq: number } | undefined;
    discard(chatId: string, taskId: string): void;
    sync(record: Delegation, nestedIn?: string): void;
  };
  /** 子会话当前分支消息（验收读最终工具结果） */
  sessionMessages?: (conversationId: string) => Promise<readonly ProjectedMessage[]>;
  deliverGroupResult?: (
    record: Delegation,
    text: string,
    deliveryId: string
  ) => Promise<BotSendResult>;
}
export interface DelegateInput {
  to: string;
  task: string;
  context?: string;
  /** 看板任务（#N 或 id）；委派创建 / 终态同步任务状态 */
  taskId?: string;
  /** 期望时限（分钟），不超过目标成员的委派时限 */
  deadlineMinutes?: number;
  /** 父回合被停止 / 中断后仍继续 */
  keep?: boolean;
  /** 验收条件；不传时沿用关联看板任务的 */
  check?: TaskCheck;
}
/** 追加回执：accepted = 已进模型；deferred = 改排在本次执行的下一回合（或 10 秒内没回执）；failed = 没送达 */
export type AppendDelivery = 'accepted' | 'deferred' | 'failed';
export type DelegateResult =
  | {
      ok: true;
      delegationId: string;
      taskId?: string;
      /** 并入了同一发起会话在本任务上排队 / 执行中的那次执行 */
      merged?: true;
      delivery?: AppendDelivery;
      warning?: string;
    }
  | { ok: false; error: string };
export type DelegationRetryMode = 'resume' | 'restart';

/** 续跑没成但会话本身没坏：照常记失败，不退回从头 */
const RESUME_TRANSIENT = new Set(['session-busy', 'disabled', BOT_BUDGET_ERROR]);

interface Resume {
  conversationId: string;
  /** 验收没过：在原会话补一条未通过原因，而不是从最后一步续跑 */
  checkFailed: boolean;
}

/** 投递任务时的看板信息：#N、是否接着原会话、改派时带的退回理由 */
interface TaskInfo {
  seq?: number;
  incremental?: boolean;
  returnReason?: string;
}

const RECEIPT_MS = 10_000;

interface TurnOutcome {
  ok: boolean;
  text: string;
  error?: string;
}

/** 执行结束时还没跑完的追加一律记失败 */
const closeAppends = (record: Delegation): Pick<Delegation, 'appends'> =>
  record.appends?.some((item) => item.ok === undefined)
    ? {
        appends: record.appends.map((item) =>
          item.ok === undefined ? { ...item, ok: false } : item
        ),
      }
    : {};

const appendId = (recordId: string, input: Pick<DelegateInput, 'task' | 'context'>) =>
  `append:${recordId}:${createHash('sha256')
    .update(`${input.task}\0${input.context ?? ''}`)
    .digest('hex')
    .slice(0, 16)}`;

const samePermissions = (a: BotPermissions | undefined, b: BotPermissions) =>
  !!a &&
  a.tools === b.tools &&
  a.approvalMode === b.approvalMode &&
  [...a.skillIds].sort().join('\n') === [...b.skillIds].sort().join('\n') &&
  [...a.mcpServerIds].sort().join('\n') === [...b.mcpServerIds].sort().join('\n');

export class DelegationService {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  /** 登记卡住后等本轮收尾的软停止计时 */
  private readonly blockTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** 卡住时由排队投递转成的下一次执行：自己没有投递，排队的投递都没跑起来就记失败 */
  private readonly rollovers = new Set<string>();
  private readonly delivering = new Set<string>();
  private readonly unsubscribe: () => void;
  private readonly unsubscribeDiscard: () => void;
  private readonly unsubscribeStarted: () => void;
  private readonly unsubscribeDeferred: () => void;
  /** 原回合已结束、还在等追加跑完的执行：先记下回合结果 */
  private readonly outcomes = new Map<string, TurnOutcome>();
  /** 已进模型、所在回合还没结束的追加 */
  private readonly accepted = new Set<string>();
  private readonly receipts = new Map<string, AppendDelivery>();
  private readonly receiptWaiters = new Map<string, Set<(state: AppendDelivery) => void>>();
  /** 正在结算（验收读会话中）的执行：期间的回合事件不再改结果 */
  private readonly settling = new Set<string>();
  /** 发起会话不同的同任务同成员：排在 after 那次执行之后，结束后才投递 */
  private readonly held = new Map<
    string,
    { after: string; run: () => Promise<void>; appends: (() => Promise<void>)[] }
  >();
  private readonly aborting = new Map<string, Promise<void>>();
  private disposed = false;
  private discarding = false;

  constructor(private readonly deps: Deps) {
    this.unsubscribeStarted = deps.host.onDeliveryStarted((event) => {
      const batch = delegationBatches(
        deps.store.list().filter((record) => record.parentConversationId === event.conversationId)
      ).find((items) => batchDeliveryId(items) === event.deliveryId);
      if (batch && !batch.some(active)) this.delivered(batch);
      const owner = this.appendOwner(event.conversationId, event.deliveryId);
      if (owner) {
        this.accepted.add(event.deliveryId);
        this.receipt(event.deliveryId, 'accepted');
      }
    });
    this.unsubscribeDeferred = deps.host.onDeliveryDeferred((event) => {
      if (this.appendOwner(event.conversationId, event.deliveryId))
        this.receipt(event.deliveryId, 'deferred');
    });
    this.unsubscribeDiscard = deps.host.onDiscard((scope) => {
      // 级联取消不是“批次里有人结束”，不写等待提示
      this.discarding = true;
      try {
        for (const record of deps.store.list()) {
          if (
            (scope.chatId && record.chatId === scope.chatId) ||
            (scope.botId &&
              (record.parentBotId === scope.botId || record.targetBotId === scope.botId)) ||
            (scope.conversationId && record.parentConversationId === scope.conversationId)
          )
            this.cancel(record.id);
        }
      } finally {
        this.discarding = false;
      }
    });
    for (const record of deps.store.list()) {
      if (active(record))
        this.save({
          ...record,
          ...closeAppends(record),
          // 登记过卡住的按卡住收尾，其余记中断
          ...(record.blocked
            ? { state: 'blocked' as const }
            : { state: 'failed' as const, failure: 'interrupted' as const }),
          finishedAt: Date.now(),
        });
    }
    this.unsubscribe = deps.host.onTurnFinished((event) => {
      if (event.stopped && event.turnKey) this.stopBatch(event.conversationId, event.turnKey);
      if (event.delegationId) this.turnEnded(event);
      queueMicrotask(() => {
        void this.deliverPending();
      });
    });
    queueMicrotask(() => {
      void this.deliverPending();
    });
  }

  private upstreamBots(record: Delegation): Set<string> {
    const ids = new Set<string>();
    for (let item: Delegation | undefined = record; item && !ids.has(item.parentBotId); ) {
      ids.add(item.parentBotId);
      item = this.deps.authority.conversation(item.parentConversationId)?.bot?.delegationId
        ? this.executionOf(item.parentConversationId)
        : undefined;
    }
    return ids;
  }

  /** 同一轮发起的委派共享 batchId（父会话轮次键），结果齐了合并回传；standalone 自成一批 */
  delegate(
    parentConversationId: string,
    input: DelegateInput,
    options: {
      standalone?: boolean;
      retryOf?: string;
      resume?: Resume;
      trigger?: DelegationTrigger;
      /** 不续用任务会话（手动「从头重试」） */
      fresh?: boolean;
      /** 人在任务卡上答复：不受连续卡住次数限制 */
      human?: boolean;
    } = {}
  ): DelegateResult {
    if (this.disposed) return { ok: false, error: 'disabled' };
    const conversation = this.deps.authority.conversation(parentConversationId);
    let parent = this.deps.host.effectiveBot(parentConversationId);
    const target = this.deps.bots
      .list()
      .find((bot) => bot.id === input.to || botNameKey(bot.name) === botNameKey(input.to));
    if (!conversation?.bot || conversation.lifecycle === 'ended' || !parent)
      return { ok: false, error: 'Parent bot session unavailable.' };
    if (!target) return { ok: false, error: `Unknown member: ${input.to}` };
    if (!input.task.trim()) return { ok: false, error: 'Task must not be empty.' };
    const deadline = input.deadlineMinutes;
    if (deadline !== undefined && !(Number.isFinite(deadline) && deadline > 0))
      return { ok: false, error: 'deadlineMinutes must be a positive number.' };
    const limit = target.delegationTimeoutMinutes ?? DELEGATION_TIMEOUT_MINUTES;
    const timeoutMinutes = Math.min(deadline ?? limit, limit);
    // 子会话可能先后挂多次执行：按最新一次算祖先
    const ancestor = conversation.bot.delegationId
      ? this.executionOf(parentConversationId)
      : undefined;
    if (conversation.bot.delegationId && !ancestor)
      return { ok: false, error: 'Parent delegation record unavailable.' };
    if (ancestor) {
      // 重启后 effectiveBot 回落到原始档案，审批档仍按祖先委派快照收紧
      parent = delegatedBotPermissions(
        { ...parent, approvalMode: ancestor.effectivePermissions?.approvalMode ?? 'supervised' },
        parent
      );
    }
    // 结果本来就会自动回传给上游，往回委派只会绕圈
    if (ancestor && this.upstreamBots(ancestor).has(target.id))
      return {
        ok: false,
        error: `${target.name} delegated this work to you; your final reply is returned to them automatically.`,
      };
    const depth = (ancestor ? ancestor.depth : 0) + 1;
    const chatId = conversation.bot.chatId ?? (ancestor ? ancestor.chatId : null);
    const chat = chatId ? this.deps.chats.get(chatId) : undefined;
    if (chatId && (!chat || chat.archivedAt !== undefined))
      return { ok: false, error: 'Parent chat unavailable.' };
    const count = this.deps.store
      .list()
      .filter(
        (record) => record.parentConversationId === parentConversationId && active(record)
      ).length;
    const gate =
      input.taskId === undefined
        ? undefined
        : (this.deps.tasks?.gate(chatId, input.taskId, parent.id, target.id, options.human) ?? {
            ok: false as const,
            error: 'Tasks are only available in group chats.',
          });
    // 目标成员在本任务上还有排队 / 执行中的执行：同一发起会话并入，否则排在它之后
    const current = gate?.ok && gate.active ? this.deps.store.get(gate.active) : undefined;
    const busy = current && active(current) ? current : undefined;
    // 本会话排在它后面的下一次执行也算同一次（还没投递）
    const queuedNext = busy
      ? this.deps.store
          .list()
          .find(
            (record) =>
              this.held.has(record.id) &&
              record.parentConversationId === parentConversationId &&
              record.taskId === busy.taskId &&
              record.targetBotId === target.id
          )
      : undefined;
    const merge = busy?.parentConversationId === parentConversationId ? busy : queuedNext;
    const error = delegationPolicy(
      parent,
      target,
      depth,
      merge ? 0 : count,
      chat?.kind === 'group' ? chat.members : undefined
    );
    if (error) return { ok: false, error };
    if (gate && !gate.ok) return gate;
    if (merge && gate?.ok) return this.append(merge, input, parent.name, gate.seq, limit);
    const after = merge ? undefined : busy;
    let task: Omit<Extract<TaskGate, { ok: true }>, 'ok'> | undefined;
    let opened = false;
    let check = input.check;
    if (gate?.ok) {
      task = gate;
      check ??= gate.check;
    } else if (
      chatId &&
      chat?.kind === 'group' &&
      depth === 1 &&
      !options.retryOf &&
      !options.resume
    ) {
      task = this.deps.tasks?.open(chatId, parent.id, input.task, check);
      opened = task !== undefined;
    }
    const taskId = task?.taskId;
    const id = randomUUID();
    const batchId = options.standalone ? undefined : this.deps.host.turnKey(parentConversationId);
    const projectId = conversation.projectId;
    // 同一任务同一成员才续会话：会话由看板按任务真实 id + 成员给出，这里再核对归属与可用性
    const session = after?.childConversationId ?? task?.session;
    const reuse =
      !options.resume &&
      !options.fresh &&
      task &&
      session &&
      this.reusable(session, target.id, projectId, task.taskId, after !== undefined)
        ? session
        : undefined;
    const continued = options.resume?.conversationId ?? reuse;
    const child = continued
      ? this.deps.authority.conversation(continued)
      : this.newChild(projectId, target.id, id);
    const effective = delegatedBotPermissions(parent, target);
    const permissions: BotPermissions = {
      tools: effective.tools,
      approvalMode: effective.approvalMode,
      skillIds: effective.skillIds,
      mcpServerIds: effective.mcpServerIds,
    };
    const previous = continued ? this.executionOf(continued) : undefined;
    // 活实例可能是回送子委派结果时按只读重新拉起的：工具或审批档对不上也要重启
    const live = continued ? this.deps.host.effectiveBot(continued) : undefined;
    const respawn =
      previous !== undefined &&
      (!samePermissions(previous.effectivePermissions, permissions) ||
        (live !== undefined &&
          (live.tools !== permissions.tools || live.approvalMode !== permissions.approvalMode)));
    const trigger: DelegationTrigger =
      options.trigger ?? (options.retryOf ? 'retry' : (task?.trigger ?? 'delegate'));
    // 群主再派给失败的原执行人：就是对那次失败执行的重试
    const retryOf =
      options.retryOf ??
      (trigger === 'retry' && previous?.state === 'failed' && previous.taskId === taskId
        ? previous.id
        : undefined);
    // 挂看板任务的执行（深度 1）才有 report_blocked
    const origin = {
      parentConversationId,
      chatId,
      ...(taskId && depth === 1 ? { task: true as const } : {}),
    };
    if (!child || !this.deps.host.registerDelegation(child.conversationId, effective, origin)) {
      if (opened && chatId && taskId) this.deps.tasks?.discard(chatId, taskId);
      return { ok: false, error: 'Delegation workspace unavailable.' };
    }
    const record: Delegation = {
      id,
      parentConversationId,
      parentBotId: parent.id,
      targetBotId: target.id,
      chatId,
      task: input.task,
      context: (input.context ?? '').slice(0, 8000),
      childConversationId: child.conversationId,
      state: 'queued',
      depth,
      createdAt: Date.now(),
      effectivePermissions: permissions,
      ...(batchId ? { batchId } : {}),
      ...(taskId ? { taskId } : {}),
      // 返工 / 追加不挂 retryOf：验收只认本次执行开始后的证据
      ...(retryOf ? { retryOf } : {}),
      ...(input.keep ? { keep: true } : {}),
      ...(check ? { check: { kind: check.kind, text: check.text } } : {}),
      timeoutMinutes,
      trigger,
    };
    this.save(record);
    const info: TaskInfo = {
      ...(task ? { seq: task.seq } : {}),
      ...(reuse ? { incremental: true } : {}),
      ...(task?.returnReason && trigger === 'delegate' ? { returnReason: task.returnReason } : {}),
    };
    const freshChild = () => {
      const fresh = this.newChild(projectId, target.id, id);
      return fresh && this.deps.host.registerDelegation(fresh.conversationId, effective, origin)
        ? fresh.conversationId
        : undefined;
    };
    const dispatch = async () => {
      // 权限或工具变了：先释放空闲实例，下次开工按新配置和原 jsonl 重新 spawn（不走停止）
      if (respawn && continued) await this.deps.host.releaseIdle(continued);
      const sent = options.resume
        ? await this.resume(record, options.resume, freshChild, parent.name, info)
        : await this.sendTask(record, parent.name, info);
      const latest = this.deps.store.get(id);
      if (!latest || !active(latest)) return;
      if (!sent.ok) this.finish(latest, 'failed', 'error', undefined, sent.error);
      else if (!sent.queued) this.started(latest);
    };
    const run = () =>
      dispatch().catch((cause) => {
        const latest = this.deps.store.get(id);
        if (latest && active(latest))
          this.finish(latest, 'failed', 'error', undefined, String(cause));
      });
    if (after) {
      // 等上一次执行结束（含它被停止时的收尾）再投递，避免进到它的回合里
      const entry = {
        after: after.id,
        appends: [] as (() => Promise<void>)[],
        run: async () => {
          await this.aborting.get(after.childConversationId);
          await run();
          for (const send of entry.appends) await send();
        },
      };
      this.held.set(id, entry);
    } else void run();
    const warnings = [
      ...((input.context?.length ?? 0) > 8000 ? ['Context truncated to 8000 characters.'] : []),
      ...(deadline !== undefined && deadline > limit
        ? [`Deadline capped at ${limit} minutes (${target.name}'s delegation limit).`]
        : []),
      ...(after
        ? [
            `${target.name} is still on task #${task?.seq} for another conversation; this was queued as the next run and starts after that run ends.`,
          ]
        : []),
    ];
    return {
      ok: true,
      delegationId: id,
      ...(task ? { taskId: `#${task.seq}` } : {}),
      ...(warnings.length ? { warning: warnings.join(' ') } : {}),
    };
  }

  /** 工具入口：并入执行中的执行时最多等 10 秒回执 */
  async delegateAndConfirm(
    parentConversationId: string,
    input: DelegateInput
  ): Promise<DelegateResult> {
    const result = this.delegate(parentConversationId, input);
    if (!result.ok || !result.merged) return result;
    const id = appendId(result.delegationId, input);
    const known = this.receipts.get(id);
    const delivery =
      known === 'accepted' || known === 'failed'
        ? known
        : await new Promise<AppendDelivery>((resolve) => {
            const waiters = this.receiptWaiters.get(id) ?? new Set();
            const wake = (state: AppendDelivery) => {
              clearTimeout(timer);
              waiters.delete(wake);
              resolve(state);
            };
            const timer = setTimeout(() => wake(this.receipts.get(id) ?? 'deferred'), RECEIPT_MS);
            timer.unref?.();
            waiters.add(wake);
            this.receiptWaiters.set(id, waiters);
            if (known) wake(known);
          });
    return { ...result, delivery };
  }

  /** 同一发起会话追加到本任务排队 / 执行中的执行：不建新记录，steer 进同一子会话 */
  private append(
    record: Delegation,
    input: DelegateInput,
    from: string,
    seq: number,
    limit: number
  ): DelegateResult {
    const deliveryId = appendId(record.id, input);
    const merged = {
      ok: true as const,
      delegationId: record.id,
      taskId: `#${seq}`,
      merged: true as const,
    };
    // 同一追加重发不重复执行；之前没送达的才重新投递
    const again = record.appends?.find((item) => item.deliveryId === deliveryId);
    if (again && again.ok !== false) return merged;
    if (!again && (record.appends?.length ?? 0) >= DELEGATION_APPENDS_MAX)
      return {
        ok: false,
        error: `This run already has ${DELEGATION_APPENDS_MAX} appended requests; wait for its result.`,
      };
    const minute = this.deps.minuteMs ?? 60_000;
    const now = Date.now();
    const wanted = Math.min(input.deadlineMinutes ?? limit, limit);
    const before = record.timeoutMinutes ?? DELEGATION_TIMEOUT_MINUTES;
    // 到期时刻取较晚者；排队中还没起算，只取较长的期限
    const timeoutMinutes =
      record.startedAt === undefined
        ? Math.max(before, wanted)
        : Math.max(before, Math.ceil((now + wanted * minute - record.startedAt) / minute));
    const batchId = this.deps.host.turnKey(record.parentConversationId) ?? record.batchId;
    const next: Delegation = {
      ...record,
      appends: again
        ? (record.appends ?? []).map((item) =>
            item === again ? { at: now, text: input.task, deliveryId } : item
          )
        : [...(record.appends ?? []), { at: now, text: input.task, deliveryId }],
      timeoutMinutes,
      ...(batchId ? { batchId } : {}),
      ...(record.keep || input.keep ? { keep: true as const } : {}),
    };
    this.receipts.delete(deliveryId);
    this.save(next);
    if (next.state === 'running' && timeoutMinutes !== before) this.arm(next);
    const held = this.held.get(next.id);
    if (held) {
      // 还没投递的下一次执行：追加等它投递后再跟上
      held.appends.push(() => this.sendAppend(next, deliveryId, input, from, seq));
      this.receipt(deliveryId, 'deferred');
    } else void this.sendAppend(next, deliveryId, input, from, seq);
    const warnings = [
      ...((input.context?.length ?? 0) > 8000 ? ['Context truncated to 8000 characters.'] : []),
      ...(input.deadlineMinutes !== undefined && input.deadlineMinutes > limit
        ? [`Deadline capped at ${limit} minutes (the member's delegation limit).`]
        : []),
      ...(input.check ? ['check is ignored for an append; the run keeps its own check.'] : []),
    ];
    return { ...merged, ...(warnings.length ? { warning: warnings.join(' ') } : {}) };
  }

  private async sendAppend(
    record: Delegation,
    deliveryId: string,
    input: DelegateInput,
    from: string,
    seq: number
  ): Promise<void> {
    if (!active(this.deps.store.get(record.id) ?? record)) return;
    const runs = record.taskId ? this.taskRuns(record.taskId) : [];
    const run = runs.findIndex((item) => item.id === record.id) + 1;
    const context = input.context
      ? `\n<context>${escapeXml(input.context.slice(0, 8000))}</context>`
      : '';
    const text = `<delegation-task id="${record.id}" from="${escapeXml(from)}" task="#${seq}" run="${run}" trigger="append">\n${escapeXml(input.task)}${context}\n</delegation-task>`;
    const child = record.childConversationId;
    let sent: BotDeliverResult;
    try {
      sent = await this.deps.host.deliverConversation(child, text, { deliveryId, source: 'bot' });
    } catch (cause) {
      sent = { ok: false, error: String(cause) };
    }
    if (!sent.ok) this.appendFailed(record.id, deliveryId);
    else if (this.deps.host.hasStartedDelivery(child, deliveryId)) {
      if (this.appendOwner(child, deliveryId)) this.accepted.add(deliveryId);
      this.receipt(deliveryId, 'accepted');
    } else if (this.deps.host.deliveryQueued(child, deliveryId))
      this.receipt(deliveryId, 'deferred');
  }

  /** 追加所属的进行中执行（追加还没跑完） */
  private appendOwner(conversationId: string, deliveryId: string): Delegation | undefined {
    return this.deps.store
      .list()
      .find(
        (record) =>
          record.childConversationId === conversationId &&
          active(record) &&
          record.appends?.some((item) => item.deliveryId === deliveryId && item.ok === undefined)
      );
  }

  private receipt(deliveryId: string, state: AppendDelivery): void {
    const known = this.receipts.get(deliveryId);
    if (known === 'accepted' || known === 'failed') return;
    this.receipts.set(deliveryId, state);
    for (const wake of [...(this.receiptWaiters.get(deliveryId) ?? [])]) wake(state);
    this.receiptWaiters.delete(deliveryId);
  }

  /** 追加没送到模型：记失败；原回合已结束且没有别的在等就结算 */
  private appendFailed(recordId: string, deliveryId: string): void {
    this.receipt(deliveryId, 'failed');
    this.accepted.delete(deliveryId);
    const record = this.deps.store.get(recordId);
    if (!record || !active(record)) return;
    if (!record.appends?.some((item) => item.deliveryId === deliveryId && item.ok === undefined))
      return;
    const next = {
      ...record,
      appends: record.appends.map((item) =>
        item.deliveryId === deliveryId ? { ...item, ok: false } : item
      ),
    };
    this.save(next);
    this.settleIfIdle(next.id);
  }

  /**
   * 子会话一个回合（或一条额外投递）结束。回合收尾时还有本执行的追加 / 插话没跑完就先不结算，
   * 记下回合结果，等它们跑完或到期再结算。
   */
  private turnEnded(event: BotTurnFinished): void {
    // 续跑的新记录沿用原子会话，会话绑定的仍是最初的委派 id
    let record = this.deps.store
      .list()
      .find(
        (item) =>
          item.childConversationId === event.conversationId &&
          active(item) &&
          !this.held.has(item.id)
      );
    if (!record || this.settling.has(record.id)) return;
    const previous = this.outcomes.get(record.id);
    const text =
      previous?.ok &&
      event.ok &&
      previous.text &&
      previous.text !== event.text &&
      record.appends?.some((item) => item.deliveryId.startsWith(TASK_FOLLOWUP_PREFIX))
        ? [previous.text, event.text].filter(Boolean).join('\n\n')
        : event.text;
    const outcome: TurnOutcome = {
      ok: event.ok,
      text,
      ...(event.error ? { error: event.error } : {}),
    };
    const id = event.deliveryId;
    if (id && !this.deps.host.hasStartedDelivery(event.conversationId, id)) {
      // 追加 / 插话没送到模型：不是这次执行的回合结果
      if (id === record.id) this.settle(record, outcome);
      else if (record.appends?.some((item) => item.deliveryId === id))
        this.appendFailed(record.id, id);
      else this.settleIfIdle(record.id);
      return;
    }
    const consumed = record.appends?.some(
      (item) => item.ok === undefined && this.accepted.has(item.deliveryId)
    );
    if (consumed && record.appends) {
      record = {
        ...record,
        appends: record.appends.map((item) => {
          if (item.ok !== undefined || !this.accepted.has(item.deliveryId)) return item;
          this.accepted.delete(item.deliveryId);
          return { ...item, ok: event.ok };
        }),
      };
      this.save(record);
    }
    // 登记了卡住：不等排队的追加 / 插话，它们转成下一次执行
    if (this.pending(record) && !record.blocked) this.outcomes.set(record.id, outcome);
    else this.settle(record, outcome);
  }

  private pending(record: Delegation): boolean {
    return (
      !!record.appends?.some((item) => item.ok === undefined) ||
      this.deps.host.hasPendingDeliveries(record.childConversationId)
    );
  }

  private settleIfIdle(recordId: string): void {
    const record = this.deps.store.get(recordId);
    const outcome = this.outcomes.get(recordId);
    if (!record || !active(record) || this.pending(record)) return;
    if (outcome) this.settle(record, outcome);
    else if (record.state === 'queued' && this.rollovers.has(record.id))
      this.finish(record, 'failed', 'error', undefined, 'Queued messages were not delivered.');
  }

  private settle(record: Delegation, outcome: TurnOutcome): void {
    const stored = this.outcomes.get(record.id);
    this.outcomes.delete(record.id);
    // 软停止中止的回合没有正文：用原回合暂存的结果
    if (record.blocked) this.block(record, outcome.text ? outcome : (stored ?? outcome));
    else if (outcome.ok && record.check) {
      this.settling.add(record.id);
      void this.verify(record, record.check, outcome.text);
    } else
      this.finish(
        record,
        outcome.ok ? 'completed' : 'failed',
        outcome.ok ? undefined : 'error',
        outcome.text,
        outcome.error
      );
  }

  private abort(conversationId: string): Promise<void> {
    const running = this.aborting.get(conversationId);
    if (running) return running;
    const done = this.deps.host
      .abortConversation(conversationId)
      .catch(console.warn)
      .finally(() => this.aborting.delete(conversationId));
    this.aborting.set(conversationId, done);
    return done;
  }

  /** 一次执行结束：排在它之后的下一次执行开始投递（一次只放一个） */
  private releaseHeld(finished: Delegation): void {
    const own = this.held.get(finished.id);
    this.held.delete(finished.id);
    const next = [...this.held]
      .filter(([, item]) => item.after === finished.id)
      .sort(
        ([a], [b]) =>
          (this.deps.store.get(a)?.createdAt ?? 0) - (this.deps.store.get(b)?.createdAt ?? 0)
      );
    if (!next.length) return;
    if (own) {
      for (const [, item] of next) item.after = own.after;
      return;
    }
    const [[id, first], ...rest] = next;
    for (const [, item] of rest) item.after = id;
    this.held.delete(id);
    queueMicrotask(() => {
      void first.run();
    });
  }

  list(chatId?: string): Delegation[] {
    return this.deps.store.list(chatId);
  }

  private newChild(projectId: string, botId: string, delegationId: string) {
    return this.deps.authority.createBotConversation(projectId, {
      botId,
      chatId: null,
      delegationId,
    });
  }

  /** 子会话当前（最新）一次执行；会话绑定的 delegationId 只是第一次 */
  executionOf(childConversationId: string): Delegation | undefined {
    let latest: Delegation | undefined;
    for (const record of this.deps.store.list())
      if (
        record.childConversationId === childConversationId &&
        (!latest || record.createdAt >= latest.createdAt)
      )
        latest = record;
    return latest;
  }

  /** 任务会话可续：未结束、成员与项目一致、最近一次执行属于本任务且已结束（排在它之后时可未结束）、jsonl 还在 */
  private reusable(
    conversationId: string,
    botId: string,
    projectId: string,
    taskId: string,
    queuedAfter = false
  ) {
    const child = this.deps.authority.conversation(conversationId);
    const last = this.executionOf(conversationId);
    const file = child?.sessionFile;
    return (
      !!child &&
      child.lifecycle !== 'ended' &&
      child.projectId === projectId &&
      child.bot?.botId === botId &&
      !!child.bot.delegationId &&
      last?.taskId === taskId &&
      last.depth === 1 &&
      (queuedAfter || !active(last)) &&
      !!file &&
      existsSync(file)
    );
  }

  /** 任务的历次执行（深度 1），按发起先后 */
  private taskRuns(taskId: string): Delegation[] {
    return this.deps.store
      .list()
      .filter((record) => record.taskId === taskId && record.depth === 1)
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  /** 续用会话只发增量；新会话发完整任务，任务有历次执行时附 <previous-runs> */
  private sendTask(
    record: Delegation,
    from: string,
    info: TaskInfo = {}
  ): Promise<BotDeliverResult> {
    const acceptance = record.check
      ? `\n<acceptance-check>Passes only if one of your final tool outputs (e.g. a command's output) contains: ${escapeXml(record.check.text)}</acceptance-check>`
      : '';
    const runs = record.taskId ? this.taskRuns(record.taskId) : [];
    const index = runs.findIndex((item) => item.id === record.id);
    let text: string;
    if (info.incremental && info.seq !== undefined && index >= 0) {
      const context = record.context ? `\n<context>${escapeXml(record.context)}</context>` : '';
      text = `<delegation-task id="${record.id}" from="${escapeXml(from)}" task="#${info.seq}" run="${index + 1}" trigger="${record.trigger ?? 'delegate'}">\n${escapeXml(record.task)}${context}${acceptance}\n</delegation-task>`;
    } else {
      const previous = previousRunsText(index >= 0 ? runs.slice(0, index) : [], {
        name: (id) => this.deps.bots.get(id)?.name ?? id,
        ...(info.returnReason ? { returnReason: info.returnReason } : {}),
      });
      text = `<delegation-task id="${record.id}" from="${escapeXml(from)}">\n${escapeXml(record.task)}\n<context>${escapeXml(record.context)}</context>${acceptance}${previous ? `\n${previous}` : ''}\n</delegation-task>`;
    }
    return this.deps.host.deliverConversation(record.childConversationId, text, {
      deliveryId: record.id,
      queueIfBusy: true,
      source: 'bot',
    });
  }

  /** 沿用原子会话：中途失败从最后一步续跑，验收没过补一条原因；会话恢复不了才换新子会话从头发任务 */
  private async resume(
    record: Delegation,
    resume: Resume,
    freshChild: () => string | undefined,
    from: string,
    info: TaskInfo
  ): Promise<BotDeliverResult> {
    const sent =
      resume.checkFailed && record.check
        ? await this.deps.host.deliverConversation(
            resume.conversationId,
            `<delegation-check-failed id="${record.id}">\nThe acceptance check failed: none of your final tool outputs contained: ${escapeXml(record.check.text)}\nFix the work and finish again; this delegation passes only if one of your final tool outputs contains it.\n</delegation-check-failed>`,
            { deliveryId: record.id, queueIfBusy: true, source: 'bot' }
          )
        : await this.deps.host.retryConversation(resume.conversationId, { delegation: true });
    if (sent.ok || RESUME_TRANSIENT.has(sent.error)) return sent;
    const current = this.deps.store.get(record.id);
    if (!current || !active(current)) return sent;
    const conversationId = freshChild();
    if (!conversationId) return { ok: false, error: 'Delegation workspace unavailable.' };
    const fresh = { ...current, childConversationId: conversationId };
    this.save(fresh);
    return this.sendTask(fresh, from, { ...info, incremental: false });
  }

  check(parentConversationId: string, input: { id?: string; cancel?: boolean }): unknown {
    const records = this.list().filter(
      (record) =>
        record.parentConversationId === parentConversationId &&
        (!input.id || record.id === input.id)
    );
    if (input.id && !records.length)
      return { ok: false, error: 'Delegation not found in this parent session.' };
    if (input.cancel) {
      if (!input.id) return { ok: false, error: 'Specify id to cancel a delegation.' };
      return this.cancel(input.id);
    }
    return { ok: true, delegations: records };
  }

  /** 委派所属聊天（共享浏览器等按聊天归属的资源用） */
  chatIdOf(id: string): string | null {
    return this.deps.store.get(id)?.chatId ?? null;
  }

  /** 委派发起成员 */
  parentBotOf(id: string): string | undefined {
    return this.deps.store.get(id)?.parentBotId;
  }

  cancel(id: string): { ok: boolean; error?: string } {
    const record = this.deps.store.get(id);
    if (!record) return { ok: false, error: 'Delegation not found.' };
    if (!active(record)) return { ok: true };
    const held = this.held.has(id);
    this.finish(record, 'canceled');
    // 排着的下一次执行还没投递：子会话属于正在跑的那次，不能停
    if (!held) void this.abort(record.childConversationId);
    return { ok: true };
  }

  /** 默认从断点续跑；手动取消的须由用户选 resume / restart，子会话丢失或文件不在才从头 */
  retry(id: string, mode?: DelegationRetryMode): DelegateResult {
    const record = this.deps.store.get(id);
    if (!record || (record.state !== 'failed' && record.state !== 'canceled'))
      return {
        ok: false,
        error: 'Only failed, canceled or interrupted delegations can be retried.',
      };
    if (record.state === 'canceled' && !mode)
      return { ok: false, error: 'Choose to resume or restart a canceled delegation.' };
    if (this.deps.store.list().some((item) => item.retryOf === id))
      return { ok: false, error: 'This delegation has already been retried.' };
    // 任务仍空闲（已退回待办）时沿用关联；已完成 / 取消 / 被别人接手则不再绑定
    const taskId =
      record.taskId &&
      this.deps.tasks?.gate(record.chatId, record.taskId, record.parentBotId, record.targetBotId).ok
        ? record.taskId
        : undefined;
    const child = this.deps.authority.conversation(record.childConversationId);
    const file = child && child.lifecycle !== 'ended' ? child.sessionFile : undefined;
    const resume =
      mode !== 'restart' && file && existsSync(file)
        ? { conversationId: record.childConversationId, checkFailed: record.failure === 'check' }
        : undefined;
    // 重试是用户在轮次之外的操作，不并入原批次，也不并入父会话当前轮次；群里开过新对话就从委派人的新会话发起
    return this.delegate(
      this.delegatorSession(record) ?? record.parentConversationId,
      {
        to: record.targetBotId,
        task: record.task,
        context: record.context,
        ...(taskId ? { taskId } : {}),
        ...(record.timeoutMinutes ? { deadlineMinutes: record.timeoutMinutes } : {}),
        ...(record.check ? { check: { kind: record.check.kind, text: record.check.text } } : {}),
      },
      {
        standalone: true,
        retryOf: id,
        ...(resume ? { resume } : {}),
        ...(mode === 'restart' ? { fresh: true } : {}),
      }
    );
  }

  /**
   * 退回返工：原执行人在本任务会话里新开一次执行（trigger rework，不挂 retryOf）。
   * 成员验收时结果回到它当前群会话；人验收时回到委派人的会话，群里开过新对话就回到新会话。
   */
  rework(input: {
    chatId: string;
    delegationId: string;
    actor: string;
    reason: string;
  }): DelegateResult {
    const last = this.deps.store.get(input.delegationId);
    if (!last?.taskId) return { ok: false, error: 'Delegation not found.' };
    const human = input.actor === 'human';
    const parentConversationId = human
      ? this.delegatorSession(last)
      : this.deps.chats.get(input.chatId)?.sessions[input.actor]?.conversationId;
    if (!parentConversationId) return { ok: false, error: 'Parent bot session unavailable.' };
    const by = human
      ? 'a human reviewer'
      : (this.deps.bots.get(input.actor)?.name ?? 'the reviewer');
    return this.delegate(
      parentConversationId,
      {
        to: last.targetBotId,
        taskId: last.taskId,
        task: `Your delivery was returned for rework by ${by}. Reason:\n${input.reason}`,
        ...(last.timeoutMinutes ? { deadlineMinutes: last.timeoutMinutes } : {}),
      },
      { standalone: human, trigger: 'rework' }
    );
  }

  /** 委派人的会话：原会话还在用原会话，群聊里原会话已结束（新对话）就用它在该群的当前会话 */
  private delegatorSession(record: Delegation): string | undefined {
    const parent = this.deps.authority.conversation(record.parentConversationId);
    if (parent && parent.lifecycle !== 'ended') return parent.conversationId;
    if (
      !record.chatId ||
      record.depth !== 1 ||
      this.deps.chats.get(record.chatId)?.kind !== 'group'
    )
      return undefined;
    const session = this.deps.host.ensureSession(record.chatId, record.parentBotId);
    return session.ok ? session.conversationId : undefined;
  }

  /** 子会话正在跑的那次执行（排在后面、还没投递的不算） */
  private runningIn(childConversationId: string): Delegation | undefined {
    return this.deps.store
      .list()
      .find(
        (record) =>
          record.childConversationId === childConversationId &&
          record.state === 'running' &&
          !this.held.has(record.id)
      );
  }

  /** report_blocked：只登记，本轮由模型自然结束后记为 blocked；5 分钟还没收尾就软停止 */
  reportBlocked(
    childConversationId: string,
    input: { need: string; waitFor?: 'human' | 'parent' }
  ): { ok: true; instruction: string } | { ok: false; error: string } {
    const record = this.deps.authority.conversation(childConversationId)?.bot?.delegationId
      ? this.runningIn(childConversationId)
      : undefined;
    if (!record?.taskId || record.depth !== 1)
      return {
        ok: false,
        error: 'report_blocked is only available while working on a delegated board task.',
      };
    const need = input.need.trim().slice(0, DELEGATION_BLOCKED_NEED_MAX);
    if (!need) return { ok: false, error: 'Describe what you need in need.' };
    this.save({
      ...record,
      blocked: { need, waitFor: input.waitFor ?? 'parent', at: Date.now() },
    });
    clearTimeout(this.blockTimers.get(record.id));
    const timer = setTimeout(
      () => this.softStop(record.id),
      DELEGATION_BLOCKED_STOP_MINUTES * (this.deps.minuteMs ?? 60_000)
    );
    timer.unref?.();
    this.blockTimers.set(record.id, timer);
    return {
      ok: true,
      instruction:
        'Blocked reported. In one or two sentences say what you have done so far, then end your turn now; do not keep working on this task. You will continue in this session once someone answers.',
    };
  }

  /** 登记卡住后迟迟不收尾：只中止当前回合（不取消排队、不级联取消子委派） */
  private softStop(id: string): void {
    this.blockTimers.delete(id);
    const record = this.deps.store.get(id);
    if (!record || !active(record) || !record.blocked || this.settling.has(id)) return;
    // 先中止正在跑的回合（回合结束事件里按卡住结算）；没有在跑的回合才直接结算
    void this.deps.host
      .interruptTurn(record.childConversationId, BOT_BLOCKED_STOP)
      .catch(console.warn)
      .then((stopped) => {
        const latest = this.deps.store.get(id);
        if (!stopped && latest && active(latest))
          this.block(latest, this.outcomes.get(id) ?? { ok: false, text: '' });
      });
  }

  /**
   * 执行记为 blocked（释放名额、停计时、结果照常回传）。子会话里还排着的追加 / 插话
   * 不撤掉，转成同一会话的下一次执行（来源追加），排在后面的执行改排到它之后。
   */
  private block(record: Delegation, outcome: TurnOutcome): void {
    const open = record.appends?.filter((item) => item.ok === undefined) ?? [];
    const kept = record.appends?.filter((item) => item.ok !== undefined) ?? [];
    const { appends: _appends, ...base } = record;
    const next: Delegation | undefined =
      open.length || this.deps.host.hasPendingDeliveries(record.childConversationId)
        ? {
            id: randomUUID(),
            parentConversationId: record.parentConversationId,
            parentBotId: record.parentBotId,
            targetBotId: record.targetBotId,
            chatId: record.chatId,
            task: open.length
              ? open.map((item) => item.text).join('\n\n')
              : 'Messages queued while the previous run was ending.',
            context: '',
            childConversationId: record.childConversationId,
            state: 'queued',
            depth: record.depth,
            createdAt: Date.now(),
            ...(record.effectivePermissions
              ? { effectivePermissions: record.effectivePermissions }
              : {}),
            ...(record.taskId ? { taskId: record.taskId } : {}),
            ...(record.keep ? { keep: true as const } : {}),
            ...(record.check
              ? { check: { kind: record.check.kind, text: record.check.text } }
              : {}),
            ...(record.timeoutMinutes ? { timeoutMinutes: record.timeoutMinutes } : {}),
            trigger: 'append',
            ...(open.length ? { appends: open } : {}),
          }
        : undefined;
    if (next)
      for (const entry of this.held.values()) if (entry.after === record.id) entry.after = next.id;
    this.finish(
      kept.length ? { ...base, appends: kept } : base,
      'blocked',
      undefined,
      outcome.text || undefined
    );
    if (next) {
      this.rollovers.add(next.id);
      this.save(next);
    }
  }

  /** 人在任务卡回复缺信息卡住的任务：同成员同会话新开一次执行，结果回委派人（原会话失效则其当前会话） */
  reply(input: { chatId: string; delegationId: string; text: string }): DelegateResult {
    const last = this.deps.store.get(input.delegationId);
    if (!last?.taskId || last.state !== 'blocked')
      return { ok: false, error: 'This task is not waiting for an answer.' };
    const parentConversationId = this.delegatorSession(last);
    if (!parentConversationId) return { ok: false, error: 'Parent bot session unavailable.' };
    return this.delegate(
      parentConversationId,
      {
        to: last.targetBotId,
        taskId: last.taskId,
        task: `A human answered on the task card:\n${input.text}`,
        ...(last.timeoutMinutes ? { deadlineMinutes: last.timeoutMinutes } : {}),
      },
      { standalone: true, trigger: 'reply', human: true }
    );
  }

  /** 人在任务卡回复执行中的任务：作为真人插话投进当前执行的子会话 */
  async interject(input: {
    delegationId: string;
    text: string;
    deliveryId?: string;
  }): Promise<{ ok: true } | { ok: false; error: string }> {
    const record = this.deps.store.get(input.delegationId);
    if (!record || !active(record) || this.held.has(record.id))
      return { ok: false, error: 'This run has ended.' };
    const deliveryId = input.deliveryId ?? randomUUID();
    // 托管直通先记账再投递；重启时未消费的补充按原规则标失败，不能伪报已完成或盲目重放。
    if (input.deliveryId) {
      const previous = record.appends?.find((item) => item.deliveryId === deliveryId);
      if (previous)
        return previous.ok === false
          ? { ok: false, error: 'Follow-up delivery was interrupted.' }
          : { ok: true };
      if ((record.appends?.length ?? 0) >= DELEGATION_APPENDS_MAX)
        return { ok: false, error: 'Too many follow-ups in this run; wait for its result.' };
      this.save({
        ...record,
        appends: [...(record.appends ?? []), { at: Date.now(), text: input.text, deliveryId }],
      });
    }
    let sent: BotDeliverResult;
    try {
      sent = await this.deps.host.deliverConversation(
        record.childConversationId,
        `From a human on the task card:\n${input.text}`,
        { source: 'human', deliveryId }
      );
    } catch (cause) {
      sent = { ok: false, error: String(cause) };
    }
    if (input.deliveryId) {
      if (!sent.ok) this.appendFailed(record.id, deliveryId);
      else if (this.deps.host.hasStartedDelivery(record.childConversationId, deliveryId)) {
        if (this.appendOwner(record.childConversationId, deliveryId)) this.accepted.add(deliveryId);
        this.receipt(deliveryId, 'accepted');
      }
    }
    return sent.ok ? { ok: true } : { ok: false, error: sent.error };
  }

  /** 父回合被停止：取消该轮发起且未 keep 的委派；整批都已结束则只落时间线，不再唤醒父会话 */
  private stopBatch(parentConversationId: string, batchId: string): void {
    const batch = () =>
      this.deps.store
        .list()
        .filter(
          (record) =>
            record.parentConversationId === parentConversationId && record.batchId === batchId
        );
    this.discarding = true;
    try {
      for (const record of batch()) if (active(record) && !record.keep) this.cancel(record.id);
    } finally {
      this.discarding = false;
    }
    const rest = batch();
    if (rest.length && !rest.some(active)) this.delivered(rest);
  }

  /** 群开新对话：未 keep 的取消，已结束未投递的只落时间线；keep 的跑完后父会话已结束，同样只落时间线 */
  startOver(chatId: string): void {
    const records = () => this.deps.store.list().filter((record) => record.chatId === chatId);
    this.discarding = true;
    try {
      for (const record of records()) if (active(record) && !record.keep) this.cancel(record.id);
    } finally {
      this.discarding = false;
    }
    const done = records().filter((record) => !active(record) && record.deliveredAt === undefined);
    if (done.length) this.delivered(done);
  }

  /** 私聊回退越过发起委派的回合：取消进行中的，未投递结果一律作废（规则见 rewoundDelegations） */
  discardRewound(parentConversationId: string, since: number): void {
    const { cancel, discard } = rewoundDelegations(this.list(), parentConversationId, since);
    this.discarding = true;
    try {
      for (const id of cancel) this.cancel(id);
    } finally {
      this.discarding = false;
    }
    const records = discard.flatMap((id) => this.deps.store.get(id) ?? []);
    if (records.length) this.delivered(records);
  }

  observeRunning(conversationId: string): void {
    const record = this.list().find(
      (item) =>
        item.childConversationId === conversationId &&
        item.state === 'queued' &&
        !this.held.has(item.id)
    );
    if (record) this.started(record);
  }

  /** queued → running 的唯一入口：期限从真正开工起算 */
  private started(record: Delegation): void {
    if (record.state !== 'queued' || this.disposed) return;
    const running: Delegation = { ...record, state: 'running', startedAt: Date.now() };
    this.save(running);
    this.arm(running);
  }

  /** 到期时刻 = startedAt + timeoutMinutes（追加会把它往后推） */
  private arm(record: Delegation): void {
    clearTimeout(this.timers.get(record.id));
    const at =
      (record.startedAt ?? Date.now()) +
      (record.timeoutMinutes ?? DELEGATION_TIMEOUT_MINUTES) * (this.deps.minuteMs ?? 60_000);
    const timer = setTimeout(() => this.expire(record.id), Math.max(0, at - Date.now()));
    timer.unref?.();
    this.timers.set(record.id, timer);
  }

  /** 到期强制结算：原回合已结束只在等追加的，按回合结果结算，没跑完的追加记失败 */
  private expire(id: string): void {
    const current = this.deps.store.get(id);
    if (!current || !active(current) || this.settling.has(id)) return;
    if (current.blocked) {
      this.softStop(id);
      return;
    }
    const outcome = this.outcomes.get(id);
    if (outcome) this.settle(current, outcome);
    else this.finish(current, 'failed', 'timeout');
    void this.abort(current.childConversationId);
  }

  async deliverPending(parentConversationId?: string): Promise<void> {
    if (this.disposed) return;
    for (const batch of delegationBatches(this.list())) {
      const head = batch[0];
      const deliveryId = batchDeliveryId(batch);
      if (
        batch.some(active) ||
        batch.every((record) => record.deliveredAt !== undefined) ||
        this.delivering.has(deliveryId) ||
        (parentConversationId && head.parentConversationId !== parentConversationId)
      )
        continue;
      // 托管失败不单独唤醒父模型；若同批还有交付，则保留失败身份但不传失败细节。
      const awaitingHuman = new Set(
        batch.filter((record) => this.awaitHumanRecovery(record)).map((record) => record.id)
      );
      if (
        batch.every((record) => awaitingHuman.has(record.id) || record.deliveredAt !== undefined)
      ) {
        this.delivered(batch);
        continue;
      }
      if (this.deps.host.isBusy(head.parentConversationId)) continue;
      const parent = this.deps.authority.conversation(head.parentConversationId);
      if (!parent || parent.lifecycle === 'ended') {
        if (head.chatId && this.deps.chats.get(head.chatId)?.kind === 'group')
          this.delivered(batch);
        continue;
      }
      if (this.deps.host.hasStartedDelivery(head.parentConversationId, deliveryId)) {
        this.delivered(batch);
        continue;
      }
      if (parent.bot?.delegationId) {
        const bot = this.deps.bots.get(head.parentBotId);
        const record = this.executionOf(parent.conversationId);
        // 执行人卡住在等答复：子委派结果先不回送，免得在卡住的会话里起一轮无主回合
        if (record?.state === 'blocked') continue;
        const saved = record?.effectivePermissions;
        // Interrupted delegation parents must not be restarted with their original task.
        if (
          !bot ||
          !this.deps.host.registerDelegation(
            parent.conversationId,
            {
              ...bot,
              ...(saved ? { skillIds: saved.skillIds, mcpServerIds: saved.mcpServerIds } : {}),
              tools: 'readonly',
              approvalMode: 'supervised',
            },
            record
              ? { parentConversationId: record.parentConversationId, chatId: record.chatId }
              : undefined
          )
        )
          continue;
      }
      this.delivering.add(deliveryId);
      try {
        const text = batchResultText(
          batch,
          (id) => this.deps.bots.get(id)?.name ?? id,
          awaitingHuman
        );
        const sent =
          parent.bot?.chatId &&
          this.deps.chats.get(parent.bot.chatId)?.kind === 'group' &&
          this.deps.deliverGroupResult
            ? await this.deps.deliverGroupResult(head, text, deliveryId)
            : await this.deps.host.deliverConversation(head.parentConversationId, text, {
                onlyIfIdle: true,
                source: 'bot',
                deliveryId,
              });
        if (sent.ok && this.deps.host.hasStartedDelivery(head.parentConversationId, deliveryId))
          this.delivered(batch);
      } catch (cause) {
        console.warn('[bots] delegation delivery failed', cause);
      } finally {
        this.delivering.delete(deliveryId);
      }
    }
  }

  private awaitHumanRecovery(record: Delegation): boolean {
    return (
      record.state === 'failed' &&
      record.depth === 1 &&
      !!record.taskId &&
      !!record.chatId &&
      this.deps.chats.rootOf(record.chatId)?.taskSupervision === true
    );
  }

  dispose(): void {
    this.disposed = true;
    this.unsubscribe();
    this.unsubscribeDiscard();
    this.unsubscribeStarted();
    this.unsubscribeDeferred();
    for (const waiters of this.receiptWaiters.values())
      for (const wake of [...waiters]) wake('deferred');
    this.receiptWaiters.clear();
    for (const timer of [...this.timers.values(), ...this.blockTimers.values()])
      clearTimeout(timer);
    this.timers.clear();
    this.blockTimers.clear();
  }

  disable(): void {
    this.disposed = true;
    for (const record of this.deps.store.list()) if (active(record)) this.cancel(record.id);
    this.dispose();
  }

  private finish(
    record: Delegation,
    state: Delegation['state'],
    failure?: Delegation['failure'],
    result?: string,
    error?: string
  ): void {
    clearTimeout(this.timers.get(record.id));
    this.timers.delete(record.id);
    clearTimeout(this.blockTimers.get(record.id));
    this.blockTimers.delete(record.id);
    const held = this.held.has(record.id);
    const orphaned =
      !held &&
      state !== 'blocked' &&
      (record.appends?.some((item) => item.ok === undefined) ||
        this.deps.host.hasPendingDeliveries(record.childConversationId));
    const finished: Delegation = {
      ...record,
      ...closeAppends(record),
      state,
      finishedAt: Date.now(),
      ...(failure ? { failure } : {}),
      ...(result !== undefined ? { result } : {}),
      ...(error ? { error } : {}),
    };
    this.save(finished);
    this.outcomes.delete(record.id);
    this.settling.delete(record.id);
    this.rollovers.delete(record.id);
    for (const item of record.appends ?? []) {
      if (item.ok === undefined) this.receipt(item.deliveryId, 'failed');
      this.accepted.delete(item.deliveryId);
      this.receipts.delete(item.deliveryId);
    }
    // 结束时子会话里还排着本次执行的追加 / 插话：一并撤掉，不留成无主回合
    if (orphaned) void this.abort(record.childConversationId);
    this.releaseHeld(finished);
    this.noticeWaiting(finished);
    queueMicrotask(() => {
      void this.deliverPending(record.parentConversationId);
    });
  }

  /** 委派开始后子会话的最终工具结果里找验收文本；读失败按未通过 */
  private async verify(record: Delegation, check: TaskCheck, text: string): Promise<void> {
    let passed = false;
    try {
      const messages = await this.deps.sessionMessages?.(record.childConversationId);
      passed = messages ? checkPassed(check, messages, this.startedAt(record)) : false;
    } catch (cause) {
      console.warn('[bots] delegation check read failed', cause);
    }
    const current = this.deps.store.get(record.id);
    if (this.disposed || !current || !active(current)) {
      this.settling.delete(record.id);
      return;
    }
    const checked = { ...current, check: { ...check, passed } };
    if (passed) this.finish(checked, 'completed', undefined, text);
    else this.finish(checked, 'failed', 'check', text, checkFailureText(check));
  }

  /** 同一子会话上的续跑链从最初那次委派起算 */
  private startedAt(record: Delegation): number {
    let start = record;
    for (
      let prev = record.retryOf ? this.deps.store.get(record.retryOf) : undefined;
      prev?.childConversationId === record.childConversationId;
      prev = prev.retryOf ? this.deps.store.get(prev.retryOf) : undefined
    )
      start = prev;
    return start.createdAt;
  }

  /** 批次未齐：在群时间线提示谁结束了、还在等谁 */
  private noticeWaiting(record: Delegation): void {
    if (this.disposed || this.discarding || !record.batchId || !record.chatId) return;
    if (this.deps.chats.get(record.chatId)?.kind !== 'group') return;
    const batch = this.deps.store
      .list()
      .filter(
        (item) =>
          item.parentConversationId === record.parentConversationId &&
          item.batchId === record.batchId
      );
    const text = batchWaitingNotice(batch, record, (id) => this.deps.bots.get(id)?.name ?? id);
    if (!text) return;
    const saved = this.deps.chats.appendEntry(record.chatId, {
      kind: 'system',
      id: randomUUID(),
      at: Date.now(),
      text,
    });
    if (saved) this.deps.emit({ kind: 'timeline', chatId: record.chatId, seq: saved.seq });
  }

  private delivered(batch: readonly Delegation[]): void {
    for (const record of batch) {
      const latest = this.deps.store.get(record.id);
      if (!latest || latest.deliveredAt !== undefined) continue;
      if (record.chatId && this.deps.chats.get(record.chatId)?.kind === 'group') {
        if (!this.deps.chats.hasEntry(record.chatId, `delegation:${record.id}`))
          this.deps.chats.appendEntry(record.chatId, {
            kind: 'delegation',
            id: `delegation:${record.id}`,
            at: Date.now(),
            delegationId: record.id,
            from: record.parentBotId,
            to: record.targetBotId,
            state: record.state,
            summary: delegationResultBody(record).slice(0, 500),
            ...(record.taskId ? { taskId: record.taskId } : {}),
          });
        this.deps.emit({ kind: 'timeline', chatId: record.chatId });
      }
      this.save({ ...latest, deliveredAt: Date.now() });
    }
  }

  private save(record: Delegation): void {
    this.deps.store.save(record);
    const nestedIn = record.taskId ? undefined : this.nestedIn(record);
    if (nestedIn) this.deps.tasks?.sync(record, nestedIn);
    else this.deps.tasks?.sync(record);
    this.deps.emit({ kind: 'delegation', ...(record.chatId ? { chatId: record.chatId } : {}) });
  }

  /** 嵌套执行所属的上层任务：发起它的那次执行（父会话上最近一条记录）挂的任务 */
  private nestedIn(record: Delegation): string | undefined {
    if (record.depth < 2) return undefined;
    return this.executionOf(record.parentConversationId)?.taskId;
  }
}
