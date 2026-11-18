// 输入区：白底圆角输入条 + 外侧一枚 48 的墨黑发送键；运行中换成停止键，
// 下面一行是会话统计（上下文、用量、缓存、速度）。
export function Composer({
	placeholder = "回复 CodeKiln…",
	meta,
	running = false,
}: {
	placeholder?: string;
	meta?: { context: number; tokens: string; cache: string; speed: string };
	running?: boolean;
}) {
	return (
		<div className="relative shrink-0 px-3 pt-2 pb-7">
			<div className="flex items-end gap-2">
				<div className="flex min-h-12 flex-1 items-center gap-1.5 rounded-3xl border border-line bg-card p-1.5">
					<button
						aria-label="添加附件"
						className="flex size-9 shrink-0 items-center justify-center rounded-full text-ink"
					>
						<span className="icon-[lucide--plus] size-[22px]" />
					</button>
					<span className="min-w-0 flex-1 truncate py-2 text-[16px] leading-[22px] text-dim">
						{placeholder}
					</span>
					<button
						aria-label="语音输入"
						className="flex size-9 shrink-0 items-center justify-center rounded-full text-ink"
					>
						<span className="icon-[lucide--mic] size-[22px]" />
					</button>
				</div>
				<button
					aria-label={running ? "停止" : "发送"}
					className="flex size-12 shrink-0 items-center justify-center rounded-full bg-pill text-pill-ink"
				>
					<span className={`${running ? "icon-[lucide--square]" : "icon-[lucide--arrow-up]"} size-[22px]`} />
				</button>
			</div>
			{meta && (
				<div className="mt-2.5 flex items-center justify-center gap-3.5 text-[11px] leading-4 text-faint tabular-nums">
					<span className="flex items-center gap-1.5">
						<span className="relative h-1 w-9 overflow-hidden rounded-full bg-line">
							<span
								className="absolute inset-y-0 left-0 rounded-full bg-ink2"
								style={{ width: `${meta.context}%` }}
							/>
						</span>
						{meta.context}%
					</span>
					<span className="flex items-center gap-1">
						<span className="icon-[lucide--coins] size-3.5" />
						{meta.tokens}
					</span>
					<span className="flex items-center gap-1">
						<span className="icon-[lucide--database] size-3.5" />
						{meta.cache}
					</span>
					<span className="flex items-center gap-1">
						<span className="icon-[lucide--zap] size-3.5" />
						{meta.speed}
					</span>
				</div>
			)}
		</div>
	);
}
