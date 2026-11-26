export const frame = { width: 1360, height: 840, title: "每日日志" };

import { kindLabel, logs, nf, pack, project } from "../components/data";

const today = logs.filter((row) => row.day === "today");
const yesterday = logs.filter((row) => row.day === "yesterday");
const todayChars = pack.sections.find((section) => section.key === "today")?.chars ?? 0;
const week = [
	{ day: "9", weekday: "一", has: false },
	{ day: "10", weekday: "二", has: false },
	{ day: "11", weekday: "三", has: false },
	{ day: "12", weekday: "四", has: false },
	{ day: "13", weekday: "五", has: false },
	{ day: "14", weekday: "六", has: true },
	{ day: "15", weekday: "日", has: true, active: true },
];

export default function Daily() {
	return (
		<main className="px-6 pt-2">
			<div className="flex items-center gap-1.5 pt-1">
				{week.map((cell) => (
					<button
						key={cell.day}
						type="button"
						className={`flex h-8 items-center gap-1.5 rounded-card px-2 whitespace-nowrap ${
							cell.active
								? "bg-raise text-surface-foreground"
								: cell.has
									? "text-surface-foreground/80"
									: "text-faint"
						}`}
					>
						<span className="text-[10.5px]">{cell.weekday}</span>
						<span className="font-mono text-[12px] tabular-nums">{cell.day}</span>
					</button>
				))}
				<span className="ml-3 font-mono text-[11px] text-faint tabular-nums">
					{today.length} 条 · {nf(todayChars)} 字
				</span>
				<span className="ml-auto text-[11px] text-faint">写入即落盘，跨天不再进入今日上下文</span>
			</div>

			{today.map((row) => (
				<article
					key={row.id}
					className="grid grid-cols-[44px_1fr] gap-4 border-t border-line-soft py-4"
				>
					<span className="pt-[3px] font-mono text-[11px] text-faint tabular-nums">{row.time}</span>
					<div>
						<div className="flex items-center gap-2 text-[12px]">
							<span className="font-medium text-surface-foreground/90">{kindLabel[row.kind]}</span>
							<span className="text-faint">·</span>
							<span className="text-muted">{project}</span>
							<span className="ml-auto flex items-center gap-0.5">
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
						</div>
						<p className="mt-1.5 max-w-[72ch] text-[13px] leading-[1.75]">{row.content}</p>
					</div>
				</article>
			))}

			<div className="mt-5 flex items-start gap-3 rounded-card border border-line bg-panel px-3 py-2.5">
				<span className="flex h-[18px] w-3.5 shrink-0 items-center">
					<span className="icon-[lucide--pencil-line] size-3.5 text-faint" />
				</span>
				<div>
					<p className="text-[12.5px] text-faint">写一条今天的日志…</p>
					<p className="mt-1.5 text-[10.5px] text-faint">⌘↵ 保存 · 疑似凭证会先被拦下</p>
				</div>
			</div>

			<div className="mt-5 flex items-center gap-2 border-t border-line pt-4 text-[12px] text-muted">
				<span className="icon-[lucide--arrow-left] size-3.5 text-faint" />
				昨天有 {yesterday.length} 条记录
				<button type="button" className="text-surface-foreground/85 underline-offset-4 hover:underline">
					查看 3月14日
				</button>
				<span className="ml-auto text-[11px] text-faint">
					每天一页，自动会话总结写在当天最后一格
				</span>
			</div>
		</main>
	);
}
