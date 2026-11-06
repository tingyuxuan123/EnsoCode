import { createHash } from 'node:crypto';
import { type BotChat, GROUP_TASK_TEXT_MAX, type GroupEntry } from '../../../shared/types/bot';
import type { BotEvent, BotSendResult, BotSilence } from '../../../shared/types/botIpc';
import type { BotStore } from './botStore';
import type { BotChatStore } from './chatStore';
import { TASK_FOLLOWUP_PREFIX } from './delegationBatch';
import type { DelegationStore } from './delegationStore';
import type { GroupTaskStore } from './groupTaskStore';
import type { GroupTaskService } from './groupTasks';

interface Deps {
  chats: BotChatStore;
  bots: BotStore;
  taskStore: Pick<GroupTaskStore, 'list' | 'find'>;
  replyTask: GroupTaskService['reply'];
  delegations: Pick<DelegationStore, 'get'>;
  silences: () => readonly BotSilence[];
  emit: (event: BotEvent) => void;
  notify: (chatId: string, text: string) => void;
  language?: () => 'zh' | 'en';
}

const SWEEP_DEBOUNCE_MS = 750;
const SWEEP_INTERVAL_MS = 30_000;

// 任务号的前后边界：空白、中英文句读、括号或紧挨着的汉字（中文常不加空格）。
const TASK_REF_PATTERN =
  /(?<=^|[\s(（,，、;；:：]|\p{Script=Han})(?:(issue|pr)\s+)?#[1-9]\d*(?=[\s:：,，.。、;；!！?？)）]|\p{Script=Han}|$)/giu;

function hasAnotherTaskReference(text: string): boolean {
  // 只匹配有分隔边界、不以 0 开头的纯数字编号；带字母的色值、#000、链接片段、
  // 显式 issue/PR 引用不是任务号。宁可多判退回普通路由，也不把另一个任务的话送错执行。
  for (const [, external] of text.matchAll(TASK_REF_PATTERN)) {
    if (!external) return true;
  }
  return false;
}

/** 首部的单一任务编号才是直通意图；第二个任务编号和裸编号不猜测。 */
export function parseTaskFollowup(text: string): { seq: number; text: string } | undefined {
  const match = /^(?:任务\s*|task\s+)?#([1-9]\d*)(?=[\s:：,，])[\s:：,，]+([\s\S]+)$/iu.exec(
    text.trim()
  );
  if (!match) return undefined;
  const seq = Number(match[1]);
  const body = match[2].trim();
  if (
    !Number.isSafeInteger(seq) ||
    !body ||
    body.length > GROUP_TASK_TEXT_MAX ||
    hasAnotherTaskReference(body)
  )
    return undefined;
  return { seq, text: body };
}

/** 本地群任务托管：只跟进已授权任务，不认领待办、不自动重试、不代替审批。 */
export class TaskSupervisor {
  private timer?: ReturnType<typeof setInterval>;
  private scheduledSweep?: ReturnType<typeof setTimeout>;
  private disposed = false;
  /** 已确认在时间线上的提醒（按会话 + id，同一人类消息 id 可出现在不同话题）；
   *  跨重启仍以时间线为准，这里只省掉每轮巡检的回读。 */
  private readonly noticed = new Set<string>();
  constructor(private readonly deps: Deps) {}

  start(): void {
    if (this.disposed || this.timer) return;
    this.sweep();
    this.timer = setInterval(() => this.sweep(), SWEEP_INTERVAL_MS);
    this.timer.unref?.();
  }

  dispose(): void {
    this.disposed = true;
    clearInterval(this.timer);
    clearTimeout(this.scheduledSweep);
    this.timer = undefined;
    this.scheduledSweep = undefined;
  }

  scheduleSweep(): void {
    if (this.disposed) return;
    clearTimeout(this.scheduledSweep);
    this.scheduledSweep = setTimeout(() => this.sweep(), SWEEP_DEBOUNCE_MS);
    this.scheduledSweep.unref?.();
  }

  /** 只从权威任务/执行/静默记录派生提醒；稳定时间线 id 同时作为跨重启去重标记。 */
  sweep(): void {
    if (this.disposed) return;
    clearTimeout(this.scheduledSweep);
    this.scheduledSweep = undefined;
    try {
      this.scan();
    } catch (cause) {
      console.warn('[bots] task supervision scan failed', cause);
    }
  }

  private scan(): void {
    const roots = this.deps.chats.list().filter((chat) => !chat.parentId && this.enabled(chat.id));
    if (!roots.length) return;
    // since 是这段静默前最后一次输出的时间，恢复输出后再静默会变，用来区分每一段静默
    const silent = new Map(this.deps.silences().map((item) => [item.conversationId, item.since]));
    const en = this.deps.language?.() === 'en';
    // 同一轮新写的提醒按会话合并成一条系统通知，避免开启托管或批量中断时连发
    const alerts = new Map<string, { seqs: number[]; text: string }>();
    // 只读托管根群的原始任务快照，不为无历史任务派生 runs，也不克隆全部委派。
    for (const root of roots)
      for (const task of this.deps.taskStore.list(root.id)) {
        if (
          !task.delegationId ||
          (task.status !== 'blocked' && (task.status !== 'doing' || !silent.size))
        )
          continue;
        const record = this.deps.delegations.get(task.delegationId);
        if (
          !record?.chatId ||
          record.taskId !== task.id ||
          record.depth !== 1 ||
          record.targetBotId !== task.assigneeBotId ||
          this.enabled(record.chatId)?.id !== root.id
        )
          continue;
        let phase: string;
        let text: string;
        const since = silent.get(record.childConversationId);
        if (record.state === 'failed' && task.status === 'blocked') {
          phase = 'interrupted';
          text = en
            ? `Task #${task.seq} needs recovery. Check the last tool results, then confirm retry, reassign or cancel on the task card. No commands were replayed automatically.`
            : `任务 #${task.seq} 执行中断或失败。请先核对最后的工具结果，再在任务卡确认重试、改派或取消；托管不会自动重放命令。`;
        } else if (record.state === 'blocked' && task.status === 'blocked') {
          phase = 'need';
          text = en
            ? `Task #${task.seq} is waiting for information. Reply on its task card, or send “#${task.seq} your answer” in the group.`
            : `任务 #${task.seq} 正在等补充信息。可在任务卡回答，或在群里发送“#${task.seq} 你的答复”交回原负责人。`;
        } else if (record.state === 'running' && task.status === 'doing' && since !== undefined) {
          phase = `silence:${since}`;
          text = en
            ? `Task #${task.seq} has produced no output for a while. Check the execution or stop it on the task card; no automatic restart was performed.`
            : `任务 #${task.seq} 已长时间没有输出。请在任务卡查看执行详情或停止处理；托管未自动重启任务。`;
        } else continue;
        if (!this.notice(record.chatId, `task-supervision:${record.id}:${phase}`, text)) continue;
        const alert = alerts.get(record.chatId);
        if (alert) alert.seqs.push(task.seq);
        else alerts.set(record.chatId, { seqs: [task.seq], text });
      }
    for (const [chatId, { seqs, text }] of alerts) {
      const refs = seqs.map((seq) => `#${seq}`);
      try {
        this.deps.notify(
          chatId,
          seqs.length === 1
            ? text
            : en
              ? `${seqs.length} supervised tasks need attention: ${refs.join(', ')}. See the group timeline.`
              : `${seqs.length} 个托管任务需要处理：${refs.join('、')}。详情见群时间线。`
        );
      } catch (cause) {
        console.warn('[bots] task supervision notify failed', cause);
      }
    }
  }

  async route(
    chatId: string,
    entry: Extract<GroupEntry, { kind: 'human' }>
  ): Promise<BotSendResult | undefined> {
    const root = this.enabled(chatId);
    if (
      !root ||
      entry.mentions.length ||
      entry.images?.length ||
      entry.refs ||
      /(?:^|\s)@/u.test(entry.text)
    )
      return undefined;
    const followup = parseTaskFollowup(entry.text);
    if (!followup) return undefined;
    const en = this.deps.language?.() === 'en';
    const noticeId = `task-supervision:${entry.id}:route`;
    const unavailable = () => {
      this.notice(
        chatId,
        noticeId,
        en
          ? `Task #${followup.seq} has no execution that can receive this follow-up. Check its status on the task board.`
          : `任务 #${followup.seq} 当前没有可接收补充的委派执行。请到任务看板查看状态。`
      );
      return { ok: true as const };
    };
    const task = this.deps.taskStore.find(root.id, `#${followup.seq}`);
    if (!task?.delegationId || !task.assigneeBotId || !root.members.includes(task.assigneeBotId))
      return unavailable();
    const bot = this.deps.bots.get(task.assigneeBotId);
    if (!bot || bot.archivedAt !== undefined) return unavailable();
    const record = this.deps.delegations.get(task.delegationId);
    if (
      !record ||
      record.taskId !== task.id ||
      record.targetBotId !== task.assigneeBotId ||
      record.depth !== 1 ||
      !record.chatId ||
      this.enabled(record.chatId)?.id !== root.id
    )
      return unavailable();
    const running =
      task.status === 'doing' && (record.state === 'running' || record.state === 'queued');
    const waiting =
      task.status === 'blocked' && task.blockedReason === 'need' && record.state === 'blocked';
    if (!running && !waiting) return unavailable();
    let result: BotSendResult;
    try {
      result = await this.deps.replyTask(chatId, task.id, followup.text, {
        deliveryId: `${TASK_FOLLOWUP_PREFIX}${createHash('sha256')
          .update(JSON.stringify([chatId, entry.id]))
          .digest('hex')}`,
      });
    } catch (cause) {
      console.warn('[bots] task follow-up failed', cause);
      result = { ok: false, error: 'task-followup-failed' };
    }
    const text = result.ok
      ? en
        ? `Task #${task.seq}: follow-up submitted to ${bot.name}.`
        : `任务 #${task.seq}：补充已提交给 ${bot.name}。`
      : en
        ? `Task #${task.seq}: follow-up was not confirmed. Check the task card before retrying.`
        : `任务 #${task.seq}：补充未确认送达，请查看任务卡后再决定是否重发。`;
    this.notice(chatId, noticeId, text);
    // 人类消息已在群时间线，不把投递失败当作聊天发送失败；结果由同一时间线的提示表达。
    return { ok: true };
  }

  private enabled(chatId: string): BotChat | undefined {
    if (this.disposed) return undefined;
    const chat = this.deps.chats.get(chatId);
    const root = this.deps.chats.rootOf(chatId);
    return chat?.kind === 'group' &&
      chat.archivedAt === undefined &&
      root?.kind === 'group' &&
      root.archivedAt === undefined &&
      root.taskSupervision === true
      ? root
      : undefined;
  }

  /** 写一条稳定 id 的时间线提醒；只有本次新写入才返回 true，由调用方决定是否发系统通知。 */
  private notice(chatId: string, id: string, text: string): boolean {
    const key = JSON.stringify([chatId, id]);
    try {
      if (!this.enabled(chatId) || this.noticed.has(key)) return false;
      if (this.deps.chats.findEntry(chatId, id)) {
        this.noticed.add(key);
        return false;
      }
      const saved = this.deps.chats.appendEntry(chatId, {
        id,
        kind: 'system',
        at: Date.now(),
        text,
      });
      if (!saved) return false;
      this.noticed.add(key);
      this.deps.emit({ kind: 'timeline', chatId, seq: saved.seq });
      return true;
    } catch (cause) {
      console.warn('[bots] task supervision notice failed', cause);
      return false;
    }
  }
}
