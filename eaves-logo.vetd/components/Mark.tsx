import aBody from "../assets/mark-a-body.svg";
import aDrop from "../assets/mark-a-drop.svg";
import bBody from "../assets/mark-b-body.svg";
import bDrop from "../assets/mark-b-drop.svg";
import cBody from "../assets/mark-c-body.svg";
import cDrop from "../assets/mark-c-drop.svg";

const shapes = {
	a: { body: aBody, drop: aDrop },
	b: { body: bBody, drop: bDrop },
	c: { body: cBody, drop: cDrop },
};

export type MarkKind = keyof typeof shapes;

function Layer({ src, color }: { src: string; color: string }) {
	// 小 SVG 会被内联成 data URI（带单引号和空格），url() 必须加双引号，否则整条属性失效。
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

/**
 * 标志图形：本体一层、雨滴一层，分别上色。`drop` 不给时整只标志同色（通知栏单色图标就是这样）。
 * 图形本身是 assets/mark-*.svg，可以直接转成安卓的 VectorDrawable。
 */
export function Mark({
	kind = "a",
	size,
	color = "var(--color-ink)",
	drop,
	label = "Eaves 标志",
}: {
	kind?: MarkKind;
	size: number;
	color?: string;
	drop?: string;
	label?: string;
}) {
	const s = shapes[kind];
	return (
		<span
			role="img"
			aria-label={label}
			className="relative inline-block shrink-0"
			style={{ width: size, height: size }}
		>
			<Layer
				src={s.body}
				color={color}
			/>
			<Layer
				src={s.drop}
				color={drop ?? color}
			/>
		</span>
	);
}

/** 应用图标：墨色底，顶边一道高光（图标是浮在桌面上的物件）。`radius` 按百分比给遮罩形状。 */
export function AppIcon({
	kind = "a",
	size,
	radius = "22.5%",
}: {
	kind?: MarkKind;
	size: number;
	radius?: string;
}) {
	return (
		<span
			className="relative inline-flex shrink-0 items-center justify-center bg-ink"
			style={{
				width: size,
				height: size,
				borderRadius: radius,
				boxShadow: "inset 0 1px 0 rgb(255 255 255 / 0.14), 0 1px 2px rgb(0 0 0 / 0.18), 0 10px 28px -10px rgb(0 0 0 / 0.45)",
			}}
		>
			<Mark
				kind={kind}
				size={Math.round(size * 0.6)}
				color="var(--color-night-ink)"
				drop="var(--color-rain)"
			/>
		</span>
	);
}
