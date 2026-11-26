import { Link, Outlet, useLocation } from "react-router";
import { ContextPack } from "../components/ContextPack";
import { counts, project, searchHits, searchQuery } from "../components/data";

const tabs = [
	{ to: "/", label: "长期记忆", count: counts.memories },
	{ to: "/daily", label: "每日日志", count: counts.logs },
	{ to: "/todos", label: "待办", count: counts.todos },
	{ to: "/trash", label: "最近删除", count: counts.recoverable },
	{ to: "/settings", label: "设置", count: null },
];

/** Screens that keep the context ledger; trash and settings are full width. */
const withPack = ["/", "/daily", "/todos", "/search"];
const withAdd = ["/", "/daily", "/todos", "/search"];

export default function Layout() {
	const { pathname } = useLocation();
	// The icon sheet is a standalone spec, not a plugin screen.
	if (pathname === "/icons") return <Outlet />;

	return (
		<div className="flex h-full flex-col bg-surface text-surface-foreground">
			{/* The host's own 40px workspace header (PluginWorkspacePage): back, the
			 * plugin icon and the view title — the only place the name appears. */}
			<div className="flex h-10 shrink-0 items-center gap-2 border-b border-line px-3">
				<button
					type="button"
					className="flex size-7 items-center justify-center rounded-[4px] text-muted hover:bg-raise hover:text-surface-foreground"
				>
					<span className="icon-[lucide--arrow-left] size-4" />
				</button>
				<span className="icon-[lucide--book-marked] size-4 text-muted" />
				<span className="text-[13px] font-medium">记忆</span>
			</div>
			<header className="flex h-[52px] shrink-0 items-center gap-3 px-6">
				<button
					type="button"
					className="flex items-center gap-2 rounded-card px-1.5 py-1 text-[13px] transition-colors hover:bg-raise"
				>
					<span className="icon-[lucide--folder-closed] size-4 text-muted" />
					<span className="font-medium">{project}</span>
					<span className="text-[12px] text-faint">＋ 全局</span>
					<span className="icon-[lucide--chevron-down] size-3.5 text-faint" />
				</button>
				<span className="text-[11px] text-faint tabular-nums">
					{counts.memories} 条记忆 · {counts.logs} 篇日志 · {counts.todos} 项待办
				</span>

				<div className="ml-auto flex items-center gap-2">
					<div className="flex h-8 w-[236px] items-center gap-2 rounded-card border border-line bg-panel px-2.5">
						<span className="icon-[lucide--search] size-3.5 shrink-0 text-faint" />
						<span className="truncate text-[12px] text-faint">搜索记忆、日志与待办</span>
						<kbd className="ml-auto font-mono text-[10px] text-faint">/</kbd>
					</div>
					{withAdd.includes(pathname) && (
						<button
							type="button"
							className="flex h-8 items-center gap-1.5 rounded-card bg-surface-foreground px-3 text-[12px] font-medium text-surface"
						>
							<span className="icon-[lucide--plus] size-3.5" />
							记一条
						</button>
					)}
					{pathname === "/settings" && (
						<button
							type="button"
							className="flex h-8 items-center gap-1.5 rounded-card bg-surface-foreground px-3 text-[12px] font-medium text-surface"
						>
							保存设置
						</button>
					)}
				</div>
			</header>

			{pathname === "/search" ? (
				<div className="flex h-[41px] shrink-0 items-center gap-2 border-b border-line px-6">
					<span className="text-[12.5px]">
						搜索
						<span className="mx-1.5 rounded-[3px] bg-brand/20 px-1 font-medium">
							{searchQuery}
						</span>
						的命中
					</span>
					<span className="font-mono text-[11px] text-faint tabular-nums">
						{searchHits(searchQuery).length} 条
					</span>
					<span className="ml-auto flex items-center gap-3 text-[12px] text-muted">
						<button type="button" className="flex items-center gap-1.5 hover:text-surface-foreground">
							<span className="icon-[lucide--x] size-3.5" />
							清除
						</button>
					</span>
				</div>
			) : (
				<nav className="flex h-[41px] shrink-0 items-stretch gap-6 border-b border-line px-6">
					{tabs.map((tab) => {
						const active = pathname === tab.to;
						return (
							<Link
								key={tab.to}
								to={tab.to}
								className={`relative flex items-center gap-1.5 text-[12.5px] transition-colors ${
									active
										? "text-surface-foreground"
										: "text-muted hover:text-surface-foreground/80"
								}`}
							>
								{tab.label}
								{tab.count !== null && (
									<span className="font-mono text-[11px] text-faint tabular-nums">{tab.count}</span>
								)}
								{active && (
									<span className="absolute inset-x-0 -bottom-px h-[2px] rounded-full bg-surface-foreground" />
								)}
							</Link>
						);
					})}
				</nav>
			)}

			<div className="flex min-h-0 flex-1">
				<div className="min-h-0 min-w-0 flex-1 overflow-auto">
					<Outlet />
				</div>
				{withPack.includes(pathname) && <ContextPack />}
			</div>
		</div>
	);
}
