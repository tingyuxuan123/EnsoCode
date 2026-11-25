import { Maximize2Icon, PlusIcon } from "./LucideIcons";

/** 右侧面板卡片：页签条（加宽 / 新建）→ 空态水印。 */
export function SidePanel() {
	return (
		<aside className="flex w-[360px] shrink-0 flex-col overflow-hidden rounded-card border border-border bg-surface">
			<div className="flex h-[40px] shrink-0 items-center justify-end gap-0.5 border-b border-line px-2.5">
				<button
					type="button"
					aria-label="加宽右侧面板"
					className="flex size-[26px] items-center justify-center rounded-[6px] text-muted hover:bg-white/6 hover:text-surface-foreground"
				>
					<Maximize2Icon className="size-3.5" strokeWidth={1.75} />
				</button>
				<button
					type="button"
					aria-label="新建标签页"
					className="flex size-[26px] items-center justify-center rounded-[6px] text-muted hover:bg-white/6 hover:text-surface-foreground"
				>
					<PlusIcon className="size-[14px]" />
				</button>
			</div>

			<div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
				<p className="text-[14px] text-muted">还没有标签页，新建一个开始使用。</p>
				<button
					type="button"
					className="flex h-[32px] items-center gap-1.5 rounded-[6px] border border-border bg-panel px-3 text-[13px] font-medium text-surface-foreground hover:bg-elevated"
				>
					<PlusIcon className="size-[14px]" />
					新建标签页
				</button>
			</div>
		</aside>
	);
}
