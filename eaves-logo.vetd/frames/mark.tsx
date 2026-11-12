export const frame = { width: 1600, height: 1000, title: "小满 · 标志" };

import { AppIcon, Mark, Wordmark } from "../components/Mark";

const readings = [
	{ title: "圈还没合上", body: "正下方留着一小段口。二十四节气里只有小满、没有大满——满，但没满透。" },
	{ title: "中间那一滴", body: "落进圈里的那滴水，也是此刻正在跑的那件事。全图唯一的颜色，取自界面里的「运行中」蓝。" },
	{ title: "缺口正对着它", body: "口子就是水滴落的地方，也是它还没填满的地方。除此之外，没有第四笔。" },
];

/** 一个图形、两种尺寸、一句话。就这些。 */
export default function MarkFrame() {
	return (
		<div className="flex h-full flex-col bg-paper px-24 pt-20 pb-20 font-sans text-ink">
			<header className="flex items-end justify-between gap-12">
				<div>
					<h1 className="font-cn text-[56px] leading-[64px] font-semibold tracking-[0.01em]">小满的标志</h1>
					<p className="mt-4 max-w-[620px] text-[18px] leading-[30px] text-ink2">
						黑底、白圈、蓝滴。不加别的东西，也不借上一个名字的形状。
					</p>
				</div>
				<Wordmark compact />
			</header>

			<div className="mt-16 flex min-h-0 flex-1 gap-24">
				<div className="flex items-center">
					<AppIcon size={440} />
				</div>

				<div className="flex min-w-0 flex-1 flex-col">
					<dl className="flex flex-col gap-9">
						{readings.map((r) => (
							<div key={r.title}>
								<dt className="font-cn text-[26px] leading-[34px] font-semibold">{r.title}</dt>
								<dd className="mt-2 max-w-[520px] text-[17px] leading-[29px] text-ink2">{r.body}</dd>
							</div>
						))}
					</dl>

					<div className="mt-auto flex flex-wrap items-end gap-x-8 gap-y-3">
						<AppIcon size={96} />
						<AppIcon size={48} />
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
						<span className="w-full text-[14px] leading-5 text-dim">96 · 48 · 通知栏 24（单色） · 正文里 24</span>
					</div>
				</div>
			</div>
		</div>
	);
}
