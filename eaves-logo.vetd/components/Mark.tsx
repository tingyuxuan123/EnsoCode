import b2Body from "../assets/mark-b2-body.svg";
import bDrop from "../assets/mark-b-drop.svg";

function Layer({ src, color, className }: { src: string; color: string; className?: string }) {
	// 小 SVG 会被内联成 data URI（带单引号和空格），url() 必须加双引号，否则整条属性失效。
	const url = `url("${src}")`;
	return (
		<span
			aria-hidden
			className={`absolute inset-0 ${className ?? ""}`}
			style={{
				backgroundColor: color,
				WebkitMaskImage: url,
				maskImage: url,
				WebkitMaskSize: "100% 100%",
				maskSize: "100% 100%",
				WebkitMaskRepeat: "no-repeat",
				maskRepeat: "no-repeat",
			}}
		/>
	);
}

/** 白圈 + 蓝滴。`drop` 不给时整只标志同色，通知栏单色图标就是这样。 */
export function Mark({
	size,
	color = "var(--color-ink)",
	drop,
	label = "小满标志",
}: {
	size: number;
	color?: string;
	drop?: string;
	label?: string;
}) {
	return (
		<span
			role="img"
			aria-label={label}
			className="relative inline-block shrink-0"
			style={{ width: size, height: size }}
		>
			<Layer
				src={b2Body}
				color={color}
			/>
			<Layer
				src={bDrop}
				color={drop ?? color}
			/>
		</span>
	);
}

/**
 * 运行中：那一滴落下来，圈跟着往外扩一圈涟漪，散尽后再落下一滴。
 * 涟漪就是标志的圈再放大一圈，所以停下来时，剩下的正好是静止标志。
 * `ripple` 在 24 像素及以下关掉——2 像素的一圈看不见，只会糊。
 */
export function RunningMark({
	size,
	color = "var(--color-ink2)",
	drop = "var(--color-rain-deep)",
	ripple = true,
}: {
	size: number;
	color?: string;
	drop?: string;
	ripple?: boolean;
}) {
	return (
		<span
			role="img"
			aria-label="运行中"
			className="relative inline-block shrink-0"
			style={{ width: size, height: size }}
		>
			{ripple && (
				<Layer
					src={b2Body}
					color={drop}
					className="mark-ripple"
				/>
			)}
			<Layer
				src={b2Body}
				color={color}
			/>
			<Layer
				src={bDrop}
				color={drop}
				className="mark-drop"
			/>
		</span>
	);
}

/** 应用图标：黑底，顶边一道高光。`radius` 按百分比给遮罩形状。 */
export function AppIcon({ size, radius = "22.5%" }: { size: number; radius?: string }) {
	return (
		<span
			className="relative inline-flex shrink-0 items-center justify-center bg-ink"
			style={{
				width: size,
				height: size,
				borderRadius: radius,
				boxShadow:
					"inset 0 1px 0 rgb(255 255 255 / 0.14), 0 1px 2px rgb(0 0 0 / 0.18), 0 10px 28px -10px rgb(0 0 0 / 0.45)",
			}}
		>
			<Mark
				size={Math.round(size * 0.6)}
				color="var(--color-night-ink)"
				drop="var(--color-rain)"
			/>
		</span>
	);
}

/** 字标：宋体的「小满」，旁边一个拉丁小字。中文名不硬翻成 Grain Buds。 */
export function Wordmark({ dark = false, compact = false }: { dark?: boolean; compact?: boolean }) {
	return (
		<span className={`inline-flex items-end ${compact ? "gap-2.5" : "gap-5"}`}>
			<Mark
				size={compact ? 26 : 78}
				color={dark ? "var(--color-night-ink)" : "var(--color-ink)"}
				drop={dark ? "var(--color-rain)" : "var(--color-rain-deep)"}
			/>
			<span
				className={`font-cn font-semibold tracking-[0.02em] ${
					compact ? "text-[24px] leading-[0.9]" : "text-[84px] leading-[0.86]"
				} ${dark ? "text-night-ink" : "text-ink"}`}
			>
				小满
			</span>
			{!compact && (
				<span className={`mb-2 text-[12px] leading-none tracking-[0.34em] ${dark ? "text-night-dim" : "text-dim"}`}>
					XIAOMAN
				</span>
			)}
		</span>
	);
}
