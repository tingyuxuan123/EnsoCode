import { Link } from "react-router";

const TAB =
	"relative flex h-full shrink-0 items-center gap-[6px] px-[12px] text-[13px] transition-colors";

export function MainTabs() {
	return (
		<div className="flex h-11 shrink-0 items-center gap-1 border-b border-line px-4">
			<Link to="/thread" className={`${TAB} text-muted-foreground hover:text-foreground`}>
				<span className="icon-[lucide--messages-square] size-3.5 shrink-0" />
				主会话
			</Link>
			<span
				className={`${TAB} font-medium text-foreground after:absolute after:inset-x-3 after:bottom-0 after:h-[2px] after:rounded-full after:bg-primary`}
			>
				<span className="icon-[lucide--image] size-3.5 shrink-0" />
				图片工作台
				<span className="icon-[lucide--x] size-3 shrink-0 text-muted-foreground" />
			</span>
			<button
				type="button"
				aria-label="新建标签页"
				className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
			>
				<span className="icon-[lucide--plus] size-3.5" />
			</button>
			<span className="ml-auto flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-[11px] text-muted-foreground">
				<span className="size-1.5 rounded-full bg-success" />
				准备就绪
			</span>
		</div>
	);
}
