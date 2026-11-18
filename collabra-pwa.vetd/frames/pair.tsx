export const frame = { width: 402, height: 874, radius: 62, title: "连接电脑" };

import { StatusBar } from "@vetta/ios";
import { BrandMark } from "../components/Brand";
import { Dawn } from "../components/Dawn";
import { LinkPill } from "../components/LinkPill";

// 配对：晨光 + 两行大字。真实流程只有两条路——扫桌面端的二维码（系统相机会直接
// 打开这一页并自动连上），或者在页内粘贴那条 enso:// 链接。没有数字配对码。
export default function Pair() {
	return (
		<div className="relative flex h-full flex-col overflow-hidden bg-page">
			<Dawn />
			<StatusBar
				variant="island"
				tone="dark"
			/>
			<header className="relative flex items-center gap-2.5 px-5 pt-1">
				<BrandMark size={26} />
				<span className="text-[17px] leading-6 font-semibold">CodeKiln</span>
				<div className="flex-1" />
				<LinkPill
					online={false}
					compact
				/>
			</header>
			<div className="relative px-5 pt-9">
				<h1 className="text-[31px] leading-[38px] font-bold tracking-[-0.02em]">
					手机是
					<br />
					<span className="bg-gradient-to-r from-greet-a to-greet-b bg-clip-text text-transparent">
						第二块屏幕
					</span>
				</h1>
				<p className="mt-3.5 max-w-[300px] text-[15px] leading-6 text-dim">
					把它和正在跑任务的电脑连起来。看一眼进度，批一条命令，回一句话——不用走到桌前。
				</p>
			</div>
			<ol className="relative mt-7 flex flex-col gap-2.5 px-5">
				{["桌面端「设置 → 手机」→ 允许连入", "用系统相机扫它出的二维码，会直接打开这一页并连上", "扫码不方便，就在下面粘贴那条链接"].map(
					(step, i) => (
						<li
							key={step}
							className="flex items-start gap-2.5 text-[14px] leading-5 text-ink2"
						>
							<span className="mt-px flex size-5 shrink-0 items-center justify-center rounded-full bg-ink text-[11px] font-semibold text-pill-ink tabular-nums">
								{i + 1}
							</span>
							{step}
						</li>
					),
				)}
			</ol>
			<div className="relative mt-6 px-5">
				<div className="flex items-center justify-between">
					<h2 className="text-[15px] leading-5 font-semibold">粘贴配对链接</h2>
					<span className="text-[12px] leading-4 text-dim">在桌面端点「复制链接」</span>
				</div>
				<div className="mt-3 flex h-[54px] items-center gap-2 rounded-[18px] bg-card pr-1.5 pl-4 shadow-[inset_0_0_0_0.75px_rgb(0_0_0/0.06)]">
					<span className="icon-[lucide--link] size-4 shrink-0 text-faint" />
					<span className="min-w-0 flex-1 truncate font-mono text-[12px] text-faint">
						enso://pair?relay=…&amp;pk=…
					</span>
					<button className="flex h-11 shrink-0 items-center rounded-full bg-card2 px-4 text-[14px] leading-5 font-medium text-ink2">
						粘贴
					</button>
				</div>
				<p className="mt-2.5 text-[12px] leading-4 text-dim">链接只在桌面端显示的倒计时内有效</p>
			</div>
			<div className="flex-1" />
			<div className="relative px-5 pb-8">
				<button className="flex h-[54px] w-full items-center justify-center gap-2 rounded-full bg-pill text-[16px] font-medium text-pill-ink shadow-[inset_0_1px_0_rgb(255_255_255/0.18),0_10px_24px_-8px_rgb(0_0_0/0.3)]">
					<span className="icon-[lucide--scan-line] size-5" />
					扫描二维码
				</button>
				<p className="mt-2 px-6 text-center text-[12px] leading-4 text-dim">
					页内扫码需要摄像头权限；系统相机扫同一张码也能连
				</p>
			</div>
		</div>
	);
}
