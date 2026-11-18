export const frame = { width: 402, height: 874, radius: 62, title: "会话列表" };

import { Link } from "react-router";
import { StatusBar } from "@vetta/ios";
import { StatusGlyph } from "../components/StatusGlyph";
import { sessions } from "../components/data";

const groups = [
	{
		project: "EnsoCode",
		items: [sessions[0], sessions[1], sessions[4], sessions[6], sessions[7]],
	},
	{ project: "kdocs-bridge", items: [sessions[2]] },
	{ project: "image-studio", items: [sessions[3]] },
];

function SessionRow({ s }: { s: (typeof sessions)[number] }) {
	return (
		<div className={`flex items-center ${s.status === "waiting" ? "bg-yellow/[0.09]" : ""}`}>
			<Link
				to="/chat"
				className="flex min-w-0 flex-1 items-start gap-2 py-2.5 pl-5"
			>
				{s.pinned && (
					<span className="flex h-[22px] shrink-0 items-center">
						<span className="icon-[lucide--pin] size-3.5 text-yellow" />
					</span>
				)}
				<div className="min-w-0 flex-1">
					<div
						className={`truncate text-[16px] leading-[22px] ${
							s.status === "waiting" ? "font-semibold" : "font-medium"
						}`}
					>
						{s.title}
					</div>
					<div className="flex items-center gap-1.5 text-[13px] leading-[18px] text-dim">
						<span className="truncate">{s.note}</span>
						<span className="text-faint">·</span>
						<span className="shrink-0 tabular-nums">{s.time}</span>
					</div>
				</div>
				<span className="flex h-[22px] shrink-0 items-center">
					<StatusGlyph
						status={s.status}
						size={15}
					/>
				</span>
			</Link>
			<button
				aria-label="更多"
				className="mr-1 flex size-12 shrink-0 items-center justify-center text-faint"
			>
				<span className="icon-[lucide--ellipsis-vertical] size-5" />
			</button>
		</div>
	);
}

// 抽屉首页：连接状态在字标旁，分段切编程/Bot，会话按项目分组，等你的那条带黄色底。
export default function Sessions() {
	return (
		<div className="relative flex h-full flex-col overflow-hidden bg-page">
			<StatusBar
				variant="island"
				tone="dark"
			/>
			<header className="relative flex items-center gap-1 py-2 pr-3 pl-1">
				<Link
					to="/chat"
					aria-label="返回会话"
					className="flex size-12 shrink-0 items-center justify-center rounded-full text-ink"
				>
					<span className="icon-[lucide--arrow-left] size-6" />
				</Link>
				<h1 className="shrink-0 text-[22px] leading-7 font-bold tracking-[-0.01em]">CodeKiln</h1>
				<span className="ml-1 flex h-6 min-w-0 items-center gap-1.5 rounded-full bg-card2 px-2">
					<span className="size-1.5 shrink-0 rounded-full bg-green" />
					<span className="truncate text-[11px] leading-4 font-medium text-ink2">书房 · 已连接</span>
				</span>
				<div className="flex-1" />
				<Link
					to="/settings"
					aria-label="设备与通知"
					className="glass flex size-10 shrink-0 items-center justify-center rounded-full text-ink2"
				>
					<span className="icon-[lucide--monitor-smartphone] size-5" />
				</Link>
			</header>
			<div className="relative flex items-center gap-2.5 px-5 pt-1 pb-2">
				<div className="flex rounded-full bg-card2 p-1">
					<span className="flex h-8 items-center rounded-full bg-card px-3.5 text-[14px] leading-5 font-medium shadow-[0_1px_3px_rgb(0_0_0/0.08)]">
						编程
					</span>
					<Link
						to="/bot"
						className="flex h-8 items-center rounded-full px-3.5 text-[14px] leading-5 font-medium text-dim"
					>
						Bot
					</Link>
				</div>
				<div className="flex-1" />
				<span className="text-[13px] leading-4 text-dim tabular-nums">1 个等你</span>
				<button
					aria-label="按状态筛选"
					className="flex size-[38px] items-center justify-center rounded-full bg-card2 text-ink2"
				>
					<span className="icon-[lucide--arrow-down-wide-narrow] size-[18px]" />
				</button>
			</div>
			<div className="min-h-0 flex-1 overflow-hidden pb-28">
				{groups.map((g) => (
					<div key={g.project}>
						<div className="flex items-center gap-2 px-5 pt-3 pb-1">
							<span className="text-[13px] leading-[18px] font-medium text-dim">{g.project}</span>
							<div className="flex-1" />
							<span className="text-[11px] leading-4 text-faint tabular-nums">
								{g.items.length} 个会话
							</span>
						</div>
						{g.items.map((s) => (
							<SessionRow
								key={s.id}
								s={s}
							/>
						))}
					</div>
				))}
			</div>
			<div className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-page via-page/85 to-transparent" />
			<div className="absolute right-4 bottom-8 flex items-center gap-3">
				<Link
					to="/files"
					aria-label="文件下载"
					className="glass flex size-14 items-center justify-center rounded-full text-ink"
				>
					<span className="icon-[lucide--download] size-6" />
				</Link>
				<Link
					to="/new-session"
					aria-label="新会话"
					className="glass-ink flex size-14 items-center justify-center rounded-full"
				>
					<span className="icon-[lucide--square-pen] size-6" />
				</Link>
			</div>
		</div>
	);
}
