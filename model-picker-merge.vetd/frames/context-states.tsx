export const frame = { width: 960, height: 388, title: "上下文占用 · 3% / 50% / 72% / 93%" };

import { ContextRing, ContextSegment, toneOf } from "../components/ContextRing";

/** 真实几何下 50% 的环：半圆，颜色仍是常态灰——低于 70% 的门槛，界面不该报警 */
const STEPS = [
	{ percent: 3, note: "刚开聊：弧长几乎看不见，只剩一圈淡底线" },
	{ percent: 50, note: "半程：半圆，环与数字提亮一档（仍不是警示色）" },
	{ percent: 72, note: "越过 70%：环与数字一起转警示黄" },
	{ percent: 93, note: "越过 90%：环与整段文字一起转危险红" },
];

/** 上下文弹层的真实分桶（500K / 1M · 50%），合计 500K */
const BUCKETS = [
	{ label: "System prompt", tokens: "12.4K", share: 2.5 },
	{ label: "Enabled instructions", tokens: "38.1K", share: 7.6 },
	{ label: "Enabled skills", tokens: "9.6K", share: 1.9 },
	{ label: "Tool definitions", tokens: "96.2K", share: 19.2 },
	{ label: "Conversation", tokens: "331.5K", share: 66.3 },
	{ label: "Compaction summary", tokens: "0", share: 0 },
	{ label: "Reminders", tokens: "12.2K", share: 2.4 },
];

export default function ContextStates() {
	return (
		<div className="flex h-full gap-8 bg-ground px-8 py-8">
			<div className="flex min-w-0 flex-1 flex-col">
				<p className="text-[11px] text-faint">状态栏右侧那一段 · 4 个占比</p>
				<p className="mt-1 text-[13px] font-medium text-ink">
					50% 是「半圆，提亮一档，仍不报警」
				</p>

				<div className="mt-4 rounded-[10px] bg-sunken px-3 py-2.5 ring-1 ring-inset ring-white/[0.06]">
					<p className="mb-2 text-[11px] text-faint">实际尺寸：环 12px，数字 11px</p>
					<div className="flex items-center gap-4">
						{STEPS.map((step) => (
							<ContextSegment key={step.percent} percent={step.percent} />
						))}
					</div>
				</div>

				<div className="mt-5 flex gap-4">
					{STEPS.map((step) => (
						<div key={step.percent} className="flex min-w-0 flex-1 flex-col items-start gap-2">
							<div className="flex items-center gap-2">
								<ContextRing percent={step.percent} size={34} />
								<span
									className={`text-[12px] tabular-nums ${
										toneOf(step.percent) === "critical"
											? "text-[#ea8a7d]"
											: toneOf(step.percent) === "warning"
												? "text-[#d9b463]"
												: toneOf(step.percent) === "half"
													? "text-ink"
													: "text-muted"
									}`}
								>
									{step.percent}%
								</span>
							</div>
							<p className="text-[11px] leading-4 text-faint">{step.note}</p>
						</div>
					))}
				</div>

				<p className="mt-5 border-t border-hairline pt-3 text-[11px] leading-4 text-faint">
					门槛来自代码：50% 提亮一档（色相不变）、70% 转 warning、90% 转 destructive。
					悬停任一段给出「上下文窗口 · 1M · 50%」，点开是右边的分桶。
				</p>
			</div>

			<div className="flex w-[248px] shrink-0 flex-col">
				<p className="mb-2 text-[11px] text-faint">点开：50% 时的上下文弹层</p>
				<div className="rounded-[8px] bg-surface p-2 ring-1 ring-inset ring-white/[0.08]">
					<div className="flex items-baseline justify-between gap-2 text-[11px]">
						<span className="tabular-nums text-ink">500K / 1M · 50%</span>
						<span className="text-faint">估算</span>
					</div>
					<ul className="mt-2 flex flex-col gap-1">
						{BUCKETS.map((bucket) => (
							<li key={bucket.label} className="flex items-center gap-2 text-[11px]">
								<span className="w-[112px] shrink-0 truncate text-faint">{bucket.label}</span>
								<span className="min-w-0 flex-1">
									<span className="block h-[3px] overflow-hidden rounded-full bg-white/[0.08]">
										<span
											className="block h-full bg-white/40"
											style={{ width: `${bucket.share}%` }}
										/>
									</span>
								</span>
								<span className="w-[34px] shrink-0 text-right tabular-nums text-muted">
									{bucket.tokens}
								</span>
							</li>
						))}
					</ul>
					<div className="mt-2 rounded-[4px] border border-white/[0.12] px-2 py-[3px] text-center text-[11px] text-ink/90">
						压缩上下文
					</div>
				</div>
				<p className="mt-2 text-[11px] leading-4 text-faint">
					50% 时还没有折叠过旧消息，所以没有「N 条消息已折叠」那两行。
				</p>
			</div>
		</div>
	);
}
