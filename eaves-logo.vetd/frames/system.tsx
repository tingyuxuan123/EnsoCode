export const frame = { width: 1600, height: 1000, title: "A 雨帘 · 用在各处" };

import { AppIcon, Mark } from "../components/Mark";

const masks = [
	{ radius: "50%", label: "圆形" },
	{ radius: "30%", label: "圆角方形" },
	{ radius: "38% / 38%", label: "超椭圆" },
];

const colours = [
	{ name: "墨", hex: "#0B0C0E", use: "图标底、浅色界面的标志", cls: "bg-ink" },
	{ name: "纸", hex: "#F4F5F7", use: "深色底上的标志", cls: "bg-paper shadow-[inset_0_0_0_1px_var(--color-line)]" },
	{ name: "雨", hex: "#3B82F6", use: "图标底、深色界面里的那一滴", cls: "bg-rain" },
	{ name: "雨·深", hex: "#2563EB", use: "浅色界面里的那一滴", cls: "bg-rain-deep" },
];

function Wordmark({ dark = false }: { dark?: boolean }) {
	return (
		<div className="flex items-center gap-5">
			<Mark
				size={76}
				color={dark ? "var(--color-night-ink)" : "var(--color-ink)"}
				drop={dark ? "var(--color-rain)" : "var(--color-rain-deep)"}
			/>
			<span className={`font-display text-[84px] leading-none font-medium tracking-[-0.03em] ${dark ? "text-night-ink" : "text-ink"}`}>
				Eaves
			</span>
			<span className={`font-cn text-[34px] leading-none ${dark ? "text-night-dim" : "text-dim"}`}>檐下</span>
		</div>
	);
}

/** 定稿方案落到各处：安卓图标遮罩、字标、通知栏、快捷磁贴、桌面端图标、颜色。 */
export default function System() {
	return (
		<div className="grid h-full grid-cols-[1fr_1fr] grid-rows-[1fr_auto] bg-paper font-sans text-ink">
			<section className="flex flex-col px-24 pt-20">
				<h1 className="text-[15px] leading-5 font-medium text-dim">安卓启动图标 · 各厂商遮罩</h1>
				<div className="mt-8 flex gap-12">
					{masks.map((m) => (
						<figure
							key={m.label}
							className="flex flex-col items-center gap-3"
						>
							<AppIcon
								size={160}
								radius={m.radius}
							/>
							<figcaption className="text-[14px] leading-5 text-dim">{m.label}</figcaption>
						</figure>
					))}
				</div>
				<p className="mt-6 max-w-[600px] text-[15px] leading-[25px] text-ink2">
					自适应图标的前景只占中间 66%，图形放在安全区里，无论系统裁成哪种形状都不会切到翘角。
				</p>

				<h2 className="mt-14 text-[15px] leading-5 font-medium text-dim">字标</h2>
				<div className="mt-6">
					<Wordmark />
				</div>
			</section>

			<section className="flex flex-col gap-6 bg-night px-20 pt-20 text-night-ink">
				<h2 className="text-[15px] leading-5 font-medium text-night-dim">在手机和桌面上</h2>
				<div className="flex items-center gap-3 rounded-[20px] bg-night-card px-5 py-3.5">
					<span className="text-[15px] font-medium tabular-nums">14:08</span>
					<Mark
						size={18}
						color="var(--color-night-ink)"
					/>
					<span className="icon-[lucide--message-circle] size-[18px] text-night-dim" />
					<span className="ml-auto flex items-center gap-2 text-night-dim">
						<span className="icon-[lucide--wifi] size-[18px]" />
						<span className="icon-[lucide--battery-medium] size-[18px]" />
					</span>
				</div>
				<div className="flex gap-3 rounded-[24px] bg-night-card px-5 py-4">
					<span className="flex h-[18px] shrink-0 items-center">
						<Mark
							size={20}
							color="var(--color-night-ink)"
						/>
					</span>
					<div className="min-w-0 flex-1">
						<div className="text-[13px] leading-[18px] text-night-dim">Eaves · 会话恢复后时间线为空 · 现在</div>
						<div className="mt-1 text-[16px] leading-[22px] font-semibold">它想运行一条命令</div>
					</div>
				</div>
				<div className="flex items-center gap-8">
					<div className="flex h-[72px] w-[260px] items-center gap-4 rounded-full bg-night-ink px-6 text-night">
						<Mark
							size={30}
							color="var(--color-night)"
						/>
						<div>
							<div className="text-[16px] leading-5 font-semibold">新任务</div>
							<div className="text-[13px] leading-[18px] opacity-60">Eaves</div>
						</div>
					</div>
					<figure className="flex items-center gap-4">
						<AppIcon
							size={112}
							radius="22.5%"
						/>
						<figcaption className="text-[14px] leading-5 text-night-dim">桌面端图标</figcaption>
					</figure>
				</div>
				<div className="mt-4">
					<Wordmark dark />
				</div>
			</section>

			<footer className="col-span-2 flex items-center gap-14 bg-card px-24 py-9">
				{colours.map((c) => (
					<div
						key={c.hex}
						className="flex items-center gap-4"
					>
						<span className={`size-14 shrink-0 rounded-2xl ${c.cls}`} />
						<div>
							<div className="text-[16px] leading-[22px] font-semibold">
								{c.name}
								<span className="ml-2 font-mono text-[14px] font-normal text-dim">{c.hex}</span>
							</div>
							<div className="text-[14px] leading-5 text-dim">{c.use}</div>
						</div>
					</div>
				))}
				<div className="ml-auto text-right text-[14px] leading-[22px] text-dim">
					最小 16 像素
					<br />
					四周留出标志宽度的 1/4
				</div>
			</footer>
		</div>
	);
}
