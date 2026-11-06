import { createHash } from 'node:crypto';
import {
  type BotChat,
  type Delegation,
  GROUP_TASK_TEXT_MAX,
  type GroupEntry,
  type GroupTask,
} from '../../../shared/types/bot';
import type { BotEvent, BotSendResult, BotSilence } from '../../../shared/types/botIpc';
import type { BotStore } from './botStore';
import type { BotChatStore } from './chatStore';
import { TASK_FOLLOWUP_PREFIX } from './delegationBatch';
import type { GroupTaskService } from './groupTasks';

interface Deps {
  chats: BotChatStore;
  bots: BotStore;
  tasks: Pick<GroupTaskService, 'list' | 'reply'>;
  delegations: () => readonly Delegation[];
  silences: () => readonly BotSilence[];
  emit: (event: BotEvent) => void;
  notify: (chatId: string, text: string) => void;
  language?: () => 'zh' | 'en';
}

/** 首部的单一任务编号才是直通意图；多编号、正文中的编号和裸编号不猜测。 */
export function parseTaskFollowup(text: string): { seq: number; text: string } | undefined {
  const match = /^(?:任务\s*|task\s+)?#([1-9]\d*)(?=[\s:：,，])[\s:：,，]+([\s\S]+)$/iu.exec(
    text.trim()
  );
  if (!match) return undefined;
  const seq = Number(match[1]);
  const body = match[2].trim();
  if (!Number.isSafeInteger(seq) || !body || body.length > GROUP_TASK_TEXT_MAX || /#\d/u.test(body))
    return undefined;
  return { seq, text: body };
}

/** 本地群任务托管：只跟进已授权任务，不认领待办、不自动重试、不代替审批。 */
export class TaskSupervisor {
  private timer?: ReturnType<typeof setInterval>;
  private disposed = false;
  private sweepPending = false;
  constructor(private readonly deps: Deps) {}

  start(): void {
    if (this.disposed || this.timer) return;
    this.sweep();
    this.timer = setInterval(() => this.sweep(), 30_000);
    this.timer.unref?.();
  }

  dispose(): void {
    this.disposed = true;
    clearInterval(this.timer);
    this.timer = undefined;
  }

  scheduleSweep(): void {
    if (this.disposed || this.sweepPending) return;
    this.sweepPending = true;
    queueMicrotask(() => {
      this.sweepPending = false;
      this.sweep();
    });
  }

  /** 只从权威任务/执行/静默记录派生提醒；稳定时间线 id 同时作为跨重启去重标记。 */
  sweep(): void {
    if (this.disposed) return;
    try {
      this.scan();
    } catch (cause) {
      console.warn('[bots] task supervision scan failed', cause);
    }
  }

  private scan(): void {
    if (!this.deps.chats.list().some((chat) => !chat.parentId && this.enabled(chat.id))) return;
    const silent = new Set(this.deps.silences().map((item) => item.conversationId));
    const tasks = new Map<string, Map<string, GroupTask>>();
    for (const record of this.deps.delegations()) {
      if (!record.chatId || !record.taskId || record.depth !== 1) continue;
      if (
        record.state !== 'failed' &&
        record.state !== 'blocked' &&
        !(record.state === 'running' && silent.has(record.childConversationId))
      )
        continue;
      const root = this.enabled(record.chatId);
      if (!root) continue;
      let byId = tasks.get(root.id);
      if (!byId) {
        byId = new Map(this.deps.tasks.list(root.id).map((task) => [task.id, task]));
        tasks.set(root.id, byId);
      }
      const task = byId.get(record.taskId);
      if (!task || task.delegationId !== record.id || task.assigneeBotId !== record.targetBotId)
        continue;
      const en = this.deps.language?.() === 'en';
      let phase: string;
      let text: string;
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
      } else if (
        record.state === 'running' &&
        task.status === 'doing' &&
        silent.has(record.childConversationId)
      ) {
        phase = 'silence';
        text = en
          ? `Task #${task.seq} has produced no output for a while. Check the execution or stop it on the task card; no automatic restart was performed.`
          : `任务 #${task.seq} 已长时间没有输出。请在任务卡查看执行详情或停止处理；托管未自动重启任务。`;
      } else continue;
      this.notice(record.chatId, `task-supervision:${record.id}:${phase}`, text, true);
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
          : `任务 #${followup.seq} 当前没有可接收补充的委派执行。请到任务看板查看状态。`,
        false
      );
      return { ok: true as const };
    };
    const task = this.deps.tasks.list(root.id).find((item) => item.seq === followup.seq);
    if (!task?.delegationId || !task.assigneeBotId || !root.members.includes(task.assigneeBotId))
      return unavailable();
    const bot = this.deps.bots.get(task.assigneeBotId);
    if (!bot || bot.archivedAt !== undefined) return unavailable();
    const record = this.deps.delegations().find((item) => item.id === task.delegationId);
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
      result = await this.deps.tasks.reply(chatId, task.id, followup.text, {
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
    this.notice(chatId, noticeId, text, false);
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

  private notice(chatId: string, id: string, text: string, notify: boolean): void {
    try {
      if (!this.enabled(chatId) || this.deps.chats.findEntry(chatId, id)) return;
      const saved = this.deps.chats.appendEntry(chatId, {
        id,
        kind: 'system',
        at: Date.now(),
        text,
      });
      if (!saved) return;
      this.deps.emit({ kind: 'timeline', chatId, seq: saved.seq });
      if (notify) this.deps.notify(chatId, text);
    } catch (cause) {
      console.warn('[bots] task supervision notice failed', cause);
    }
  }
}
