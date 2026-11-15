export const frame = { width: 402, height: 874, radius: 62, title: "设备与通知" };

import { Link } from "react-router";
import { StatusBar } from "@vetta/ios";
import { TopBar } from "../components/TopBar";

// 设备与通知：连接、这台手机的权限、推送、已配对设备、解绑。都在一页里，不再分栏。
export default function Settings() {
	return (
		<div className="relative flex h-full flex-col overflow-hidden bg-page">
			<StatusBar
				variant="island"
				tone="dark"
			/>
			<TopBar
				lead="back"
				to="/sessions"
				title="设备与通知"
			/>
			<div className="min-h-0 flex-1 overflow-hidden px-5 pt-1 pb-10">
				<p className="pb-1 text-[12px] leading-4 text-dim">当前连接</p>
				<div className="flex items-center gap-3 rounded-[16px] bg-card px-3.5 py-3">
					<span className="icon-[lucide--laptop] size-5 shrink-0 text-ink2" />
					<div className="min-w-0 flex-1">
						<p className="truncate text-[15px] leading-5 font-medium">书房 · MacBook Pro</p>
						<p className="flex items-center gap-1.5 truncate text-[12px] leading-4 text-dim">
							<span className="size-1.5 shrink-0 rounded-full bg-green" />
							已连接 · relay.yfdl.site
						</p>
					</div>
					<Link
						to="/sessions"
						className="shrink-0 text-[13px] leading-5 font-medium text-ink2"
					>
						切换
					</Link>
				</div>
				<p className="pt-6 pb-1 text-[12px] leading-4 text-dim">这台手机</p>
				<div className="flex items-center gap-3 rounded-[16px] bg-card px-3.5 py-3">
					<div className="min-w-0 flex-1">
						<p className="text-[15px] leading-5 font-medium">可操作</p>
						<p className="text-[12px] leading-4 text-dim">能发消息、批审批、开新会话</p>
					</div>
					<span className="shrink-0 rounded-full bg-card2 px-2.5 py-1 text-[11px] leading-4 font-medium text-ink2">
						改成只读
					</span>
				</div>
				<p className="pt-6 pb-1 text-[12px] leading-4 text-dim">通知</p>
				<div className="flex items-center gap-3 rounded-[16px] bg-card px-3.5 py-3">
					<div className="min-w-0 flex-1">
						<p className="text-[15px] leading-5 font-medium">推送通知</p>
						<p className="text-[12px] leading-4 text-dim">等审批、任务完成、断线时提醒</p>
					</div>
					<span className="flex h-7 w-12 shrink-0 items-center rounded-full bg-pill p-1">
						<span className="ml-auto size-5 rounded-full bg-pill-ink" />
					</span>
				</div>
				<p className="pt-2 text-[11px] leading-4 text-faint">
					iOS 要先「添加到主屏幕」，推送才可开。
				</p>
				<p className="pt-6 pb-1 text-[12px] leading-4 text-dim">已配对设备</p>
				<div className="rounded-[16px] bg-card">
					<div className="flex items-center gap-3 px-3.5 py-3">
						<span className="icon-[lucide--smartphone] size-5 shrink-0 text-ink2" />
						<div className="min-w-0 flex-1">
							<p className="text-[15px] leading-5 font-medium">这台 iPhone</p>
							<p className="text-[12px] leading-4 text-dim">当前设备 · 可操作</p>
						</div>
					</div>
					<div className="flex items-center gap-3 border-line/60 border-t px-3.5 py-3">
						<span className="icon-[lucide--tablet] size-5 shrink-0 text-ink2" />
						<div className="min-w-0 flex-1">
							<p className="text-[15px] leading-5 font-medium">iPad mini</p>
							<p className="text-[12px] leading-4 text-dim">只读 · 昨天连过</p>
						</div>
						<span className="shrink-0 text-[13px] leading-5 font-medium text-ink2">重命名</span>
					</div>
				</div>
				<Link
					to="/pair"
					className="mt-2 flex items-center gap-3 rounded-[16px] bg-card px-3.5 py-3"
				>
					<span className="icon-[lucide--plus] size-5 shrink-0 text-ink2" />
					<span className="flex-1 text-[15px] leading-5 font-medium">配对新电脑</span>
					<span className="icon-[lucide--chevron-right] size-4 shrink-0 text-faint" />
				</Link>
				<button className="mt-6 h-12 w-full rounded-full bg-card text-[15px] font-medium text-red">
					解绑这台手机
				</button>
			</div>
		</div>
	);
}
