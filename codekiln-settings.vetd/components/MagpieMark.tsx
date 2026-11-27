import magpie from "../assets/brands/magpie.svg";

/** Magpie 官方 mark（44×44 单色路径），用 mask 染成品牌橙。 */
export function MagpieMark({ size = 18 }: { size?: number }) {
	const mask = `url(${JSON.stringify(magpie)})`;
	return (
		<span
			aria-hidden
			className="inline-block shrink-0 bg-brand"
			style={{
				width: size,
				height: size,
				maskImage: mask,
				maskPosition: "center",
				maskRepeat: "no-repeat",
				maskSize: "contain",
				WebkitMaskImage: mask,
				WebkitMaskPosition: "center",
				WebkitMaskRepeat: "no-repeat",
				WebkitMaskSize: "contain",
			}}
		/>
	);
}
