export const frame = { width: 412, height: 915, title: "后台与协作" };

import type { ReactNode } from "react";
import { StatusBar } from "@vetta/ios";
import { AgentAvatar, RunningMark } from "../components/Eaves";
import { TopBar } from "../components/TopBar";

function Group({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
	return (
		<section className="pt-5">
			<h2 className="flex items-baseline gap-2 px-5 pb-2 text-[15px] leading-5 font-semibold text-dim">
				{title}
				{note && <span className="text-[12px] font-normal text-faint">{note}</span>}
			</h2>
			<div className="mx-3 overflow-hidden rounded-[20px] bg-card">{children}</div>
		</section>
	);
}

function Stop({ label = "停止" }: { label?: string }) {
	return (
		<button className="flex h-8 shrink-0 items-center gap-1 rounded-full bg-red/[0.08] px-3 text-[13px] font-medium text-red">
			<span className="icon-[mdi--stop] size-3.5" />
			{label}
		</button>
	);
}

const line = "shadow-[inset_0_0.75px_0_var(--color-line)]";

/**
 * 一个会话派出去的东西：子代理（可停）、coworker（只看，手机不雇不解雇）、
 * 后台任务（可停，能看最后几行输出）。
 */
export default function Tasks() {
	return (
		<div className="relative flex h-full flex-col overflow-hidden bg-page">
			<StatusBar
				variant="flat"
				tone="dark"
			/>
			<TopBar
				lead="back"
				to="/queue"
				title="后台与协作"
				detail="工作流面板显示运行进度"
			/>
			<div className="min-h-0 flex-1 overflow-hidden pb-8">
				<Group
					title="子代理"
					note="停止不影响主会话"
				>
					<div className="flex items-center gap-3 px-4 py-3">
						<AgentAvatar
							size={28}
							working
						/>
						<div className="min-w-0 flex-1">
							<div className="truncate text-[15px] leading-5 font-medium">调研 IPC 通道注册方式</div>
							<div className="truncate text-[12px] leading-4 text-dim tabular-nums">scout · DeepSeek V4.1 Flash · 1 分 12 秒</div>
						</div>
						<Stop />
					</div>
					<div className={`flex items-center gap-3 px-4 py-3 ${line}`}>
						<AgentAvatar
							size={28}
							working
						/>
						<div className="min-w-0 flex-1">
							<div className="truncate text-[15px] leading-5 font-medium">性能审查</div>
							<div className="truncate text-[12px] leading-4 text-dim tabular-nums">reviewer · Claude Opus 5.5 · 3 分 40 秒</div>
						</div>
						<Stop />
					</div>
					<div className={`flex items-center gap-3 px-4 py-3 ${line}`}>
						<span className="flex size-7 shrink-0 items-center justify-center">
							<span className="icon-[lucide--circle-check] size-5 text-green" />
						</span>
						<div className="min-w-0 flex-1">
							<div className="truncate text-[15px] leading-5 font-medium text-ink2">正确性审查</div>
							<div className="truncate text-[12px] leading-4 text-dim">reviewer · 完成 · 用时 48 秒</div>
						</div>
						<button className="flex h-8 shrink-0 items-center gap-1 px-1 text-[13px] text-ink2">
							报告
							<span className="icon-[lucide--chevron-right] size-4" />
						</button>
					</div>
				</Group>

				<Group
					title="Coworker"
					note="在电脑上雇用和解雇"
				>
					<div className="flex items-center gap-3 px-4 py-3">
						<span className="flex size-7 shrink-0 items-center justify-center">
							<RunningMark size={12} />
						</span>
						<div className="min-w-0 flex-1">
							<div className="truncate text-[15px] leading-5 font-medium">安全审查</div>
							<div className="truncate text-[12px] leading-4 text-dim">独立会话 · 跟随主会话模型 · 第 2 轮</div>
						</div>
						<button className="flex h-8 shrink-0 items-center gap-1 px-1 text-[13px] text-ink2">
							打开
							<span className="icon-[lucide--chevron-right] size-4" />
						</button>
					</div>
				</Group>

				<Group title="后台任务">
					<div className="px-4 pt-3 pb-3.5">
						<div className="flex items-center gap-3">
							<span className="size-2 shrink-0 rounded-full bg-green" />
							<span className="min-w-0 flex-1 truncate font-mono text-[13.5px]">pnpm dev</span>
							<span className="shrink-0 text-[12px] leading-4 text-dim tabular-nums">2 小时</span>
							<Stop />
						</div>
						<pre className="mt-2.5 overflow-hidden rounded-[12px] bg-card2 px-3 py-2 font-mono text-[11.5px] leading-[18px] text-ink2">
							{`VITE v7.3.6  ready in 698 ms
➜  Local:   http://localhost:5173/
14:21:08 [vite] hmr update /src/WorkflowPanel.tsx`}
						</pre>
					</div>
					<div className={`flex items-center gap-3 px-4 py-3.5 ${line}`}>
						<span className="size-2 shrink-0 rounded-full bg-green" />
						<span className="min-w-0 flex-1 truncate font-mono text-[13.5px]">vitest --watch</span>
						<span className="shrink-0 text-[12px] leading-4 text-dim tabular-nums">48 分钟</span>
						<Stop />
					</div>
				</Group>
			</div>
		</div>
	);
}
