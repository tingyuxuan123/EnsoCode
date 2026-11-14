import type {
  PairBotActivity,
  PairBotChatSummary,
  PairBotInboxItem,
  PairBotMember,
} from '@enso/pair';
import { activityLine, chatActivities } from './botState';

/**
 * Bot 区块只剩一张表：人和群排在一起，谁最后说话谁在上面（设计稿 `bot.tsx`）。
 * 第二行是最后一句；Bot 之间的转达在句首加「来自 X」，不另开一屏。
 */
export interface BotListRow {
  chatId: string;
  kind: 'direct' | 'group';
  title: string;
  /** 私聊成员职位（名册里有，列表行只在名字后放一枚小胶囊） */
  role?: string;
  /** 第二行：最后一句 / 正在做什么 / 状态 */
  preview: string;
  /** 「来自 X」：跨聊天的委派来源。协议目前只下发同聊天内的委派，故通常为空 */
  via?: string;
  /** 排序与右侧时间用（host 时钟） */
  activityAt: number;
  /** 有一件事在等你（审批/提问/例行任务…） */
  waiting: boolean;
  running: boolean;
  /** 群聊：叠头像用成员 id；私聊：单个成员 */
  members: string[];
  pinned?: boolean;
}

const STATUS_TEXT = { running: '工作中', queued: '排队中', idle: '' } as const;

/** 收件箱里有待办的聊天（静默条目不算「等你」） */
export function waitingChatIds(inbox: readonly PairBotInboxItem[]): Set<string> {
  const ids = new Set<string>();
  for (const item of inbox) {
    if (item.kind === 'silence') continue;
    if (item.chatId) ids.add(item.chatId);
  }
  return ids;
}

/** 末条预览：群聊带「谁：」，私聊直接是内容 */
function lastPreview(chat: PairBotChatSummary, byId: ReadonlyMap<string, PairBotMember>): string {
  const last = chat.last;
  if (!last) return chat.kind === 'group' ? `${chat.members.length} 位成员` : '';
  const who = last.kind === 'human' ? '我' : last.botId ? (byId.get(last.botId)?.name ?? '') : '';
  return chat.kind === 'group' && who ? `${who}：${last.text}` : last.text;
}

/**
 * 合并人/群成一张表：
 * - 子话题（有 parentId）不单独成行，它们属于根群；
 * - 已归档的群、成员已归档/未知的私聊不出现；
 * - 置顶优先，其后按最后活跃倒序。
 */
export function botListRows(
  chats: readonly PairBotChatSummary[],
  bots: readonly PairBotMember[],
  activities: readonly PairBotActivity[] = [],
  inbox: readonly PairBotInboxItem[] = [],
  viaOf: (chat: PairBotChatSummary) => string | undefined = () => undefined
): BotListRow[] {
  const byId = new Map(bots.map((bot) => [bot.id, bot]));
  const active = new Set(bots.filter((bot) => !bot.archived).map((bot) => bot.id));
  const waiting = waitingChatIds(inbox);
  return chats
    .filter((chat) => {
      if (chat.parentId || chat.archived) return false;
      if (chat.kind === 'group') return true;
      const member = chat.members[0];
      return Boolean(member && active.has(member));
    })
    .map((chat): BotListRow => {
      const member = chat.kind === 'direct' ? byId.get(chat.members[0]) : undefined;
      const live = chatActivities(activities, chat.id)[0];
      const running = live ? live.state !== 'queued' : chat.status === 'running';
      let preview = '';
      if (live) {
        const line = activityLine(live);
        const who = chat.kind === 'group' && live.botId ? byId.get(live.botId)?.name : undefined;
        preview = who ? `${who}：${line}` : line;
      } else {
        preview = STATUS_TEXT[chat.status] || lastPreview(chat, byId) || member?.title || '';
      }
      const via = viaOf(chat);
      return {
        chatId: chat.id,
        kind: chat.kind,
        title: chat.kind === 'group' ? chat.title || '群聊' : (member?.name ?? chat.title),
        ...(member?.title ? { role: member.title } : {}),
        preview,
        ...(via ? { via } : {}),
        activityAt: chat.last?.at ?? chat.updatedAt,
        waiting: waiting.has(chat.id),
        running,
        members: chat.members,
        ...(chat.pinned ? { pinned: true } : {}),
      };
    })
    .sort(
      (a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || b.activityAt - a.activityAt
    );
}
