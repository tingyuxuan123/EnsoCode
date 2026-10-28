export const frame = { width: 390, height: 844, title: "手机 · Bot 成员与群组" };

import { Link } from 'react-router';
import { Avatar } from '../components/bot/BotShell';
import { groups, members } from '../components/bot/data';

/** 手机 Bot（GroupChatScreen + BotDrawerPanel）：成员/群组列表、话题、发件箱、交付物、侧栏配置 */
export default function PhoneBots() {
  return (
    <div className="flex h-full flex-col bg-surface">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-3">
        <span className="text-[14px] font-semibold">Bot</span>
        <span className="rounded-full bg-primary px-1.5 text-[11px] text-primary-foreground">5</span>
        <Link to="/phone-sessions" className="ml-auto text-[12px] text-muted">编程</Link>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        <p className="px-1 pb-1 text-[11px] text-faint">群组</p>
        {groups.map((group) => (
          <Link key={group.id} to="/phone-bots" className="flex min-h-11 items-center gap-2 rounded-control px-2 hover:bg-hover">
            <span className="icon-[lucide--users] size-4 text-muted" />
            <span className="min-w-0 flex-1 truncate text-[13px]">{group.name}</span>
            {group.unread ? <span className="rounded-full bg-primary px-1.5 text-[11px] text-primary-foreground">{group.unread}</span> : null}
          </Link>
        ))}
        <p className="px-1 pb-1 pt-2 text-[11px] text-faint">成员</p>
        {members.map((member) => (
          <Link key={member.id} to="/phone-bots" className="flex min-h-11 items-center gap-2 rounded-control px-2 hover:bg-hover">
            <Avatar member={member} size="sm" />
            <span className="min-w-0 flex-1 truncate text-[13px]">{member.name}</span>
            <span className="shrink-0 text-[11px] text-muted">{member.status[0]}</span>
          </Link>
        ))}
        <div className="mt-2 rounded-control border border-warning/40 bg-warning-soft px-3 py-2 text-[11.5px] leading-5">
          小满 需要你处理：要不要把上一代产品也算进来？<span className="ml-1 text-primary">回复</span>
        </div>
      </div>
      <div className="shrink-0 border-t border-line px-3 py-2">
        <div className="flex items-center gap-2 rounded-[14px] border border-border bg-input px-2 py-1.5">
          <span className="icon-[lucide--at-sign] size-4 text-muted" />
          <span className="flex-1 text-[12px] text-faint">@ 成员，或直接说…</span>
          <button className="flex size-8 items-center justify-center rounded-[10px] bg-primary text-primary-foreground"><span className="icon-[lucide--arrow-up] size-4" /></button>
        </div>
        <p className="mt-1 text-center text-[10px] text-faint">不 @ 时智能选出最合适的成员回复</p>
      </div>
    </div>
  );
}
