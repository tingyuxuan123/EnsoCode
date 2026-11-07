/**
 * EnsoCode 的圆相：一笔没有闭合的圆，缺口在右下，和桌面端图标一致。
 * 在 Agent 头像里用它；`working` 时缓慢旋转，表示正在干活。
 */
export function Enso({
	size = 24,
	stroke,
	working = false,
	className = "",
}: {
	size?: number;
	stroke?: number;
	working?: boolean;
	className?: string;
}) {
	const width = stroke ?? Math.max(2, Math.round(size * 0.13));
	const mask = "conic-gradient(from 122deg, transparent 0deg 30deg, #000 30deg 360deg)";
	return (
		<span
			aria-hidden
			className={`inline-block shrink-0 rounded-full ${working ? "animate-[spin_2.4s_linear_infinite]" : ""} ${className}`}
			style={{
				width: size,
				height: size,
				border: `${width}px solid currentColor`,
				WebkitMaskImage: mask,
				maskImage: mask,
			}}
		/>
	);
}

/** Agent 的头像：白色圆底上一枚圆相。 */
export function AgentAvatar({ size = 24, working = false }: { size?: number; working?: boolean }) {
	return (
		<span
			className="flex shrink-0 items-center justify-center rounded-full bg-card text-ink shadow-[0_0_0_0.75px_rgb(0_0_0/0.06),0_2px_6px_rgb(0_0_0/0.06)]"
			style={{ width: size, height: size }}
		>
			<Enso
				size={Math.round(size * 0.58)}
				working={working}
			/>
		</span>
	);
}
