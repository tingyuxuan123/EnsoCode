export const frame = { width: 1360, height: 840, title: "最近删除" };

import { batches } from "../components/data";

export default function Trash() {
	return (
		<main className="px-6 pt-2 pb-6">
			<div className="flex h-9 items-center">
				<p className="text-[11.5px] text-faint">
					删除的条目先进这里，可恢复 · 满 100 批后清理已恢复的历史，未恢复的记录不会自动淘汰
				</p>
			</div>

			<div className="max-w-[1120px]">
				{batches.map((batch) => (
					<article
						key={batch.id}
						className="grid grid-cols-[132px_1fr_auto] items-start gap-6 border-t border-line-soft py-4"
					>
						<div className="flex items-baseline gap-2 text-[12px]">
							<span className="font-mono text-[13px] text-surface-foreground tabular-nums">
								{batch.count} 条
							</span>
							<span className="font-mono text-[11px] text-faint tabular-nums">
								{batch.deletedLabel}
							</span>
						</div>
						<div>
							<ul className="space-y-1">
								{batch.preview.map((line) => (
									<li key={line} className="flex items-start gap-2 text-[13px] text-muted">
										<span className="mt-[7px] size-[3px] shrink-0 rounded-full bg-faint" />
										<span className="max-w-[62ch] leading-[1.7]">{line}</span>
									</li>
								))}
							</ul>
							<p className="mt-1.5 pl-[11px] text-[11px] text-faint">
								{batch.source} · 属于 EnsoCode
							</p>
						</div>
						<div className="flex h-7 items-center justify-self-end">
							{batch.restored ? (
								<span className="rounded-[3px] bg-raise px-1.5 py-0.5 text-[11px] text-faint">
									已恢复
								</span>
							) : (
								<button
									type="button"
									className="flex h-7 items-center gap-1.5 rounded-card border border-line px-2.5 text-[12px] text-surface-foreground/90 transition-colors hover:border-muted/40"
								>
									<span className="icon-[lucide--rotate-ccw] size-3.5 text-muted" />
									恢复这一批
								</button>
							)}
						</div>
					</article>
				))}
			</div>

			<p className="mt-6 border-t border-line pt-4 text-[11px] text-faint">
				恢复后条目回到原页签，并计入下一轮上下文预算
			</p>
		</main>
	);
}
