import { nf, pack, settings, skippedMemories } from "./data";

const tone: Record<string, string> = {
	todos: "bg-brand",
	today: "bg-brand/75",
	memory: "bg-brand/50",
	yesterday: "bg-brand/30",
};

/**
 * The one thing this product has: what the next turn will actually start with.
 * Numbers come from buildPack(), which mirrors the plugin's own priority order.
 */
export function ContextPack() {
	const live = pack.sections.filter((section) => section.on && section.included > 0);
	const percent = Math.round(pack.used * 100);

	return (
		<aside className="flex w-[336px] shrink-0 flex-col border-l border-line px-6 py-5">
			<div className="flex items-baseline justify-between gap-2">
				<h2 className="text-[13px] font-medium">本轮上下文</h2>
				<span className="text-[11px] text-faint">
					{settings.mode === "stable" ? "稳定快照" : "逐轮检索"}
				</span>
			</div>

			<div className="mt-3 flex items-baseline gap-1.5">
				<span className="font-display text-[30px] leading-none font-light text-surface-foreground tabular-nums">
					{nf(pack.total)}
				</span>
				<span className="text-[12px] text-faint tabular-nums">/ {nf(pack.budget)} 字</span>
				<span className="ml-auto font-mono text-[11px] text-muted tabular-nums">{percent}%</span>
			</div>

			<div className="mt-3 flex h-2 gap-[2px] overflow-hidden rounded-full bg-raise">
				{live.map((section) => (
					<span
						key={section.key}
						className={`h-full rounded-full ${tone[section.key] ?? "bg-brand/50"}`}
						style={{ width: `${(section.chars / pack.budget) * 100}%` }}
					/>
				))}
			</div>

			<p className="mt-2 text-[11px] text-faint">按优先级依次装入，超出预算的条目直接跳过</p>

			<ul className="mt-4 space-y-2.5">
				{pack.sections.map((section) => (
					<li key={section.key} className="flex items-baseline gap-2">
						<span
							className={`mt-[3px] size-[6px] shrink-0 rounded-[1px] ${
								section.included ? (tone[section.key] ?? "bg-brand") : "bg-line"
							}`}
						/>
						<span
							className={`text-[12px] ${section.included ? "text-surface-foreground" : "text-faint"}`}
						>
							{section.title}
						</span>
						{!section.on && <span className="text-[11px] text-faint">未启用</span>}
						<span className="ml-auto font-mono text-[11px] text-faint tabular-nums">
							{section.included > 0 ? `${section.included} 条` : "—"}
						</span>
						<span className="w-[52px] text-right font-mono text-[11px] text-muted tabular-nums">
							{section.chars ? nf(section.chars) : "0"}
						</span>
					</li>
				))}
			</ul>

			<div className="mt-5 rounded-card bg-raise p-3">
				<p className="text-[12px] leading-[1.65] text-surface-foreground/90">
					长期记忆只收<span className="mx-1 font-mono tabular-nums">{pack.picked}</span>/
					<span className="mr-1 font-mono tabular-nums">{pack.picked + pack.overflow}</span>
					条
				</p>
				<p className="mt-1.5 text-[10.5px] text-faint">
					没进这一包的<span className="mx-1 font-mono tabular-nums">{pack.overflow}</span>条（前三条）
				</p>
				<ul className="mt-1.5 space-y-1">
					{skippedMemories.slice(0, 3).map((row) => (
						<li key={row.id} className="truncate text-[11px] text-faint">
							{row.content}
						</li>
					))}
				</ul>
				<button
					type="button"
					className="mt-2.5 text-[12px] text-brand transition-colors hover:text-brand/80"
				>
					调整条数上限
				</button>
			</div>

			<div className="mt-5 space-y-2">
				<button
					type="button"
					className="flex h-8 w-full items-center justify-center gap-1.5 rounded-card border border-line text-[12px] text-muted transition-colors hover:border-muted/40 hover:text-surface-foreground"
				>
					<span className="icon-[lucide--copy] size-3.5" />
					复制本轮上下文
				</button>
				<p className="text-[11px] text-faint">6 分钟前生成 · 下轮对话开始时重算</p>
			</div>
		</aside>
	);
}
