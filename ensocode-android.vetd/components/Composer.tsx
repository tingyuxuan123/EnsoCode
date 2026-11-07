/**
 * 输入框（Composer.kt）：白底圆角 24 的输入条，左边附件、右边语音，
 * 外侧一枚 48 的墨黑发送键。`meta` 在下面放审批模式和上下文占用。
 */
export function Composer({ placeholder, meta = false }: { placeholder: string; meta?: boolean }) {
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
					aria-label="发送"
					className="flex size-12 shrink-0 items-center justify-center rounded-full bg-pill text-pill-ink"
				>
					<span className="icon-[lucide--arrow-up] size-[22px]" />
				</button>
			</div>
			{meta && (
				<div className="mt-2 flex items-center gap-4 px-3 text-[12px] leading-4 text-dim">
					<span className="flex items-center gap-1">
						<span className="icon-[lucide--shield-check] size-3.5" />
						手动审批
					</span>
					<span className="flex items-center gap-1.5">
						<span className="relative h-1 w-10 overflow-hidden rounded-full bg-line">
							<span className="absolute inset-y-0 left-0 w-[38%] rounded-full bg-ink2" />
						</span>
						上下文 38%
					</span>
					<span className="ml-auto">@ 文件 · / 技能</span>
				</div>
			)}
		</div>
	);
}
