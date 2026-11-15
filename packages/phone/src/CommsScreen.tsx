import type { PairBotMember, PairGroupEntry } from '@enso/pair';
import { ArrowRight } from 'lucide-react';
import { BotAvatar } from './BotAvatar';
import { commsRows } from './commsRows';
import { PhoneTopBar } from './PhoneTopBar';

/**
 * 通信空间（设计稿 `bot-comms.tsx`）：群里的委派来去，只读。
 * 只展示摘要与结果，不下发本机路径和原始指令。
 */
export function CommsScreen({
  title,
  entries,
  bots,
  onBack,
  now = Date.now(),
}: {
  title: string;
  entries: readonly PairGroupEntry[];
  bots: ReadonlyMap<string, PairBotMember>;
  onBack(): void;
  now?: number;
}) {
  const rows = commsRows(entries, bots, now);
  return (
    <div className="phone-chat-root flex h-full min-h-0 flex-col">
      <PhoneTopBar
        lead="back"
        onLead={onBack}
        title="通信空间"
        detail={`只读 · ${rows.length} 条`}
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-1">
        <p className="pb-3 text-[12px] leading-4 text-dim">
          这是 Bot 之间的来去。只给你看谁让谁做了什么、结果如何；原始指令和本机路径留在电脑上。
        </p>
        {rows.length === 0 ? (
          <p className="py-10 text-center text-[13px] leading-5 text-dim">
            这个群里还没有 Bot 之间的转达。
          </p>
        ) : (
          <div className="flex flex-col gap-2.5">
            {rows.map((row) => (
              <div key={row.key} className="rounded-[18px] bg-card p-3.5">
                <div className="flex items-center gap-1.5 text-[11px] leading-4 text-faint">
                  <span className="[&>span]:size-[18px]">
                    <BotAvatar bot={bots.get(row.fromId)} size="xs" />
                  </span>
                  <span className="text-ink2">{row.fromName}</span>
                  <ArrowRight className="size-3 shrink-0" aria-hidden />
                  <span className="[&>span]:size-[18px]">
                    <BotAvatar bot={bots.get(row.toId)} size="xs" />
                  </span>
                  <span className="text-ink2">{row.toName}</span>
                  <div className="flex-1" />
                  {row.live && <span className="size-1.5 rounded-full bg-blue" />}
                  <span className="tabular-nums">{row.state}</span>
                </div>
                <p className="mt-2 text-[14px] leading-5 font-medium">{row.task}</p>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="shrink-0 px-5 pt-2 pb-10">
        <p className="text-[11px] leading-4 text-faint">只读。要改指令，回单聊跟发起人说。</p>
      </div>
      <span className="sr-only">{title}</span>
    </div>
  );
}
