/**
 * 输入框（Composer.kt）：白底圆角 24 的输入条，左边附件、右边语音，
 * 外侧一枚 48 的墨黑发送键；`running` 时换成停止键。`meta` 在下面放审批模式和上下文占用。
 */
export function Composer({
	placeholder,
	meta,
	running = false,
}: {
	placeholder: string;
	/** 输入框下的会话统计（SessionStatsLine）：审批模式、上下文占用、用量、缓存命中 */
	meta?: { mode: string; context: number; tokens: string; cache: string };
	running?: boolean;
}) {
	return (
		<div className="relative px-3 pt-2 pb-6">
			<div className="flex items-end gap-2">
				<div className="flex min-h-12 flex-1 items-center gap-1.5 rounded-3xl border border-line bg-card p-1.5">
					<button
						aria-label="添加附件"
						className="flex size-9 shrink-0 items-center justify-center rounded-full text-ink"
					>
						<span className="icon-[lucide--plus] size-[22px]" />
					</button>
					<span className="min-w-0 flex-1 truncate py-2 text-[16px] leading-[22px] text-dim">{placeholder}</span>
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
					<span className={`${running ? "icon-[mdi--stop]" : "icon-[lucide--arrow-up]"} size-[22px]`} />
				</button>
			</div>
			{meta && (
				<div className="mt-2 flex items-center gap-3.5 px-3 text-[12px] leading-4 text-dim tabular-nums">
					<span className="flex items-center gap-1">
						<span className="icon-[lucide--shield-check] size-3.5" />
						{meta.mode}
					</span>
					<span className="flex items-center gap-1.5">
						<span className="relative h-1 w-10 overflow-hidden rounded-full bg-line">
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
				</div>
			)}
		</div>
	);
}
