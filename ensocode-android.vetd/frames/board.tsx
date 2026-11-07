export const frame = { width: 412, height: 915, title: "任务看板" };

import { Link } from "react-router";
import { StatusBar } from "@vetta/ios";
import { AgentAvatar } from "../components/Eaves";
import { SessionMeta } from "../components/SessionMeta";
import { StatusGlyph } from "../components/StatusGlyph";
import { TopBar } from "../components/TopBar";

function GroupTitle({ title, count }: { title: string; count: number }) {
	return (
		<h2 className="flex items-baseline gap-2 px-5 pt-6 pb-1.5 text-[15px] leading-5 font-semibold text-dim">
			{title}
			<span className="text-[13px] font-normal text-faint tabular-nums">{count}</span>
		</h2>
	);
}

/** 任务看板：等你处理的在最上面，然后是运行中的会话、工作流、子代理和后台任务，最后是今天完成的。 */
export default function Board() {
	return (
		<div className="relative flex h-full flex-col overflow-hidden bg-page">
			<StatusBar
				variant="flat"
				tone="dark"
			/>
			<TopBar
				lead="back"
				to="/"
				title="任务看板"
				detail="2 个等你 · 3 个运行中 · 2 个后台"
			/>
			<div className="min-h-0 flex-1 overflow-hidden pb-8">
				<GroupTitle
					title="等你处理"
					count={2}
				/>
				<div className="bg-yellow/[0.09] px-5 py-3">
					<Link
						to="/session"
						className="flex items-start gap-2"
					>
						<div className="min-w-0 flex-1">
							<div className="truncate text-[16px] leading-[22px] font-medium">会话恢复后时间线为空</div>
							<div className="mt-0.5 truncate font-mono text-[12.5px] leading-[18px] text-ink2">请求运行 pnpm test -- sessionReducer</div>
						</div>
						<span className="flex h-[22px] shrink-0 items-center">
							<StatusGlyph status="waiting" />
						</span>
					</Link>
					<div className="mt-3 flex gap-2">
						<button className="h-9 rounded-full bg-pill px-4 text-[14px] font-medium text-pill-ink">允许</button>
						<button className="h-9 rounded-full bg-card px-4 text-[14px] font-medium">拒绝</button>
						<Link
							to="/session"
							className="ml-auto flex h-9 items-center gap-1 px-1 text-[14px] text-ink2"
						>
							打开
							<span className="icon-[lucide--chevron-right] size-4" />
						</Link>
					</div>
				</div>
				<Link
					to="/ask"
					className="flex items-start gap-2 bg-yellow/[0.09] px-5 py-3 shadow-[inset_0_0.75px_0_var(--color-line)]"
				>
					<div className="min-w-0 flex-1">
						<div className="truncate text-[16px] leading-[22px] font-medium">首页 Hero 用哪张截图</div>
						<div className="mt-0.5 truncate text-[13px] leading-[18px] text-ink2">它在问你：浅色还是深色截图？</div>
					</div>
					<span className="flex h-[22px] shrink-0 items-center">
						<StatusGlyph status="waiting" />
					</span>
				</Link>

				<GroupTitle
					title="运行中"
					count={3}
				/>
				<Link
					to="/queue"
					className="flex items-start gap-2 px-5 py-2.5"
				>
					<div className="min-w-0 flex-1">
						<div className="truncate text-[16px] leading-[22px] font-medium">工作流面板显示运行进度</div>
						<div className="mt-1 flex items-center gap-2 text-[12px] leading-4 text-ink2">
							<span className="icon-[lucide--workflow] size-3.5" />
							并行审查 · 2 / 3 个审查员完成
						</div>
						<div className="mt-2 flex gap-1">
							<span className="h-1 flex-1 rounded-full bg-ink2" />
							<span className="h-1 flex-1 rounded-full bg-ink2" />
							<span className="h-1 flex-1 animate-pulse rounded-full bg-blue/60" />
						</div>
						<div className="mt-1.5 flex gap-4 text-[12px] leading-4 text-dim">
							<span>正确性 ✓</span>
							<span>安全 ✓</span>
							<span className="text-blue">性能 · 审查中</span>
						</div>
					</div>
					<span className="flex h-[22px] shrink-0 items-center">
						<StatusGlyph status="running" />
					</span>
				</Link>
				<Link
					to="/goal"
					className="flex items-start gap-2 px-5 py-2.5"
				>
					<div className="min-w-0 flex-1">
						<div className="truncate text-[16px] leading-[22px] font-medium">Windows 版 CI 签名失败排查</div>
						<div className="mt-1 flex items-center gap-2 text-[12px] leading-4 text-ink2">
							<span className="icon-[lucide--target] size-3.5" />
							目标：windows-v0.9.5 CI 通过 · 第 4 轮
						</div>
					</div>
					<span className="flex h-[22px] shrink-0 items-center">
						<StatusGlyph status="running" />
					</span>
				</Link>
				<div className="flex items-start gap-2 py-2.5 pr-5 pl-5">
					<div className="flex h-[22px] shrink-0 items-center">
						<AgentAvatar
							size={20}
							working
						/>
					</div>
					<div className="min-w-0 flex-1">
						<div className="truncate text-[16px] leading-[22px] font-medium">调研 IPC 通道注册方式</div>
						<div className="mt-1 truncate text-[12px] leading-4 text-ink2">子代理 scout · 属于「工作流面板显示运行进度」</div>
					</div>
					<span className="flex h-[22px] shrink-0 items-center">
						<StatusGlyph status="running" />
					</span>
				</div>

				<GroupTitle
					title="后台任务"
					count={2}
				/>
				<div className="mx-3 overflow-hidden rounded-[20px] bg-card">
					<div className="flex items-center gap-3 px-4 py-3">
						<span className="size-2 shrink-0 rounded-full bg-green" />
						<span className="min-w-0 flex-1 truncate font-mono text-[13px]">pnpm dev</span>
						<span className="text-[12px] leading-4 text-dim">:5173 · 2 小时</span>
					</div>
					<div className="flex items-center gap-3 px-4 py-3 shadow-[inset_0_0.75px_0_var(--color-line)]">
						<span className="size-2 shrink-0 rounded-full bg-green" />
						<span className="min-w-0 flex-1 truncate font-mono text-[13px]">vitest --watch</span>
						<span className="text-[12px] leading-4 text-dim">48 分钟</span>
					</div>
				</div>

				<GroupTitle
					title="今天完成"
					count={2}
				/>
				<div className="px-5 py-2.5">
					<div className="truncate text-[16px] leading-[22px] font-medium text-ink2">子代理报告被截断</div>
					<SessionMeta
						project="Eaves"
						time="1 小时前"
					/>
				</div>
				<div className="px-5 py-2.5">
					<div className="truncate text-[16px] leading-[22px] font-medium text-ink2">解释 apply_patch 的格式</div>
					<SessionMeta time="2 小时前" />
				</div>
			</div>
		</div>
	);
}
