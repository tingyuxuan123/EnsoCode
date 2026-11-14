import type { PairBotMember } from '@enso/pair';
import { ChevronRight, CircleCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import { BotAvatar } from './BotAvatar';
import type { RowActivity } from './groupRows';

/**
 * 时间线里只允许四种权重的行（设计稿「消息分层」）：
 * L1 人说的话、L2 一轮的结论、L3 工作过程的活动行、L4 机器信息（进详情）。
 * 这里放 L3 活动行与段头摘要。
 */

/** 一段工作的折叠行：默认只给「做了多少、结果如何」，点开才是每一步。 */
export function ActivityRow({
  activity,
  live = false,
  onOpen,
}: {
  activity: RowActivity;
  live?: boolean;
  onOpen?(): void;
}) {
  const parts = [`${activity.steps} 步`];
  if (activity.delegations > 0) parts.push(`委派 ${activity.delegations} 次`);
  const summary = parts.join(' · ');
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={!onOpen}
      className="flex w-full items-center gap-2 rounded-[14px] bg-card2/70 px-3 py-2.5 text-left text-[13px] leading-[18px] text-dim disabled:cursor-default"
    >
      {live ? (
        <span className="size-3.5 shrink-0 animate-spin rounded-full border-2 border-blue/25 border-t-blue" />
      ) : (
        <CircleCheck className="size-4 shrink-0" aria-hidden />
      )}
      <span className="min-w-0 flex-1 truncate">{summary}</span>
      {activity.state && (
        <span className="shrink-0 text-[11px] leading-4 text-ink2">{activity.state}</span>
      )}
      {onOpen && <ChevronRight className="size-4 shrink-0 text-faint" aria-hidden />}
    </button>
  );
}

/** 时间轴分段：一段对话只留一行摘要，长线程才有呼吸。不画线，靠留白。 */
export function SegmentLead({ children }: { children: string }) {
  return <p className="py-3.5 text-center text-[11px] leading-4 text-faint">{children}</p>;
}

/** 一个 Bot 的一句话回执（扇出的结果）：头像 + 名字 + 一句结论。 */
export function ReplyBrief({
  name,
  text,
  bot,
}: {
  name: string;
  text: string;
  bot?: PairBotMember;
}) {
  return (
    <div className="flex items-start gap-2.5 px-3 py-2.5">
      <BotAvatar bot={bot} size="sm" />
      <p className="min-w-0 flex-1 text-[13px] leading-[19px]">
        <span className="font-medium">{name}</span>
        <span className="text-dim">：{text}</span>
      </p>
    </div>
  );
}

/** 角色胶囊：项目经理、全栈那种身份标签。 */
export function RoleChip({ children }: { children: ReactNode }) {
  return (
    <span className="shrink-0 rounded-full bg-card2 px-1.5 py-0.5 text-[11px] leading-4 font-medium text-dim">
      {children}
    </span>
  );
}

/** 一轮回复的抬头：头像、名字；时间戳一律靠右、11px。 */
export function SayHead({ name, bot, time }: { name: string; bot?: PairBotMember; time: string }) {
  return (
    <div className="flex items-center gap-2">
      <BotAvatar bot={bot} size="xs" />
      <span className="text-[15px] leading-5 font-semibold">{name}</span>
      <div className="flex-1" />
      <span className="shrink-0 text-[11px] leading-4 text-faint tabular-nums">{time}</span>
    </div>
  );
}
