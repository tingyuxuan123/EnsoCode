export const frame = { width: 402, height: 874, radius: 62, title: "失败重试" };

import { StatusBar } from "@vetta/ios";
import { Composer } from "../components/Composer";
import { TopBar } from "../components/TopBar";
import { Prose, Steps, TurnHead, UserBubble } from "../components/Turn";

// 一轮失败：错误就地说明白，给重试和「取消自动重试」两个选择，不弹窗。
export default function Retry() {
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
					<TurnHead time="4 分钟前" />
					<Steps>已完成 2 步 · 读了 3 个文件</Steps>
					<Prose>
						<p>先看 reducer 里 seq 的比对逻辑，再看恢复时的事件回放顺序。</p>
					</Prose>
				</article>
				<div className="mt-3 flex flex-col gap-2.5 rounded-[16px] bg-red/5 px-3.5 py-3 shadow-[inset_0_0_0_1px_rgb(220_38_38/0.18)]">
					<div className="flex items-start gap-2">
						<span className="icon-[lucide--triangle-alert] mt-0.5 size-4 shrink-0 text-red" />
						<p className="min-w-0 flex-1 text-[13px] leading-[19px] text-ink2">
							provider 返回 429：请求太频繁。这一轮没有产出，可以重试。
						</p>
					</div>
					<div className="flex items-center gap-3 pl-6">
						<button className="flex h-9 items-center rounded-full bg-pill px-4 text-[13px] font-medium text-pill-ink">
							重试
						</button>
						<span className="text-[12px] leading-4 text-dim tabular-nums">8 秒后自动重试</span>
						<div className="flex-1" />
						<span className="text-[12px] leading-4 font-medium text-ink2">取消</span>
					</div>
				</div>
			</div>
			<Composer meta={{ context: 19, tokens: "5.2k", cache: "96%", speed: "—" }} />
		</div>
	);
}
