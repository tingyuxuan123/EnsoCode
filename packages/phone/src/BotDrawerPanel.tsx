import type {
  PairBotActivity,
  PairBotChatSummary,
  PairBotInboxItem,
  PairBotMember,
} from '@enso/pair';
import { CornerDownRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { BotAvatar } from './BotAvatar';
import { botListRows } from './botList';
import { inboxLabel } from './botState';
import { RoleChip } from './ChatRows';
import { botTone, StatusGlyph } from './StatusGlyph';

interface Props {
  bots: PairBotMember[];
  chats: PairBotChatSummary[];
  activeChatId: string | null;
  onSelect(chatId: string): void;
  /** 收件箱（未结束且未忽略）；提示类条目可忽略 */
  inbox?: PairBotInboxItem[];
  onDismiss?(key: string): void;
  /** 成员实时运行态：有就替换聊天行的末条摘要 */
  activities?: PairBotActivity[];
}

function relativeTime(at: number, now: number): string {
  const diff = Math.max(0, now - at);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return '现在';
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时`;
  const days = Math.floor(hours / 24);
  return days === 1 ? '昨天' : `${days} 天前`;
}

/**
 * 抽屉「Bot」分段：人和群合成一张表，谁最后说话谁在上面（设计稿 `bot.tsx`）。
 * 行的第二行是最后一句；Bot 之间的转达在句首加「来自 X」，不另开一屏。
 * 新建成员 / 群聊、例行任务仍在桌面端管理。
 */
export function BotDrawerPanel({
  bots,
  chats,
  activeChatId,
  onSelect,
  inbox = [],
  onDismiss,
  activities = [],
}: Props) {
  const byId = new Map(bots.map((bot) => [bot.id, bot]));
  const now = Date.now();
  const rows = botListRows(chats, bots, activities, inbox);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto pb-4">
        {rows.length === 0 && (
          <p className="px-4 py-6 text-center text-[13px] text-dim">桌面端还没有 Bot 聊天</p>
        )}
        {/* 收件箱：等你处理的那些事（无视会消失的提示类可忽略） */}
        {inbox.length > 0 && (
          <div className="pb-1">
            <p className="px-4 pt-2 pb-1 text-[13px] leading-[18px] font-medium text-dim">
              等你处理 · {inbox.length}
            </p>
            {inbox.map((item) => {
              const member = item.botId ? byId.get(item.botId) : undefined;
              const owner = item.ownerBotId ? byId.get(item.ownerBotId) : undefined;
              return (
                <div key={item.key} className="flex items-center gap-2 py-1.5 pr-2 pl-4">
                  <button
                    type="button"
                    disabled={!item.chatId}
                    onClick={() => item.chatId && onSelect(item.chatId)}
                    className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                  >
                    <BotAvatar bot={member} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] leading-[19px] font-medium">
                        {member?.name ?? '成员'}
                        {owner ? ` 替 ${owner.name}` : ''}
                        <span className="ml-1.5 font-normal text-[11px] text-yellow-ink">
                          {inboxLabel(item, Date.now())}
                        </span>
                      </span>
                      <span className="block truncate text-[12px] leading-4 text-dim">
                        {item.text || '\u00a0'}
                      </span>
                    </span>
                  </button>
                  {item.dismissible && onDismiss && (
                    <button
                      type="button"
                      onClick={() => onDismiss(item.key)}
                      className="shrink-0 rounded-full bg-card2 px-2.5 py-1 text-[11px] font-medium text-dim"
                    >
                      忽略
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {rows.map((row) => {
          const member = row.kind === 'direct' ? byId.get(row.members[0]) : undefined;
          const tone = botTone(
            row.running
              ? 'running'
              : (chats.find((chat) => chat.id === row.chatId)?.status ?? 'idle'),
            row.waiting
          );
          const stacked = row.kind === 'group' ? row.members.slice(0, 2) : [];
          return (
            <button
              key={row.chatId}
              type="button"
              onClick={() => onSelect(row.chatId)}
              className={cn(
                'flex w-full items-start gap-3 py-3 pr-2 pl-4 text-left transition-colors',
                row.waiting
                  ? 'bg-[color-mix(in_srgb,var(--yellow)_9%,transparent)]'
                  : row.chatId === activeChatId
                    ? 'bg-card2'
                    : 'active:bg-card2'
              )}
            >
              {member ? (
                <BotAvatar bot={member} size="lg" busy={row.running} />
              ) : (
                <span className="relative flex h-10 w-10 shrink-0 items-center">
                  <span className="flex -space-x-3">
                    {stacked.map((id) => (
                      <BotAvatar key={id} bot={byId.get(id)} size="xs" />
                    ))}
                  </span>
                  {row.members.length > 2 && (
                    <span className="absolute -right-0.5 -bottom-1 rounded-full border-2 border-page bg-card2 px-1 text-[11px] leading-4 font-medium text-dim">
                      +{row.members.length - 2}
                    </span>
                  )}
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span
                    className={cn(
                      'min-w-0 truncate text-[16px] leading-[22px]',
                      row.waiting ? 'font-semibold' : 'font-medium'
                    )}
                  >
                    {row.title}
                  </span>
                  {row.kind === 'group' && <RoleChip>群聊</RoleChip>}
                  <div className="flex-1" />
                  <span className="shrink-0 text-[11px] leading-4 text-faint tabular-nums">
                    {relativeTime(row.activityAt, now)}
                  </span>
                </span>
                <span className="mt-0.5 flex items-center gap-2">
                  {row.via ? (
                    <span className="flex min-w-0 flex-1 items-center gap-1">
                      <CornerDownRight className="size-3.5 shrink-0 text-faint" aria-hidden />
                      <span className="min-w-0 truncate text-[13px] leading-[18px] text-dim">
                        <span className="text-ink2">来自 {row.via}</span>：{row.preview}
                      </span>
                    </span>
                  ) : (
                    <span className="min-w-0 flex-1 truncate text-[13px] leading-[18px] text-dim">
                      {row.preview}
                    </span>
                  )}
                  <StatusGlyph tone={tone} size={14} />
                </span>
              </span>
            </button>
          );
        })}
      </div>
      <p className="shrink-0 px-4 py-2 text-center text-[11px] leading-4 text-faint pb-safe">
        新建成员 / 群聊、例行任务请在桌面端管理
      </p>
    </div>
  );
}
