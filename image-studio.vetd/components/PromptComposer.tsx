import { Link } from "react-router";

const CHIP =
	"flex h-7 items-center gap-1 rounded-md px-2 text-[12px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground";

export function PromptComposer({
	placeholder,
	model = "gpt-image-2.6",
	profile = "自动",
	count = 1,
	used = 1,
	limit = 12,
	ready,
}: {
	placeholder: string;
	model?: string;
	profile?: string;
	count?: number;
	used?: number;
	limit?: number;
	ready?: boolean;
}) {
	return (
		<div className="rounded-2xl border border-border bg-card p-3.5 shadow-sm">
			<p className="px-1 text-[14px] leading-[1.6] text-muted-foreground">{placeholder}</p>
			<div className="mt-3 flex items-center gap-1.5">
				<button
					type="button"
					aria-label="添加参考图"
					className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
				>
					<span className="icon-[lucide--paperclip] size-4" />
				</button>
				<Link
					to="/settings"
					className="flex h-7 items-center gap-1.5 rounded-md bg-secondary px-2.5 text-[12px] text-secondary-foreground"
				>
					<span className="icon-[lucide--image] size-3.5" />
					画图
				</Link>
				<span className="px-1 text-[12px] text-muted-foreground">{count} 张</span>
				<div className="ml-auto flex items-center">
					<Link
						to="/settings"
						className="flex h-7 items-center rounded-md px-1.5 font-mono text-[12px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
					>
						{model}
					</Link>
					<Link to="/settings" className={`${CHIP} px-1`}>
						{profile}
						<span className="icon-[lucide--chevron-down] size-3" />
					</Link>
					<span className="ml-2 font-mono text-[11px] text-muted-foreground tabular-nums">
						{used} / {limit}
					</span>
					<Link
						to="/thread"
						aria-label="发送"
						className={`ml-2 flex size-8 items-center justify-center rounded-full ${
							ready ? "bg-primary text-primary-foreground" : "bg-primary/25 text-primary"
						}`}
					>
						<span className="icon-[lucide--arrow-up] size-4" />
					</Link>
				</div>
			</div>
		</div>
	);
}
