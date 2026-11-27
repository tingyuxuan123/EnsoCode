import type { ReactNode } from "react";
import { Sidebar } from "./Sidebar";

/**
 * 设置是盖在主界面上的弹窗，不是独立页面：背后留一层被压暗的主窗口，
 * 弹窗自己带标题栏（红绿灯 + 标题 + 关闭），左侧是平铺的 16 个分类。
 */
function Backdrop() {
	return (
		<div className="pointer-events-none absolute inset-0 overflow-hidden bg-desk">
			<div className="absolute inset-0 bg-white/[0.035]" />
			<div className="absolute inset-y-0 left-0 w-[54px] border-r border-white/[0.06] bg-black/40" />
			<div className="absolute left-[17px] top-[14px] size-[19px] rounded-[5px] bg-white/[0.09]" />
			<div className="absolute left-[17px] top-[64px] space-y-[18px]">
				<span className="block size-[15px] rounded-[4px] bg-white/[0.07]" />
				<span className="block size-[15px] rounded-[4px] bg-white/[0.07]" />
				<span className="block size-[15px] rounded-[4px] bg-white/[0.07]" />
				<span className="block size-[15px] rounded-[4px] bg-white/[0.07]" />
			</div>
			<div className="absolute inset-x-[54px] top-0 h-[34px] border-b border-white/[0.05] bg-white/[0.015]" />
			<div className="absolute left-[86px] top-[62px] w-[560px] space-y-3">
				<div className="h-[7px] w-[210px] rounded-full bg-white/[0.09]" />
				<div className="h-[7px] w-[430px] rounded-full bg-white/[0.06]" />
				<div className="h-[58px] w-[520px] rounded-[9px] bg-white/[0.055]" />
				<div className="h-[7px] w-[300px] rounded-full bg-white/[0.06]" />
				<div className="h-[7px] w-[470px] rounded-full bg-white/[0.05]" />
				<div className="h-[58px] w-[440px] rounded-[9px] bg-white/[0.045]" />
			</div>
			<div className="absolute bottom-[52px] left-[86px] h-[52px] w-[640px] rounded-[10px] border border-white/[0.05] bg-white/[0.035]" />
			<div className="absolute inset-0 bg-black/45" />
		</div>
	);
}

/**
 * 弹窗壳：遮罩 + 一扇居中窗口。
 * `overlay` 是窗口内打开的弹层（详情抽屉 / 编辑对话框），落在窗口正文层上，
 * 遮住侧栏——和真实应用里 dialog 覆盖整个设置窗口一致。
 */
export function Window({ children, overlay }: { children: ReactNode; overlay?: ReactNode }) {
	return (
		<div className="relative flex h-full items-center justify-center bg-desk">
			<Backdrop />
			<div className="relative flex h-full max-h-[820px] w-full max-w-[1220px] flex-col overflow-hidden rounded-[11px] border border-white/[0.1] bg-surface text-foreground">
				<div className="flex h-[42px] shrink-0 items-center gap-3 border-b border-line bg-card/30 px-4">
					<span className="flex items-center gap-[7px]">
						<span className="size-[11px] rounded-full bg-traffic-close" />
						<span className="size-[11px] rounded-full bg-traffic-min" />
						<span className="size-[11px] rounded-full bg-traffic-max" />
					</span>
					<span className="text-[13px] leading-none text-muted">设置</span>
					<span className="ml-auto flex size-[26px] shrink-0 items-center justify-center rounded-[7px] border border-border text-faint">
						<span className="icon-[lucide--x] size-[13px]" />
					</span>
				</div>
				<div className="relative flex min-h-0 flex-1">
					<Sidebar />
					<div className="min-h-0 min-w-0 flex-1 overflow-y-auto">{children}</div>
					{overlay}
				</div>
			</div>
		</div>
	);
}
