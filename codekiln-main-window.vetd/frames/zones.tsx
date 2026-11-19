export const frame = { width: 1280, height: 1080, title: "局部放大 · 三处接缝" };

import { AppWindow } from "../components/AppWindow";
import type { Variant } from "../components/variant";

const SCALE = 2.6;

function Crop({
	variant,
	x,
	y,
	w,
	h,
}: {
	variant: Variant;
	x: number;
	y: number;
	w: number;
	h: number;
}) {
	return (
		<div
			className="relative shrink-0 overflow-hidden rounded-block bg-paper shadow-[inset_0_0_0_1px_var(--color-line)]"
			style={{ width: w * SCALE, height: h * SCALE }}
		>
			<div
				style={{
					width: 1280,
					height: 770,
					transform: `translate(${-x * SCALE}px, ${-y * SCALE}px) scale(${SCALE})`,
					transformOrigin: "top left",
				}}
			>
				<AppWindow variant={variant} />
			</div>
		</div>
	);
}

const zones = [
	{
		title: "① 侧栏与纸的接缝",
		note: "现状：缝是轨道色 #f8f8f8 —— 轨道 / 侧栏 / 缝 / 纸，四种近白相邻。统一后：缝并入侧栏那一档 #fcfcfc，6 → 4px，窗口只剩三级明度。",
		x: 244,
		y: 40,
		w: 170,
		h: 110,
	},
	{
		title: "② 页签带交界",
		note: "现状：聊天栏 35px、面板 39px，两条带各自画下划线，面板的整条竖线与下划线打成 T。统一后：一条 40px 带横贯整块纸，竖线从带子下缘才开始。",
		x: 828,
		y: 40,
		w: 170,
		h: 110,
	},
	{
		title: "③ 设备行与圆角刻度",
		note: "现状：设备卡 10px、按钮 6px、页签 6px，与卡片的 12 不是一套刻度。统一后：块 8 / 控件 5 / 输入框 10 / 卡 12，四档各有职责。",
		x: 884,
		y: 196,
		w: 200,
		h: 120,
	},
];

export default function Zones() {
	return (
		<div className="flex h-full flex-col gap-6 bg-rail px-8 py-7 text-ink">
			<div className="flex items-baseline gap-3">
				<h1 className="text-[15px] font-semibold">三处接缝，放大 2.6×</h1>
				<span className="text-[12px] text-muted">
					左：现状 · 右：统一后。配色、字体、轨道与栏宽都不动，只动这三处。
				</span>
			</div>
			<div className="flex flex-col gap-6">
				{zones.map((zone) => (
					<div key={zone.title} className="flex items-start gap-6">
						<div className="w-[250px] shrink-0 pt-1">
							<div className="text-[13px] font-medium">{zone.title}</div>
							<p className="mt-2 text-[11.5px] text-muted leading-[1.85]">{zone.note}</p>
						</div>
						<div className="flex gap-5">
							<div className="flex flex-col gap-2">
								<span className="text-[11px] text-subtle">现状</span>
								<Crop variant="current" x={zone.x} y={zone.y} w={zone.w} h={zone.h} />
							</div>
							<div className="flex flex-col gap-2">
								<span className="text-[11px] text-subtle">统一后</span>
								<Crop variant="unified" x={zone.x} y={zone.y} w={zone.w} h={zone.h} />
							</div>
						</div>
					</div>
				))}
			</div>
		</div>
	);
}
