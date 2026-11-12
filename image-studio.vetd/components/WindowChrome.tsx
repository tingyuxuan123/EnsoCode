import { Link } from "react-router";

/** 44px 无边框标题栏：macOS 红绿灯由系统画，内容从 84px 起。 */
export function WindowChrome({ panelOpen }: { panelOpen?: boolean }) {
	return (
		<header className="relative flex h-11 shrink-0 items-center pl-[84px] pr-3">
			<div className="flex items-center gap-2">
				<span className="absolute left-5 size-3 rounded-full bg-[#ff5f57]" />
				<span className="absolute left-[33px] size-3 rounded-full bg-[#febc2e]" />
				<span className="absolute left-[53px] size-3 rounded-full bg-[#28c840]" />
			</div>
			<span className="flex items-center gap-2 text-[12px] font-medium text-muted-foreground">
				小满
				<span className="font-normal text-muted-foreground/75">工作台</span>
			</span>
			<div className="pointer-events-none absolute inset-0 flex items-center justify-center">
				<div className="flex items-center gap-2">
					<span className="truncate text-[13px] font-medium text-foreground">集成 Open Vetta 生图功能</span>
					<span className="rounded-md bg-accent/70 px-2 py-0.5 text-[11px] text-muted-foreground">
						独立生图模块设计
					</span>
				</div>
			</div>
			<div className="ml-auto flex items-center gap-1">
				<button
					type="button"
					aria-label="切换侧栏"
					className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
				>
					<span className="icon-[lucide--panel-left] size-4" />
				</button>
				<Link
					to={panelOpen ? "/thread" : "/history"}
					aria-label={panelOpen ? "收起右侧面板" : "展开右侧面板"}
					aria-pressed={panelOpen}
					className={`flex size-7 items-center justify-center rounded-md ${
						panelOpen
							? "bg-accent text-foreground"
							: "text-muted-foreground hover:bg-accent hover:text-foreground"
					}`}
				>
					<span className="icon-[lucide--panel-right] size-4" />
				</Link>
			</div>
		</header>
	);
}
