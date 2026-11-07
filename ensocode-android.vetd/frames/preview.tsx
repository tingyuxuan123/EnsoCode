export const frame = { width: 412, height: 915, title: "网页预览" };

import { StatusBar } from "@vetta/ios";
import page from "../assets/workflows-current.png";
import { TopBar } from "../components/TopBar";

const keys = [
	{ label: "Tab", icon: "" },
	{ label: "Esc", icon: "" },
	{ label: "回车", icon: "icon-[lucide--corner-down-left]" },
	{ label: "上", icon: "icon-[lucide--arrow-up]" },
	{ label: "下", icon: "icon-[lucide--arrow-down]" },
	{ label: "退格", icon: "icon-[lucide--delete]" },
];

/**
 * 网页预览：电脑上 Agent 起的页面串流到手机（preview-*）。点按、滚动、打字都转发给页面，
 * 所以底下是一行输入和常用按键，而不是手机键盘的全部。
 */
export default function Preview() {
	return (
		<div className="relative flex h-full flex-col overflow-hidden bg-page">
			<StatusBar
				variant="flat"
				tone="dark"
			/>
			<TopBar
				lead="back"
				to="/session-menu"
				title="localhost:5173"
				detail="pnpm dev · 实时 · 30 fps"
			>
				<button
					aria-label="刷新"
					className="flex size-10 items-center justify-center rounded-full text-ink2"
				>
					<span className="icon-[lucide--rotate-cw] size-5" />
				</button>
			</TopBar>
			<div className="flex items-center gap-2 px-4 pb-3">
				<div className="flex rounded-full bg-card2 p-1 text-[13px] font-medium">
					<button className="h-8 rounded-full bg-card px-3.5 shadow-[0_1px_3px_rgb(0_0_0/0.08)]">桌面宽度</button>
					<button className="h-8 px-3.5 text-dim">手机宽度</button>
				</div>
				<span className="ml-auto text-[12px] leading-4 text-dim tabular-nums">1440 × 900 · 已放大 48%</span>
			</div>
			<div className="relative mx-3 overflow-hidden rounded-[18px] bg-camera shadow-[0_0_0_0.75px_rgb(0_0_0/0.08)]">
				<img
					src={page}
					alt="电脑上的 Eaves 工作流面板"
					className="block h-[440px] w-full object-cover object-[78%_0%]"
				/>
				<span className="pointer-events-none absolute top-[30%] left-[58%] size-9 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/30 ring-2 ring-white/80" />
				<div className="absolute right-2 bottom-2 h-1 w-16 overflow-hidden rounded-full bg-white/20">
					<div className="ml-[40%] h-full w-[48%] rounded-full bg-white/80" />
				</div>
			</div>
			<p className="flex items-center gap-1.5 px-5 pt-3 text-[13px] leading-[18px] text-dim">
				<span className="icon-[lucide--pointer] size-4" />
				点按、双指缩放、拖动滚动，都会发到电脑上的页面
			</p>
			<div className="flex-1" />
			<div className="px-3 pb-8">
				<div className="flex gap-1.5 overflow-hidden pb-2">
					{keys.map((k) => (
						<button
							key={k.label}
							aria-label={k.label}
							className="flex h-10 min-w-12 flex-1 items-center justify-center rounded-[12px] bg-card text-[14px] font-medium text-ink2"
						>
							{k.icon ? <span className={`${k.icon} size-[18px]`} /> : k.label}
						</button>
					))}
				</div>
				<div className="flex items-center gap-2">
					<div className="flex h-12 min-w-0 flex-1 items-center rounded-3xl border border-line bg-card px-4">
						<span className="truncate text-[16px] text-dim">输入文字，发到页面里的焦点框</span>
					</div>
					<button
						aria-label="发送到页面"
						className="flex size-12 shrink-0 items-center justify-center rounded-full bg-pill text-pill-ink"
					>
						<span className="icon-[lucide--arrow-up] size-[22px]" />
					</button>
				</div>
			</div>
		</div>
	);
}
