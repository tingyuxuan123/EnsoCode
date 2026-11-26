export const frame = { width: 1360, height: 840, title: "长期记忆" };

import { memories } from "../components/data";
import { MemoryRow } from "../components/MemoryRow";

export default function Memory() {
	return (
		<main className="px-6 pt-2 pb-6">
			<div className="flex h-9 items-center gap-1">
				<button
					type="button"
					className="flex h-7 items-center gap-1.5 rounded-[4px] px-2 text-[12px] text-muted transition-colors hover:bg-raise hover:text-surface-foreground"
				>
					全部类型
					<span className="icon-[lucide--chevron-down] size-3.5 text-faint" />
				</button>
				<button
					type="button"
					className="flex h-7 items-center gap-1.5 rounded-[4px] px-2 text-[12px] text-muted transition-colors hover:bg-raise hover:text-surface-foreground"
				>
					全部范围
					<span className="icon-[lucide--chevron-down] size-3.5 text-faint" />
				</button>
				<span className="ml-auto text-[11px] text-faint">按更新时间倒序</span>
			</div>

			{memories.slice(0, 6).map((row) => (
				<MemoryRow key={row.id} row={row} />
			))}

			<div className="mt-1 flex items-center justify-between border-t border-line pt-3.5">
				<button
					type="button"
					className="h-7 rounded-card border border-line px-2.5 text-[12px] text-muted opacity-40"
				>
					上一页
				</button>
				<span className="font-mono text-[11px] text-faint tabular-nums">
					共 {memories.length} 条 · 1–6
				</span>
				<button
					type="button"
					className="h-7 rounded-card border border-line px-2.5 text-[12px] text-muted transition-colors hover:border-muted/40 hover:text-surface-foreground"
				>
					下一页
				</button>
			</div>
		</main>
	);
}
