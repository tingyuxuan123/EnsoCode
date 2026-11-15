export const frame = { width: 402, height: 874, radius: 62, title: "只读设备" };

import { StatusBar } from "@vetta/ios";
import { TopBar } from "../components/TopBar";
import { Code, Prose, Steps, TurnHead, UserBubble } from "../components/Turn";

// 只读设备：整屏照常能看，唯一区别是输入区被锁住，顶部一条横幅说清原因和出口。
// 文件名不用 readonly：那个 id 和引擎内部的只读路由撞了，帧会回落成第一屏。
export default function Readonly() {
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
			<div className="mx-5 mb-2 flex items-start gap-2 rounded-[14px] bg-card2 px-3 py-2.5">
				<span className="icon-[lucide--lock] mt-0.5 size-3.5 shrink-0 text-dim" />
				<p className="min-w-0 flex-1 text-[12px] leading-[18px] text-ink2">
					此设备为只读，只能查看；可在桌面「设置 → 设备」切换为可操作。
				</p>
			</div>
			<div className="min-h-0 flex-1 overflow-hidden px-5 pt-1">
				<UserBubble>恢复会话后时间线是空的，帮我查根因。</UserBubble>
				<article className="flex flex-col gap-2.5">
					<TurnHead time="3 分钟前" />
					<Steps>已完成 7 步 · 读了 5 个文件</Steps>
					<Prose>
						<p>
							根因在 reducer：恢复时 worker 从 <Code>seq 1</Code> 回放，而 store 还留着旧的{" "}
							<Code>lastSeq = 412</Code>。
						</p>
					</Prose>
				</article>
			</div>
			<div className="relative shrink-0 px-3 pt-2 pb-7">
				<div className="flex items-end gap-2">
					<div className="flex h-12 flex-1 items-center rounded-3xl border border-line bg-card2 px-4">
						<span className="text-[16px] leading-[22px] text-faint">只读设备，不能发送</span>
					</div>
					<span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-card2 text-faint">
						<span className="icon-[lucide--arrow-up] size-[22px]" />
					</span>
				</div>
				<p className="mt-2.5 text-center text-[11px] leading-4 text-faint">
					发送被拦下时会提示「刚才的操作未执行」
				</p>
			</div>
		</div>
	);
}
