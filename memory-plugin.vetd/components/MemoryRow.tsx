import { kindLabel, project, type Memory } from "./data";

/**
 * A ruled ledger row instead of a card: kind, ownership and age on one line,
 * the sentence itself at reading size, actions quiet at the trailing edge.
 */
export function MemoryRow({ row, inPack = true }: { row: Memory; inPack?: boolean }) {
	return (
		<article className="border-t border-line-soft py-3.5 first:border-t-0">
			<div className="flex items-center gap-2 text-[12px]">
				<span className="font-medium text-surface-foreground/90">{kindLabel[row.kind]}</span>
				<span className="text-faint">·</span>
				<span className="text-muted">{row.scope === "global" ? "全局" : project}</span>
				{row.auto && <span className="text-faint">自动整理</span>}
				{!inPack && <span className="text-faint">未入本轮</span>}
				<span className="ml-auto font-mono text-[11px] text-faint tabular-nums">
					{row.updatedLabel}
				</span>
				<span className="ml-4 flex items-center gap-0.5">
					<button
						type="button"
						title="编辑"
						className="flex size-6 items-center justify-center rounded-[4px] text-faint transition-colors hover:bg-raise hover:text-surface-foreground"
					>
						<span className="icon-[lucide--pencil] size-3.5" />
					</button>
					<button
						type="button"
						title={row.pinned ? "取消置顶" : "置顶"}
						className={`flex size-6 items-center justify-center rounded-[4px] transition-colors hover:bg-raise ${
							row.pinned ? "text-brand" : "text-faint hover:text-surface-foreground"
						}`}
					>
						<span className="icon-[lucide--pin] size-3.5" />
					</button>
					<button
						type="button"
						title="删除"
						className="flex size-6 items-center justify-center rounded-[4px] text-faint transition-colors hover:bg-raise hover:text-danger"
					>
						<span className="icon-[lucide--trash-2] size-3.5" />
					</button>
				</span>
			</div>
			<p className="mt-2 max-w-[74ch] text-[13px] leading-[1.75] text-surface-foreground">
				{row.content}
			</p>
		</article>
	);
}
