import type {
  PairBotActivity,
  PairBotChatSummary,
  PairBotInboxItem,
  PairBotMember,
} from '@enso/pair';
import { CornerDownRight, MessageSquarePlus, UsersRound, Waypoints } from 'lucide-react';
import { useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { BotAvatar } from './BotAvatar';
import { botListRows } from './botList';
import { RoleChip } from './ChatRows';
import { PhoneTopBar } from './PhoneTopBar';
import { botTone, StatusGlyph } from './StatusGlyph';
import { usePhoneBack } from './usePhoneBack';

interface Props {
  bots: PairBotMember[];
  chats: PairBotChatSummary[];
  activeChatId: string | null;
  onSelect(chatId: string): void;
  onBack?(): void;
  onOpenComms?(chatId: string): void;
  connectionLabel?: string;
  /** 收件箱（未结束且未忽略）；提示类条目可忽略 */
  inbox?: PairBotInboxItem[];
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
  activities = [],
  onBack,
  onOpenComms,
  connectionLabel,
}: Props) {
  const [newOpen, setNewOpen] = useState(false);
  const [commsOpen, setCommsOpen] = useState(false);
  usePhoneBack(
    newOpen || commsOpen,
    () => {
      setNewOpen(false);
      setCommsOpen(false);
    },
    50
  );
  const byId = new Map(bots.map((bot) => [bot.id, bot]));
  const now = Date.now();
  const rows = botListRows(chats, bots, activities, inbox);
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <PhoneTopBar
        lead="back"
        onLead={onBack}
        title="Bot"
        detail={`${bots.filter((bot) => bot.status !== 'idle').length} 人在线 · ${rows.filter((row) => row.waiting).length} 条待处理`}
      >
        {connectionLabel && (
          <span className="max-w-32 truncate rounded-full bg-card2/70 px-2 py-1 text-[11px] font-medium text-ink2">
            {connectionLabel}
          </span>
        )}
      </PhoneTopBar>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-1 pb-28">
        {rows.length === 0 && (
          <p className="px-4 py-6 text-center text-[13px] text-dim">桌面端还没有 Bot 聊天</p>
        )}
        {/* 设计稿 bot.tsx 是一张纯聊天列表：「等你」只靠行内黄底 + 黄点表达，
            不再另开一块收件箱抢首屏（同一个信息出现两次） */}
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
                'flex w-full items-start gap-3 py-3 text-left transition-colors',
                row.chatId === activeChatId ? 'bg-card2' : 'active:bg-card2'
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
                  {tone === 'waiting' || tone === 'running' ? (
                    <span
                      className={cn(
                        'size-2 shrink-0 rounded-full',
                        tone === 'waiting' ? 'bg-yellow' : 'bg-blue'
                      )}
                    />
                  ) : (
                    <StatusGlyph tone={tone} size={14} />
                  )}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-page via-page/85 to-transparent" />
      <div className="phone-list-actions absolute right-4 flex items-center gap-3">
        <button
          type="button"
          aria-label="通信空间"
          onClick={() => setCommsOpen(true)}
          className="glass flex size-14 items-center justify-center rounded-full text-ink"
        >
          <Waypoints className="size-6" />
        </button>
        <button
          type="button"
          onClick={() => setNewOpen(true)}
          className="glass-ink flex h-14 items-center gap-2 rounded-full px-5 text-[15px] font-medium"
        >
          <MessageSquarePlus className="size-5" />
          新聊天
        </button>
      </div>
      <Sheet
        open={newOpen || commsOpen}
        onOpenChange={(next) => {
          if (!next) {
            setNewOpen(false);
            setCommsOpen(false);
          }
        }}
      >
        <SheetContent side="bottom" className="phone-sheet pb-safe" showCloseButton={false}>
          <SheetHeader className="px-5 pt-5 pb-3">
            <SheetTitle className="text-[17px] leading-[22px] font-semibold">
              {commsOpen ? '通信空间' : '新聊天'}
            </SheetTitle>
          </SheetHeader>
          <div className="max-h-[65dvh] overflow-y-auto px-5 pb-4">
            {!commsOpen && (
              <>
                <div className="flex items-center gap-3 rounded-[16px] bg-card px-3.5 py-3">
                  <span className="flex size-10 items-center justify-center rounded-full bg-card2">
                    <UsersRound className="size-5" />
                  </span>
                  <div className="text-[15px] font-medium">
                    新建群聊
                    <p className="text-[12px] font-normal text-dim">请在桌面端创建和管理成员</p>
                  </div>
                </div>
                <p className="pt-4 pb-2 text-[13px] font-medium text-dim">找人单聊</p>
              </>
            )}
            {commsOpen
              ? chats
                  .filter((chat) => chat.kind === 'group')
                  .map((chat) => (
                    <button
                      key={chat.id}
                      type="button"
                      onClick={() => {
                        setCommsOpen(false);
                        onOpenComms?.(chat.id);
                      }}
                      disabled={!onOpenComms}
                      className="flex w-full items-center gap-3 py-3 text-left text-[15px] font-medium"
                    >
                      <Waypoints className="size-5 text-dim" />
                      {chat.title}
                    </button>
                  ))
              : bots
                  .filter((bot) => !bot.archived)
                  .map((bot) => {
                    const direct = chats.find(
                      (chat) => chat.kind === 'direct' && chat.members.includes(bot.id)
                    );
                    return (
                      <button
                        key={bot.id}
                        type="button"
                        disabled={!direct}
                        onClick={() => {
                          if (direct) {
                            setNewOpen(false);
                            onSelect(direct.id);
                          }
                        }}
                        className="flex w-full items-center gap-3 py-2.5 text-left disabled:opacity-50"
                      >
                        <span className="[&>span]:size-[38px]">
                          <BotAvatar bot={bot} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5 text-[15px] leading-[21px] font-medium">
                            {bot.name}
                            <RoleChip>{bot.title}</RoleChip>
                          </span>
                          <span className="block text-[12px] leading-4 text-dim">
                            {direct ? '继续聊天' : '先在桌面端发起单聊'}
                          </span>
                        </span>
                      </button>
                    );
                  })}
            {commsOpen && !chats.some((chat) => chat.kind === 'group') && (
              <p className="py-6 text-[13px] text-dim">还没有群聊通信</p>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
