export const frame = { width: 1600, height: 1000, title: "运行中 · 一滴一圈" };

import { Mark, RunningMark } from "../components/Mark";

const timing = [
	{ part: "中间那一滴", how: "2.6 秒一轮：从上方 14% 处落下，停住、涟漪散尽后淡出，再落下一滴" },
	{ part: "涟漪", how: "和那一滴同时出生，从 0.5 倍扩到 1.25 倍，1.4 秒散完——它就是标志的圈再大一圈" },
	{ part: "圈本身", how: "不动。停手的那一刻涟漪消失，剩下的正好是静止的标志" },
	{ part: "24 像素及以下", how: "只留滴落的节奏，涟漪不画：2 像素的一圈看不见，只会把圈糊脏" },
	{ part: "减少动态效果", how: "系统开了「减少动态效果」时停住，就是静止的标志" },
];

const sizes = [16, 20, 24, 32, 48];

/** 干活的节奏就是水滴的节奏：一滴落下，涟漪扩开，再一滴。 */
export default function RunningFrame() {
	return (
		<div className="grid h-full grid-cols-[minmax(0,1fr)_minmax(0,1fr)] bg-paper font-sans text-ink">
			<section className="flex flex-col px-24 pt-20 pb-16">
				<h1 className="font-cn text-[50px] leading-[60px] font-semibold tracking-[0.01em]">运行中：一滴，一圈</h1>
				<p className="mt-4 max-w-[600px] text-[17px] leading-[28px] text-ink2">
					它在干活的时候，就一滴一滴地落：每落一滴，圈往外扩一圈。停了，水也就静了。
				</p>
				<div className="mt-10 flex items-center gap-14">
					<RunningMark size={300} />
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
						<RunningMark
							size={22}
							ripple={false}
						/>
						<span className="text-ink2">生成中…</span>
						<span className="font-mono text-[11px] text-dim">12s</span>
					</div>
				</div>
				<div className="flex items-center gap-3 rounded-[20px] bg-night px-6 py-5 text-[13px]">
					<span className="w-10 text-[12px] text-night-dim">深色</span>
					<RunningMark
						size={22}
						color="var(--color-night-dim)"
						drop="var(--color-rain)"
						ripple={false}
					/>
					<span className="text-night-ink">生成中…</span>
					<span className="font-mono text-[11px] text-night-dim">12s</span>
				</div>
				<p className="text-[14px] leading-[22px] text-dim">
					圈用正文的次级灰，那一滴用界面里的蓝。尺寸和现在的 22px 占位一致，换上去不会挤动文字。
				</p>

				<h2 className="mt-6 text-[15px] leading-5 font-medium text-dim">安卓端</h2>
				<div className="rounded-[20px] bg-paper">
					<div className="flex items-center gap-3 px-5 py-3.5">
						<div className="min-w-0 flex-1">
							<div className="truncate text-[16px] leading-[22px] font-medium">工作流面板显示运行进度</div>
							<div className="text-[12px] leading-4 text-ink2">小满　2 分钟前</div>
						</div>
						<RunningMark
							size={20}
							ripple={false}
						/>
					</div>
					<div className="flex items-center gap-2 px-5 pt-1 pb-4 text-[12px]">
						<Mark
							size={18}
							drop="var(--color-rain-deep)"
						/>
						<span className="text-[15px] font-semibold">小满</span>
						<span className="text-dim">2 分钟前</span>
						<RunningMark
							size={16}
							ripple={false}
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
							<RunningMark
								size={s}
								ripple={s >= 32}
							/>
							<figcaption className="text-[12px] leading-4 text-dim tabular-nums">{s}</figcaption>
						</figure>
					))}
				</div>
			</section>
		</div>
	);
}
