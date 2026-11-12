import { Link } from "react-router";
import { prints } from "./data";

const filters = ["全部", "文生图", "改图"];

export function HistoryPanel() {
	return (
		<aside className="flex w-[380px] shrink-0 flex-col border-l border-line">
			<div className="flex h-11 shrink-0 items-center gap-1 px-4">
				<span className="relative flex h-full items-center gap-[6px] px-[12px] text-[13px] font-medium text-foreground after:absolute after:inset-x-3 after:bottom-0 after:h-[2px] after:rounded-full after:bg-primary">
					<span className="icon-[lucide--image] size-3.5 shrink-0" />
					生图历史
					<Link to="/thread" aria-label="关闭生图历史" className="text-muted-foreground">
						<span className="icon-[lucide--x] size-3" />
					</Link>
				</span>
			</div>
			<div className="flex h-9 shrink-0 items-center gap-1 border-y border-line px-3">
				{filters.map((filter, index) => (
					<span
						key={filter}
						className={`rounded-md px-2 py-1 text-[12px] ${
							index === 0 ? "bg-accent text-foreground" : "text-muted-foreground"
						}`}
					>
						{filter}
					</span>
				))}
				<span className="ml-auto font-mono text-[11px] text-muted-foreground tabular-nums">
					28 张 · 按时间
				</span>
			</div>
			<div className="min-h-0 flex-1 overflow-hidden px-3 py-3">
				<div className="grid grid-cols-2 gap-3">
					{prints.map((print) => (
						<div key={print.id}>
							<div className="aspect-[4/3] overflow-hidden rounded-md border border-border bg-muted">
								<img src={print.src} alt={print.alt} className="size-full object-cover" />
							</div>
							<p className="mt-1.5 truncate font-mono text-[11px] text-muted-foreground">
								{print.sent}
							</p>
						</div>
					))}
				</div>
			</div>
			<footer className="border-t border-line px-3 py-2">
				<p className="text-[11px] leading-[1.7] text-muted-foreground">
					按会话归档在 .xiaoman/images/，原图不被覆盖
				</p>
			</footer>
		</aside>
	);
}
