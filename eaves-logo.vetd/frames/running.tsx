export const frame = { width: 1600, height: 1000, title: "运行中 · 动态图标" };

import brand from "../assets/running-brand.svg";
import brandS from "../assets/running-brand-s.svg";
import dark from "../assets/running-dark.svg";
import darkS from "../assets/running-dark-s.svg";
import light from "../assets/running-light.svg";
import lightS from "../assets/running-light-s.svg";
import { Mark } from "../components/Mark";

const files = {
	light: { large: light, small: lightS },
	dark: { large: dark, small: darkS },
	brand: { large: brand, small: brandS },
};

/** 24px 及以下自动换小尺寸版：线条更粗、雨滴更大，原尺寸下也看得出在下雨。 */
function Running({ tone, size }: { tone: keyof typeof files; size: number }) {
	const src = size <= 24 ? files[tone].small : files[tone].large;
	return (
		<img
			src={src}
			alt="运行中"
			width={size}
			height={size}
			className="shrink-0"
			style={{ width: size, height: size }}
		/>
	);
}

const timing = [
	{ part: "檐口", how: "不动。图标的轮廓始终是标志本身，一眼认得出是谁在干活" },
	{ part: "两侧雨丝", how: "匀速下落，1 秒和 1.15 秒两种周期错开，不会齐步走；从檐下淡入，到底部淡出" },
	{ part: "中间那一滴", how: "1.2 秒一轮：先在檐下长出来，再加速落下、淡出，像真的雨滴" },
	{ part: "小尺寸版", how: "24px 及以下换一套：线条加粗、雨滴放大且从不缩到看不见，去掉中间那根短线" },
	{ part: "减少动态效果", how: "系统开了「减少动态效果」时停住，就是静止的标志" },
];

const sizes = [16, 20, 24, 32, 48];

/** 运行中的动态图标：替换桌面端时间线里「生成中…」前面的那个绿点，安卓端的运行中状态也用它。 */
export default function RunningFrame() {
	return (
		<div className="grid h-full grid-cols-[minmax(0,1fr)_minmax(0,1fr)] bg-paper font-sans text-ink">
			<section className="flex flex-col px-24 pt-20 pb-16">
				<h1 className="font-display text-[52px] leading-[60px] font-medium tracking-[-0.02em]">运行中：檐下在下雨</h1>
				<p className="mt-4 max-w-[600px] text-[17px] leading-[28px] text-ink2">
					Agent 干活的时候，屋檐下的雨就一直在下；停了，雨也就停了。
				</p>
				<div className="mt-10 flex items-center gap-14">
					<Running
						tone="light"
						size={300}
					/>
					<div className="flex flex-col items-center gap-8">
						<Mark
							size={96}
							drop="var(--color-rain-deep)"
							label="静止的标志"
						/>
						<span className="text-[14px] leading-5 text-dim">停下时就是标志</span>
					</div>
				</div>
				<dl className="mt-12 grid grid-cols-[120px_minmax(0,1fr)] gap-x-6 gap-y-3 text-[15px] leading-[24px]">
					{timing.map((t) => (
						<div
							key={t.part}
							className="contents"
						>
							<dt className="font-semibold">{t.part}</dt>
							<dd className="text-ink2">{t.how}</dd>
						</div>
					))}
				</dl>
			</section>

			<section className="flex flex-col gap-5 bg-card px-20 pt-20 pb-16">
				<h2 className="text-[15px] leading-5 font-medium text-dim">桌面端时间线，原尺寸</h2>
				<div className="flex flex-col gap-3 rounded-[20px] bg-paper px-6 py-5">
					<div className="flex items-center gap-3 text-[13px]">
						<span className="w-10 text-[12px] text-faint">现在</span>
						<span className="relative flex size-[22px] shrink-0 items-center justify-center">
							<span className="absolute size-2 animate-ping rounded-full bg-green/50" />
							<span className="relative size-2 rounded-full bg-green" />
						</span>
						<span className="text-ink2">生成中…</span>
						<span className="font-mono text-[11px] text-dim">0s</span>
					</div>
					<div className="flex items-center gap-3 text-[13px]">
						<span className="w-10 text-[12px] text-faint">换成</span>
						<Running
							tone="brand"
							size={22}
						/>
						<span className="text-ink2">生成中…</span>
						<span className="font-mono text-[11px] text-dim">12s</span>
					</div>
				</div>
				<div className="flex items-center gap-3 rounded-[20px] bg-night px-6 py-5 text-[13px]">
					<span className="w-10 text-[12px] text-night-dim">深色</span>
					<Running
						tone="dark"
						size={22}
					/>
					<span className="text-night-ink">生成中…</span>
					<span className="font-mono text-[11px] text-night-dim">12s</span>
				</div>
				<p className="text-[14px] leading-[22px] text-dim">
					檐口和雨丝用正文的次级灰，那一滴跟随桌面的强调色（截图里是绿）。尺寸和现在的 22px 占位一致，换上去不会挤动文字。
				</p>

				<h2 className="mt-6 text-[15px] leading-5 font-medium text-dim">安卓端</h2>
				<div className="rounded-[20px] bg-paper">
					<div className="flex items-center gap-3 px-5 py-3.5">
						<div className="min-w-0 flex-1">
							<div className="truncate text-[16px] leading-[22px] font-medium">工作流面板显示运行进度</div>
							<div className="text-[12px] leading-4 text-ink2">EnsoCode　2 分钟前</div>
						</div>
						<Running
							tone="light"
							size={20}
						/>
					</div>
					<div className="flex items-center gap-2 px-5 pt-1 pb-4 text-[12px]">
						<Mark
							size={18}
							drop="var(--color-rain-deep)"
						/>
						<span className="text-[15px] font-semibold">Eaves</span>
						<span className="text-dim">2 分钟前</span>
						<Running
							tone="light"
							size={16}
						/>
						<span className="text-dim">正在运行测试</span>
					</div>
				</div>

				<h2 className="mt-8 text-[15px] leading-5 font-medium text-dim">各尺寸</h2>
				<div className="flex items-end gap-8">
					{sizes.map((s) => (
						<figure
							key={s}
							className="flex flex-col items-center gap-2"
						>
							<Running
								tone="light"
								size={s}
							/>
							<figcaption className="text-[12px] leading-4 text-dim tabular-nums">{s}</figcaption>
						</figure>
					))}
				</div>
			</section>
		</div>
	);
}
