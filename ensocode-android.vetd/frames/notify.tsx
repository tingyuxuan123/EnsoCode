export const frame = { width: 412, height: 915, title: "通知与快捷回复" };

import type { ReactNode } from "react";
import { Link } from "react-router";
import { StatusBar } from "@vetta/ios";
import { BotAvatar } from "../components/BotAvatar";
import { EavesMark } from "../components/Eaves";
import { bots } from "../components/data";

/** 一条通知的抬头：应用、来源、时间，和安卓通知栏一样小而淡。 */
function Source({ from, time, icon }: { from: string; time: string; icon?: ReactNode }) {
	return (
		<div className="flex items-center gap-2 text-[12px] leading-4 text-night-dim">
			{icon ?? (
				<EavesMark
					size={14}
					className="text-night-ink"
				/>
			)}
			<span>Eaves</span>
			<span>·</span>
			<span className="min-w-0 truncate">{from}</span>
			<span className="ml-auto shrink-0">{time}</span>
		</div>
	);
}

function Action({ children, to = "/session", strong = false }: { children: string; to?: string; strong?: boolean }) {
	return (
		<Link
			to={to}
			className={`flex h-9 items-center rounded-full px-4 text-[14px] font-medium ${
				strong ? "bg-night-ink text-night" : "bg-white/[0.08] text-night-ink"
			}`}
		>
			{children}
		</Link>
	);
}

/**
 * 下拉通知栏（Vetta 深色主题）：审批和提问都能在通知里直接处理，不用打开 app；
 * 成员的结果带一个直达入口；完成的任务收成一组。
 */
export default function Notify() {
	return (
		<div className="relative flex h-full flex-col overflow-hidden bg-night text-night-ink">
			<StatusBar
				variant="flat"
				tone="light"
			/>
			<header className="px-6 pt-4 pb-5">
				<div className="text-[44px] leading-[48px] font-light tabular-nums">14:08</div>
				<div className="mt-1 text-[14px] leading-5 text-night-dim">11月7日 周六</div>
			</header>
			<div className="flex flex-col gap-2 px-3">
				<section className="rounded-[24px] bg-night-card px-4 pt-3.5 pb-3">
					<Source
						from="会话恢复后时间线为空"
						time="现在"
					/>
					<h2 className="mt-2 text-[15px] leading-5 font-semibold">它想运行一条命令</h2>
					<p className="mt-1 font-mono text-[13px] leading-5 text-night-dim">$ pnpm test -- sessionReducer</p>
					<div className="mt-3 flex gap-2">
						<Action strong>允许</Action>
						<Action>拒绝</Action>
						<Action>打开</Action>
					</div>
				</section>

				<section className="rounded-[24px] bg-night-card px-4 pt-3.5 pb-3">
					<Source
						from="首页 Hero 用哪张截图"
						time="4 分钟"
					/>
					<h2 className="mt-2 text-[15px] leading-5 font-semibold">它在问你：Hero 用浅色还是深色截图？</h2>
					<div className="mt-3 flex flex-wrap gap-2">
						<Action
							to="/ask"
							strong
						>
							浅色
						</Action>
						<Action to="/ask">深色</Action>
						<Action to="/ask">两张都放</Action>
					</div>
					<div className="mt-3 flex h-11 items-center gap-2 rounded-full bg-white/[0.06] pr-1.5 pl-4 shadow-[inset_0_0_0_0.75px_var(--color-night-line)]">
						<span className="min-w-0 flex-1 truncate text-[14px] text-night-dim">回复…</span>
						<span className="flex size-8 items-center justify-center rounded-full bg-night-ink text-night">
							<span className="icon-[lucide--arrow-up] size-[18px]" />
						</span>
					</div>
				</section>

				<section className="rounded-[24px] bg-night-card px-4 pt-3.5 pb-3">
					<Source
						from="Eaves 安卓版"
						time="6 分钟"
						icon={
							<BotAvatar
								bot={bots.ce}
								size={14}
							/>
						}
					/>
					<div className="mt-2 flex gap-3">
						<BotAvatar
							bot={bots.ce}
							size={36}
						/>
						<div className="min-w-0 flex-1">
							<h2 className="text-[15px] leading-5 font-semibold">小测</h2>
							<p className="mt-0.5 text-[14px] leading-5 text-night-dim">回归跑完了：38 通过，2 失败。报告在附件里。</p>
						</div>
					</div>
					<div className="mt-3 flex gap-2">
						<Action to="/artifact">查看报告</Action>
						<Action to="/bot">回复</Action>
					</div>
				</section>

				<Link
					to="/home"
					className="flex items-center gap-3 rounded-[24px] bg-night-card px-4 py-3.5"
				>
					<EavesMark
						size={16}
						className="text-night-ink"
					/>
					<div className="min-w-0 flex-1">
						<div className="text-[15px] leading-5 font-semibold">3 个任务已完成</div>
						<div className="truncate text-[13px] leading-[18px] text-night-dim">子代理报告被截断 · 解释 apply_patch 的格式 · 发布…</div>
					</div>
					<span className="icon-[lucide--chevron-down] size-5 text-night-dim" />
				</Link>
			</div>
			<div className="mt-auto flex justify-between px-4 pb-10">
				<button className="h-9 rounded-full bg-white/[0.08] px-4 text-[14px] font-medium">管理</button>
				<button className="h-9 rounded-full bg-white/[0.08] px-4 text-[14px] font-medium">全部清除</button>
			</div>
		</div>
	);
}
