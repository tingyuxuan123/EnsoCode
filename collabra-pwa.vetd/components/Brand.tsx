import Avatar from "boring-avatars";
import mark from "../assets/collabra-mark.png";
import { avatarPalette, memberColor } from "./avatarPalette";

// CodeKiln 的 C 字标，透明底。
export function BrandMark({ size = 24 }: { size?: number }) {
	return (
		<img
			src={mark}
			alt="CodeKiln"
			className="shrink-0 object-contain"
			style={{ width: size, height: size }}
		/>
	);
}

// 运行中：一段蓝色圆弧，取代安卓稿里的雨帘。
export function RunningMark({ size = 14 }: { size?: number }) {
	return (
		<span
			aria-label="运行中"
			className="inline-block shrink-0 animate-spin rounded-full border-2 border-blue/25 border-t-blue"
			style={{ width: size, height: size }}
		/>
	);
}

// Agent 头像：白圆底托 Logo，工作时有蓝环。
export function AgentAvatar({ size = 22, working = false }: { size?: number; working?: boolean }) {
	return (
		<span
			className={`flex shrink-0 items-center justify-center rounded-full bg-card shadow-[0_0_0_0.75px_rgb(0_0_0/0.08)] ${
				working ? "ring-1 ring-blue/40" : ""
			}`}
			style={{ width: size, height: size }}
		>
			<BrandMark size={Math.round(size * 0.74)} />
		</span>
	);
}

// 成员头像：与桌面端、PWA 完全同源——boring-avatars 的 beam 变体，
// 颜色由成员色派生 5 色板。这是全 app 唯一允许出现的"身份色"。
export function MemberAvatar({
	name,
	size = 30,
	online = false,
}: {
	name: string;
	size?: number;
	online?: boolean;
}) {
	return (
		<span
			className="relative inline-flex shrink-0"
			style={{ width: size, height: size }}
		>
			<span
				className="flex overflow-hidden rounded-full bg-card2"
				style={{ width: size, height: size }}
			>
				<Avatar
					name={name}
					variant="beam"
					colors={avatarPalette(memberColor(name))}
					size="100%"
				/>
			</span>
			{online && (
				<span className="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full border-2 border-page bg-green" />
			)}
		</span>
	);
}
