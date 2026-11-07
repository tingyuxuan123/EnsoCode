import body from "../assets/mark-a-body.svg";
import dropShape from "../assets/mark-a-drop.svg";
import runningLight from "../assets/running-light.svg";
import runningLightSmall from "../assets/running-light-s.svg";
import runningDark from "../assets/running-dark.svg";
import runningDarkSmall from "../assets/running-dark-s.svg";

function Layer({ src, color }: { src: string; color: string }) {
	// Vite 可能把小 SVG 内联成带空格与单引号的 data URI，url() 必须带双引号。
	const url = `url("${src}")`;
	return (
		<span
			aria-hidden
			className="absolute inset-0"
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

/** 雨帘双层遮罩；不传 drop 时整枚同色，可用在通知栏、扫码与离线状态。 */
export function EavesMark({
	size = 24,
	color = "currentColor",
	drop,
	className = "",
}: {
	size?: number;
	color?: string;
	drop?: string;
	className?: string;
}) {
	return (
		<span
			role="img"
			aria-label="Eaves · 檐下"
			className={`relative inline-block shrink-0 ${className}`}
			style={{ width: size, height: size }}
		>
			<Layer
				src={body}
				color={color}
			/>
			<Layer
				src={dropShape}
				color={drop ?? color}
			/>
		</span>
	);
}

/** SVG 自带雨丝与雨滴动画、reduced-motion 静态回退；小尺寸用加粗版本。 */
export function RunningMark({ size = 24, tone = "light" }: { size?: number; tone?: "light" | "dark" }) {
	const src = tone === "dark"
		? (size <= 24 ? runningDarkSmall : runningDark)
		: (size <= 24 ? runningLightSmall : runningLight);
	return (
		<img
			src={src}
			alt="Eaves 运行中"
			className="inline-block shrink-0"
			style={{ width: size, height: size }}
		/>
	);
}

/** 白圆底上的雨帘；保留原头像的 size / working 签名。 */
export function AgentAvatar({ size = 24, working = false }: { size?: number; working?: boolean }) {
	const markSize = Math.round(size * 0.82);
	return (
		<span
			className="flex shrink-0 items-center justify-center rounded-full bg-card text-ink shadow-[0_0_0_0.75px_rgb(0_0_0/0.06),0_2px_6px_rgb(0_0_0/0.06)]"
			style={{ width: size, height: size }}
		>
			{working ? (
				<RunningMark size={markSize} />
			) : (
				<EavesMark
					size={markSize}
					drop="var(--color-blue)"
				/>
			)}
		</span>
	);
}
