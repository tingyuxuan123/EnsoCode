export const frame = { width: 1360, height: 840, title: "待办" };

import { project, todos } from "../components/data";

const open = todos.filter((row) => !row.done);
const done = todos.filter((row) => row.done);

function Check({ on }: { on: boolean }) {
	return (
		<span className="flex h-[22px] w-4 shrink-0 items-center">
			<span
				className={`flex size-4 items-center justify-center rounded-[3px] border ${
					on ? "border-surface-foreground bg-surface-foreground" : "border-muted/50"
				}`}
			>
				{on && <span className="icon-[lucide--check] size-3 text-surface" />}
			</span>
		</span>
	);
}

export default function Todos() {
	return (
		<main className="px-6 pt-2 pb-6">
			<div className="flex h-9 items-center gap-2">
				<span className="flex h-7 items-center rounded-card border border-line p-0.5 text-[12px]">
					<span className="flex h-6 items-center rounded-[4px] bg-raise px-2 text-surface-foreground">
						全部
					</span>
					<span className="flex h-6 items-center px-2 text-muted">未完成</span>
					<span className="flex h-6 items-center px-2 text-muted">已完成</span>
				</span>
				<span className="ml-auto font-mono text-[11px] text-faint tabular-nums">
					{open.length} 项未完成 · {done.length} 项已完成
				</span>
			</div>

			{open.map((row) => (
				<article
					key={row.id}
					className="flex items-start gap-3 border-t border-line-soft py-3.5"
				>
					<Check on={false} />
					<div className="min-w-0 flex-1">
						<p className="text-[13px] leading-[1.7]">{row.text}</p>
						<div className="mt-1 flex items-center gap-2 text-[11px] text-faint">
							<span>{row.scope === "global" ? "全局" : project}</span>
							<span>·</span>
							<span className="font-mono tabular-nums">{row.updatedLabel}</span>
						</div>
					</div>
					<span className="flex items-center gap-0.5">
						<button
							type="button"
							title="标为完成"
							className="flex size-6 items-center justify-center rounded-[4px] text-faint hover:bg-raise hover:text-surface-foreground"
						>
							<span className="icon-[lucide--check] size-3.5" />
						</button>
						<button
							type="button"
							title="编辑"
							className="flex size-6 items-center justify-center rounded-[4px] text-faint hover:bg-raise hover:text-surface-foreground"
						>
							<span className="icon-[lucide--pencil] size-3.5" />
						</button>
						<button
							type="button"
							title="删除"
							className="flex size-6 items-center justify-center rounded-[4px] text-faint hover:bg-raise hover:text-danger"
						>
							<span className="icon-[lucide--trash-2] size-3.5" />
						</button>
					</span>
				</article>
			))}

			<div className="mt-6 flex items-center gap-2 border-t border-line pt-4">
				<span className="text-[12px] text-muted">已完成</span>
				<span className="font-mono text-[11px] text-faint tabular-nums">{done.length}</span>
				<button type="button" className="ml-auto text-[12px] text-muted hover:text-danger">
					移除已完成（可恢复）
				</button>
			</div>

			{done.map((row) => (
				<article key={row.id} className="flex items-start gap-3 border-t border-line-soft py-3">
					<Check on />
					<div className="min-w-0 flex-1">
						<p className="text-[13px] leading-[1.7] text-faint line-through">{row.text}</p>
					</div>
					<span className="flex items-center gap-0.5">
						<button
							type="button"
							title="撤销完成"
							className="flex size-6 items-center justify-center rounded-[4px] text-faint hover:bg-raise hover:text-surface-foreground"
						>
							<span className="icon-[lucide--undo-2] size-3.5" />
						</button>
					</span>
				</article>
			))}
		</main>
	);
}
