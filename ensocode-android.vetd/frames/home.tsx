export const frame = { width: 412, height: 915, title: "任务列表" };

import { Link } from "react-router";
import { StatusBar } from "@vetta/ios";
import { SessionMeta } from "../components/SessionMeta";
import { StatusGlyph } from "../components/StatusGlyph";
import { computer, sessions } from "../components/data";

const entries = [
	{ to: "/", icon: "icon-[lucide--square-pen]", title: "新任务", detail: "EnsoCode" },
	{ to: "/board", icon: "icon-[lucide--layout-dashboard]", title: "任务看板", detail: "1 个等你" },
	{ to: "/pair", icon: "icon-[lucide--scan-line]", title: "连接电脑", detail: computer },
	{ to: "/home", icon: "icon-[lucide--monitor]", title: "远程控制" },
];

/** 抽屉首页（HomeScreen）：标题旁是连接状态，下面几个入口，再往下是全部任务。搜索和设置浮在右下。 */
export default function Home() {
	return (
		<div className="relative flex h-full flex-col overflow-hidden bg-page">
			<div
				className="pointer-events-none absolute inset-x-0 top-0 h-[420px]"
				style={{ background: "radial-gradient(80% 100% at 50% 0%, #ffffff 0%, rgb(255 255 255 / 0) 100%)" }}
			/>
			<StatusBar
				variant="flat"
				tone="dark"
			/>
			<header className="relative flex items-center py-2 pr-4 pl-5">
				<h1 className="text-[22px] leading-7 font-bold">EnsoCode</h1>
				<button
					aria-label={`已连接 ${computer}`}
					className="ml-2 flex h-[30px] items-center gap-1 rounded-full border-[0.75px] border-line px-[9px]"
				>
					<span className="icon-[mdi--laptop] size-[15px]" />
					<span className="icon-[mdi--check] size-[13px] text-green" />
				</button>
				<div className="flex-1" />
				<Link
					to="/"
					aria-label="关闭"
					className="glass flex size-12 items-center justify-center rounded-full"
				>
					<span className="icon-[lucide--x] size-5" />
				</Link>
			</header>
			<div className="relative min-h-0 flex-1 overflow-hidden pb-32">
				<nav className="pt-1 pb-2">
					{entries.map((e) => (
						<Link
							key={e.title}
							to={e.to}
							className="flex items-center gap-3.5 px-5 py-2.5"
						>
							<span className={`${e.icon} size-6`} />
							<span className="flex-1 text-[16px] leading-[22px] font-medium">{e.title}</span>
							{e.detail && <span className="max-w-[170px] truncate text-[14px] leading-5 text-dim">{e.detail}</span>}
						</Link>
					))}
				</nav>
				<div className="flex items-center gap-2.5 px-5 py-2.5">
					<h2 className="flex-1 text-[15px] leading-5 font-semibold text-dim">任务</h2>
					<button
						aria-label="按状态筛选：全部"
						className="flex size-[38px] items-center justify-center rounded-full bg-card2 text-ink2"
					>
						<span className="icon-[mdi--sort] size-[18px]" />
					</button>
					<button
						aria-label="按项目筛选"
						className="flex size-[38px] items-center justify-center rounded-full bg-card2 text-ink2"
					>
						<span className="icon-[lucide--folder] size-[18px]" />
					</button>
				</div>
				{sessions.map((s) => (
					<div
						key={s.id}
						className={`flex items-center ${s.status === "waiting" ? "bg-yellow/[0.09]" : ""}`}
					>
						<Link
							to="/session"
							className="flex min-w-0 flex-1 items-start gap-2 py-2.5 pl-5"
						>
							{s.pinned && (
								<span className="flex h-[22px] shrink-0 items-center">
									<span className="icon-[mdi--pin] size-3.5 text-yellow" />
								</span>
							)}
							<div className="min-w-0 flex-1">
								<div className="truncate text-[16px] leading-[22px] font-medium">{s.title}</div>
								<SessionMeta
									project={s.project}
									time={s.time}
								/>
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
							className="mr-1 flex size-12 shrink-0 items-center justify-center text-ink2"
						>
							<span className="icon-[mdi--dots-vertical] size-6" />
						</button>
					</div>
				))}
			</div>
			<div className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-page via-page/80 to-transparent" />
			<div className="absolute right-4 bottom-8 flex items-center gap-3">
				<button
					aria-label="搜索"
					className="glass flex size-14 items-center justify-center rounded-full"
				>
					<span className="icon-[lucide--search] size-6" />
				</button>
				<button
					aria-label="设置"
					className="glass flex size-14 items-center justify-center rounded-full"
				>
					<span className="icon-[lucide--settings] size-6" />
				</button>
			</div>
		</div>
	);
}
