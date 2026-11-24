/**
 * 状态栏上的上下文圆环，几何照抄应用里的 ContextMeter（viewBox 12、半径 5、线宽 1.75、-90° 起画），
 * 只把像素尺寸做成参数，方便同时看"实际 12px"和放大后的弧长。
 *
 * 三档色是应用里真实存在的门槛，不是设计稿自己定的：
 * - < 70%：text-muted-foreground/60（灰）
 * - ≥ 70%：text-warning（警示黄 #d9b463）
 * - ≥ 90%：text-destructive（危险红 #ea8a7d），并且整段文字也一起变红
 */
const R = 5;
const STROKE = 1.75;
const CIRC = 2 * Math.PI * R;

export type ContextTone = "normal" | "half" | "warning" | "critical";

export function toneOf(percent: number): ContextTone {
	if (percent >= 90) return "critical";
	if (percent >= 70) return "warning";
	return percent >= 50 ? "half" : "normal";
}

const TONE_COLOR: Record<ContextTone, string> = {
	normal: "#ababad99",
	half: "#ababad",
	warning: "#d9b463",
	critical: "#ea8a7d",
};

export function ContextRing({ percent, size = 12 }: { percent: number; size?: number }) {
	const clamped = Math.min(100, Math.max(0, percent));
	const color = TONE_COLOR[toneOf(clamped)];
	return (
		<svg
			viewBox="0 0 12 12"
			width={size}
			height={size}
			className="-rotate-90"
			aria-hidden
		>
			<circle cx="6" cy="6" r={R} fill="none" stroke={color} strokeOpacity={0.18} strokeWidth={STROKE} />
			<circle
				cx="6"
				cy="6"
				r={R}
				fill="none"
				stroke={color}
				strokeWidth={STROKE}
				strokeLinecap="round"
				strokeDasharray={`${(clamped / 100) * CIRC} ${CIRC}`}
			/>
		</svg>
	);
}

/** 状态栏里的一段：环 + 百分数，颜色随门槛整段变。 */
export function ContextSegment({ percent, size = 12 }: { percent: number; size?: number }) {
	const tone = toneOf(percent);
	const text =
		tone === "critical"
			? "text-[#ea8a7d]"
			: tone === "warning"
				? "text-[#d9b463]"
				: tone === "half"
					? "text-ink"
					: "text-muted";
	return (
		<span className={`flex items-center gap-[5px] tabular-nums text-[11px] ${text}`}>
			<ContextRing percent={percent} size={size} />
			{percent}%
		</span>
	);
}
