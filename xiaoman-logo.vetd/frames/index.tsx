export const frame = { width: 1280, height: 900, title: "小满 · 新标志" };

import appIcon from "../assets/xiaoman-app-icon.svg";
import mark from "../assets/xiaoman-mark.svg";
import wordmark from "../assets/xiaoman-wordmark.svg";

const sizes = [48, 32, 24, 16];

export default function XiaomanIdentity() {
	return (
		<main className="flex h-full flex-col bg-surface px-[76px] pt-[52px] pb-[56px] font-sans text-surface-foreground">
			<header className="flex items-center justify-between text-base font-semibold text-muted">
				<p>小满 / 标志提案</p>
				<p>AI 协作工作台</p>
			</header>

			<section className="grid flex-1 grid-cols-[548px_1fr] items-center gap-[60px] pb-8">
				<figure className="flex justify-center">
					<img className="icon-specimen size-[452px]" src={appIcon} alt="青麦绿底上的笑脸麦粒，轮廓像一个对话气泡" width={452} height={452} />
				</figure>
				<div className="pb-3">
					<h1 className="mb-10">
						<img className="w-[248px]" src={wordmark} alt="小满" width={248} height={103} />
					</h1>
					<p className="mb-4 text-[32px] leading-tight font-semibold tracking-tight">一粒还没长满的麦</p>
					<p className="text-xl leading-[1.7] text-muted">
						取小满时节尚青的麦粒，画成一个带笑的对话气泡。
						<br />
						麦粒呼应名字，气泡来自和 AI 一起工作的日常。
					</p>
				</div>
			</section>

			<section className="grid h-[152px] shrink-0 grid-cols-[548px_1fr] gap-[60px] border-t border-border pt-7" aria-label="实际使用预览">
				<div>
					<h2 className="mb-3 text-base font-semibold">小尺寸应用图标</h2>
					<div className="flex items-end gap-8">
						{sizes.map((size) => (
							<figure className="flex w-12 flex-col items-center gap-1" key={size}>
								<img src={appIcon} alt="" width={size} height={size} />
								<figcaption className="text-sm text-muted tabular-nums">{size} px</figcaption>
							</figure>
						))}
					</div>
				</div>
				<div>
					<h2 className="mb-3 text-base font-semibold">图形与字标</h2>
					<div className="flex h-[72px] items-center gap-6">
						<div className="flex items-center gap-2">
							<img src={mark} alt="" width={29} height={34} />
							<img src={wordmark} alt="小满组合标志" width={78} height={33} />
						</div>
						<div className="flex size-[56px] items-center justify-center rounded-xl bg-primary" aria-label="深色背景的单色标志" role="img">
							<span className="mark-ink h-8 w-7 bg-primary-foreground" />
						</div>
					</div>
				</div>
			</section>
		</main>
	);
}
