export const frame = { width: 402, height: 874, radius: 62, title: "目标与后台" };

import { StatusBar } from "@vetta/ios";
import { Composer } from "../components/Composer";
import { TopBar } from "../components/TopBar";
import { Prose, Steps, TurnHead, UserBubble } from "../components/Turn";

// 会话头部常驻的两条：目标（可暂停/清除）和后台任务（可停）。都只占一行，能折叠。
export default function SessionBars() {
	return (
		<div className="relative flex h-full flex-col overflow-hidden bg-page">
			<StatusBar
				variant="island"
				tone="dark"
			/>
			<TopBar
				lead="drawer"
				to="/sessions"
				title="恢复会话后时间线为空"
				detail="EnsoCode · Sonnet 4.6 · 思考 高"
				menu
			/>
			<div className="flex flex-col gap-2 px-5 pb-2">
				<div className="flex items-center gap-2.5 rounded-[14px] bg-card px-3 py-2.5">
					<span className="icon-[lucide--target] size-4 shrink-0 text-ink2" />
					<div className="min-w-0 flex-1">
						<p className="truncate text-[13px] leading-[18px] font-medium">
							把 Bot 区块改成一张聊天列表
						</p>
						<p className="text-[11px] leading-4 text-dim tabular-nums">第 3 / 5 步 · 正在改列表</p>
					</div>
					<span className="icon-[lucide--pause] size-4 shrink-0 text-ink2" />
					<span className="icon-[lucide--x] size-4 shrink-0 text-faint" />
				</div>
				<div className="flex items-center gap-2.5 rounded-[14px] bg-card2 px-3 py-2">
					<span className="icon-[lucide--terminal] size-3.5 shrink-0 text-dim" />
					<p className="min-w-0 flex-1 truncate text-[12px] leading-4 text-dim">
						后台 1 个在跑 · pnpm test -- sessionReducer
					</p>
					<span className="shrink-0 text-[12px] leading-4 font-medium text-ink2">停止</span>
				</div>
			</div>
			<div className="min-h-0 flex-1 overflow-hidden px-5 pt-1">
				<UserBubble>Bot 那页太乱了，能不能像正常聊天一样。</UserBubble>
				<article className="flex flex-col gap-2.5">
					<TurnHead time="6 分钟前" />
					<Steps>已完成 4 步 · 改了 3 个文件</Steps>
					<Prose>
						<p>改成一张列表了：人和群按最后说话时间排，转达只在句首加一句「来自 X」。</p>
					</Prose>
				</article>
			</div>
			<Composer meta={{ context: 27, tokens: "8.6k", cache: "94%", speed: "44 t/s" }} />
		</div>
	);
}
