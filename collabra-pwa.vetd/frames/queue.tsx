export const frame = { width: 402, height: 874, radius: 62, title: "排队消息" };

import { StatusBar } from "@vetta/ios";
import { Composer } from "../components/Composer";
import { TopBar } from "../components/TopBar";
import { Prose, Steps, TurnHead, UserBubble } from "../components/Turn";

const queued = [
	{ text: "顺便看一下缓存命中率", mine: true, edited: false },
	{ text: "再补一个 e2e，别只测 reducer", mine: true, edited: true },
];

// 排队消息：agent 干活时先入队，摆在输入框上方。每条可改、可立刻插进当前轮、可删。
export default function Queue() {
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
			<div className="min-h-0 flex-1 overflow-hidden px-5 pt-1">
				<UserBubble>恢复会话后时间线是空的，帮我查根因。</UserBubble>
				<article className="flex flex-col gap-2.5">
					<TurnHead
						time="正在回复"
						live="跑测试 · 2:08"
					/>
					<Steps live>bash: pnpm test -- sessionReducer</Steps>
					<Prose>
						<p>断线恢复时把 lastSeq 重置放进回放第一条事件，过期判定只对实时事件生效。</p>
					</Prose>
				</article>
			</div>
			<div className="shrink-0 px-3 pb-1">
				<p className="pb-1.5 text-[11px] leading-4 text-dim">2 条排队 · 本轮结束后自动发送</p>
				<div className="flex flex-col gap-1.5">
					{queued.map((q) => (
						<div
							key={q.text}
							className="flex items-center gap-2 rounded-[14px] bg-card px-3 py-2.5"
						>
							<span className="min-w-0 flex-1 truncate text-[13px] leading-[18px]">{q.text}</span>
							{q.edited && (
								<span className="shrink-0 text-[11px] leading-4 text-faint">已改</span>
							)}
							<span className="flex shrink-0 items-center gap-2.5 text-ink2">
								<span className="icon-[lucide--pencil] size-4" />
								<span className="icon-[lucide--send] size-4" />
								<span className="icon-[lucide--x] size-4 text-faint" />
							</span>
						</div>
					))}
				</div>
			</div>
			<Composer
				running
				meta={{ context: 44, tokens: "14.2k", cache: "89%", speed: "36 t/s" }}
			/>
		</div>
	);
}
