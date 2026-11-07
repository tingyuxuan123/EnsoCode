export const frame = { width: 1600, height: 1000, title: "标志方案" };

import { AppIcon, Mark, type MarkKind } from "../components/Mark";

const others: { kind: MarkKind; name: string; text: string; tradeoff: string }[] = [
	{
		kind: "b",
		name: "B　圆相·一滴",
		text: "保留现在的圆相，圈里添一滴雨。老用户一眼认得出。",
		tradeoff: "但「檐」看不出来，像是 EnsoCode 换了个图标，而不是一个新名字。",
	},
	{
		kind: "c",
		name: "C　檐角",
		text: "侧看的飞檐翘角，雨从檐角一滴滴落下，像加载中的三个点。",
		tradeoff: "最有书法味，但细线加小圆点，到 24 像素会糊成一团。",
	},
];

/** 三个方案，A 推荐，所以 A 占了大半张。 */
export default function Concepts() {
	return (
		<div className="flex h-full flex-col bg-paper px-24 pt-20 pb-20 font-sans text-ink">
			<header className="flex items-baseline gap-6">
				<h1 className="font-display text-[56px] leading-[64px] font-medium tracking-[-0.02em]">Eaves 的标志</h1>
				<p className="font-cn text-[24px] text-dim">檐下听雨</p>
			</header>
			<p className="mt-4 max-w-[760px] text-[18px] leading-[30px] text-ink2">
				下雨天你坐在屋檐下，Agent 在外面干活，你不用出门，听着就行。三个方案都只用墨色，加一滴雨的蓝：界面里「运行中」就是这个蓝。
			</p>

			<div className="mt-14 flex min-h-0 flex-1 gap-20">
				<section className="flex flex-[1.35] gap-12">
					<AppIcon
						kind="a"
						size={400}
					/>
					<div className="flex min-w-0 flex-1 flex-col">
						<h2 className="text-[30px] leading-[38px] font-semibold">A　雨帘</h2>
						<p className="mt-1 text-[16px] leading-6 font-medium text-rain-deep">已选定（2026-11-07）</p>
						<p className="mt-5 text-[17px] leading-[29px] text-ink2">
							从屋檐下往外看：檐口在上，两端翘角；檐外的雨断断续续地落。长短交错的雨丝，也像 Agent 一行行吐出来的输出；中间那一滴蓝，是此刻还在跑的那件事。
						</p>
						<p className="mt-4 text-[17px] leading-[29px] text-ink2">圆头线条，和界面里的图标是同一套笔画；檐口粗、雨丝细，一眼分得出屋檐和雨。到 24 像素仍然清楚。</p>
						<div className="mt-auto flex flex-wrap items-end gap-x-7 gap-y-3">
							<AppIcon
								kind="a"
								size={96}
							/>
							<AppIcon
								kind="a"
								size={48}
							/>
							<span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-night">
								<Mark
									size={24}
									color="var(--color-night-ink)"
								/>
							</span>
							<Mark
								size={24}
								drop="var(--color-rain-deep)"
							/>
							<span className="w-full text-[14px] leading-5 text-dim">96 · 48 · 通知栏 24 · 正文里 24</span>
						</div>
					</div>
				</section>

				<aside className="flex w-[440px] shrink-0 flex-col gap-14">
					{others.map((o) => (
						<div
							key={o.kind}
							className="flex gap-7"
						>
							<AppIcon
								kind={o.kind}
								size={152}
							/>
							<div className="min-w-0 flex-1">
								<h2 className="text-[22px] leading-[30px] font-semibold">{o.name}</h2>
								<p className="mt-2 text-[16px] leading-[26px] text-ink2">{o.text}</p>
								<p className="mt-2 text-[16px] leading-[26px] text-dim">{o.tradeoff}</p>
								<div className="mt-4 flex items-center gap-4">
									<AppIcon
										kind={o.kind}
										size={40}
									/>
									<span className="flex size-10 items-center justify-center rounded-full bg-night">
										<Mark
											kind={o.kind}
											size={24}
											color="var(--color-night-ink)"
										/>
									</span>
								</div>
							</div>
						</div>
					))}
				</aside>
			</div>
		</div>
	);
}
