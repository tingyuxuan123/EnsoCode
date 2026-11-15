export const frame = { width: 402, height: 874, radius: 62, title: "产物" };

import { StatusBar } from "@vetta/ios";
import { TopBar } from "../components/TopBar";

// 产物：本轮生成的文件。文档先给个能读的开头，其余按文件行列出。
export default function Artifacts() {
	return (
		<div className="relative flex h-full flex-col overflow-hidden bg-page">
			<StatusBar
				variant="island"
				tone="dark"
			/>
			<TopBar
				lead="back"
				to="/chat"
				title="产物"
				detail="3 个文件 · 本轮"
			>
				<button
					aria-label="分享"
					className="flex size-12 items-center justify-center rounded-full text-ink"
				>
					<span className="icon-[lucide--share] size-[22px]" />
				</button>
			</TopBar>
			<div className="min-h-0 flex-1 overflow-hidden px-4 pt-1 pb-28">
				<div className="rounded-[20px] bg-card px-4 py-4 shadow-[0_0_0_0.75px_rgb(0_0_0/0.04)]">
					<div className="flex items-center gap-2 pb-3">
						<span className="icon-[lucide--file-text] size-4 text-dim" />
						<span className="min-w-0 flex-1 truncate font-mono text-[11px] text-dim">
							排期-第 43 周.md
						</span>
						<span className="text-[11px] leading-4 text-faint tabular-nums">4.2 KB</span>
					</div>
					<h2 className="text-[18px] leading-6 font-semibold">第 43 周 · 三件事</h2>
					<p className="mt-2 text-[14px] leading-[22px] text-ink2">
						PWA 重设计先落 token 层，桌面端零改动；reducer 修复走回归，周四给可安装版本。
					</p>
					<ol className="mt-2.5 flex flex-col gap-1.5 text-[14px] leading-[22px] text-ink2">
						<li className="flex gap-2">
							<span className="text-faint tabular-nums">1</span>
							黑白底 + 玻璃浮层落到手机端样式层
						</li>
						<li className="flex gap-2">
							<span className="text-faint tabular-nums">2</span>
							审批与提问顶替输入框
						</li>
						<li className="flex gap-2">
							<span className="text-faint tabular-nums">3</span>
							恢复会话的时间线补齐测试
						</li>
					</ol>
				</div>
				<div className="mt-3 flex items-center gap-3 rounded-2xl bg-card px-3.5 py-3">
					<span className="icon-[lucide--image] size-[18px] text-ink2" />
					<div className="min-w-0 flex-1">
						<p className="truncate text-[14px] leading-5 font-medium">hero@2x.png</p>
						<p className="text-[12px] leading-4 text-dim tabular-nums">1.2 MB · 2400×1600</p>
					</div>
					<span className="icon-[lucide--download] size-4 text-faint" />
				</div>
				<div className="mt-2 flex items-center gap-3 rounded-2xl bg-card px-3.5 py-3">
					<span className="icon-[lucide--git-compare] size-[18px] text-ink2" />
					<div className="min-w-0 flex-1">
						<p className="truncate text-[14px] leading-5 font-medium">sessionReducer.patch</p>
						<p className="flex items-center gap-1.5 text-[12px] leading-4 tabular-nums">
							<span className="text-dim">38 KB</span>
							<span className="font-mono text-green">+38</span>
							<span className="font-mono text-red">−6</span>
						</p>
					</div>
					<span className="icon-[lucide--download] size-4 text-faint" />
				</div>
			</div>
			<div className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-page via-page/85 to-transparent" />
			<div className="absolute inset-x-4 bottom-8">
				<button className="glass-ink flex h-[54px] w-full items-center justify-center gap-2 rounded-full text-[16px] font-medium">
					<span className="icon-[lucide--download] size-5" />
					下载全部
				</button>
			</div>
		</div>
	);
}
