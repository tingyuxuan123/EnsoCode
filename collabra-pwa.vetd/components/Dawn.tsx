// 左上紫、右侧蓝的晨光，取自 Logo 渐变；到页面中段淡回底色。
export function Dawn() {
	return (
		<div
			className="pointer-events-none absolute inset-x-0 top-0 h-[520px]"
			style={{
				background:
					"radial-gradient(90% 62% at 0% 0%, var(--color-dawn-side) 0%, transparent 70%), radial-gradient(85% 58% at 100% 6%, var(--color-dawn) 0%, transparent 72%)",
			}}
		/>
	);
}
