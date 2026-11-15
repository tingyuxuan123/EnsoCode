export const frame = { width: 402, height: 874, radius: 62, title: "审批" };

import { StatusBar } from "@vetta/ios";
import { TopBar } from "../components/TopBar";
import { Prose, Steps, TurnHead, UserBubble } from "../components/Turn";

// 审批：玻璃面板顶替输入框，命令、影响范围和三个决定都在一张卡里。
export default function Approval() {
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
			<div className="min-h-0 flex-1 overflow-hidden px-5 pt-2">
				<UserBubble>恢复会话后时间线是空的，但 jsonl 里明明有记录。帮我查根因，修好并补测试。</UserBubble>
				<article className="flex flex-col gap-2.5">
					<TurnHead time="3 分钟前" />
					<Steps>已完成 7 步 · 读了 5 个文件</Steps>
					<Prose>
						<p>改完了，回归要跑测试。这条命令会占用约 40 秒，不写文件。</p>
					</Prose>
					<div className="flex items-center gap-2.5 rounded-2xl bg-card px-3.5 py-3">
						<span className="icon-[lucide--terminal] size-4 text-dim" />
						<span className="min-w-0 flex-1 truncate font-mono text-[13px]">
							bash<span className="text-dim">: pnpm test -- sessionReducer</span>
						</span>
						<span className="rounded-full bg-yellow/15 px-2.5 py-1 text-[11px] leading-[14px] font-medium text-yellow-ink">
							等你批准
						</span>
					</div>
				</article>
			</div>
			<section className="glass relative mx-3 mb-7 rounded-[26px] p-4">
				<div className="flex items-center gap-2">
					<span className="icon-[lucide--circle-help] size-[18px] animate-pulse text-yellow" />
					<h2 className="flex-1 text-[15px] leading-5 font-semibold">它想运行一条命令</h2>
					<span className="flex items-center gap-1 text-[12px] leading-4 text-dim tabular-nums">
						<span className="icon-[lucide--timer] size-3.5" />
						42 秒
					</span>
				</div>
				<div className="mt-3 rounded-[14px] bg-card2 px-3.5 py-3 font-mono text-[14px] leading-5">
					<span className="text-dim">$ </span>
					pnpm test -- sessionReducer
				</div>
				<p className="mt-2 px-0.5 text-[12px] leading-4 text-dim">
					在 EnsoCode 中执行 · 只读，不会改动文件
				</p>
				<div className="mt-4 flex gap-2.5">
					<button className="glass h-12 flex-1 rounded-full text-[15px] font-medium">拒绝</button>
					<button className="glass-ink flex h-12 flex-[1.4] items-center justify-center gap-2 rounded-full text-[15px] font-medium">
						<span className="icon-[lucide--check] size-5" />
						允许
					</button>
				</div>
				<button className="mt-2 w-full py-2 text-[14px] leading-5 font-medium text-ink2">
					本会话总是允许
				</button>
			</section>
		</div>
	);
}
