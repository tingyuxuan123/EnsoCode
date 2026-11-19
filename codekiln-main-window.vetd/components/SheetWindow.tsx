import type { ReactNode } from "react";
import { ChatBand, ChatBody, ChatComposer, ChatStatus } from "./ChatPane";
import { PanelBand, PanelBody } from "./DevicePanel";

/** 一片纸：Kettu 的模型里每个面板都是浮在地面上的圆角表面，片与片之间靠留缝分层。 */
function Sheet({
	children,
	className = "",
}: {
	children: ReactNode;
	className?: string;
}) {
	return (
		<div
			className={`flex min-h-0 flex-col overflow-hidden rounded-[10px] bg-paper shadow-[0_0_0_1px_rgb(0_0_0/6%)] ${className}`}
		>
			{children}
		</div>
	);
}

/** 每片纸自己的头：标题在左，动作在右，下面一条内缩 12px 的发丝线。 */
function SheetHeader({
	title,
	icon,
	children,
	leading,
}: {
	title?: string;
	icon?: string;
	children?: ReactNode;
	leading?: ReactNode;
}) {
	return (
		<div className="flex h-10 shrink-0 items-center gap-2 px-3">
			{leading}
			{icon && <span className={`${icon} size-4 text-muted`} />}
			{title && <span className="text-[13px] font-medium">{title}</span>}
			{children}
		</div>
	);
}

/** 没有图标轨之后，轨道上的入口必须在这里各就各位：模式留在头部，工作台进导航，询问/设置在账号行。 */
const navItems = [
	{ icon: "icon-[lucide--square-pen]", label: "新建任务", accent: true, meta: "⌘N" },
	{ icon: "icon-[lucide--puzzle]", label: "扩展" },
];

const workspaceItems = [
	{ icon: "icon-[lucide--image]", label: "图片工作台" },
	{ icon: "icon-[lucide--ruler]", label: "设计" },
];

export function SheetWindow() {
	return (
		<div className="flex h-full flex-col bg-rail p-2">
			<div className="flex min-h-0 flex-1 gap-2">
				{/* 侧栏纸片：按 Kettu 的节奏——窗口控件 + 前进后退、搜索、导航、项目树、账号行 */}
				<Sheet className="w-[236px] shrink-0">
					<div className="flex h-[33px] shrink-0 items-center gap-1 px-3">
						<div className="flex items-center gap-[7px]">
							<span className="size-[11px] rounded-full bg-[#ff5f57]" />
							<span className="size-[11px] rounded-full bg-[#febc2e]" />
							<span className="size-[11px] rounded-full bg-[#28c840]" />
						</div>
						<span className="ml-2 flex size-6 items-center justify-center text-muted">
							<span className="icon-[lucide--panel-left] size-[15px]" />
						</span>
						<span className="ml-1 flex size-6 items-center justify-center text-subtle">
							<span className="icon-[lucide--chevron-left] size-[15px]" />
						</span>
						<span className="flex size-6 items-center justify-center text-subtle">
							<span className="icon-[lucide--chevron-right] size-[15px]" />
						</span>
					</div>

					<div className="px-[10px] pt-3">
						<div className="flex h-8 items-center gap-2 rounded-[7px] bg-track px-2.5 text-[12px] text-subtle">
							<span className="icon-[lucide--search] size-[15px]" />
							搜索…
							<span className="flex-1" />
							<span className="rounded-[4px] border border-line px-1 text-[11px]">⌘K</span>
						</div>
					</div>

					<div className="mt-3 flex flex-col gap-[1px] px-[10px]">
						{navItems.map((item) => (
							<div
								key={item.label}
								className="flex h-[30px] items-center gap-2 rounded-[6px] px-2 text-[12.5px] text-ink"
							>
								<span className={`${item.icon} size-4 shrink-0 text-muted`} />
								<span className="min-w-0 flex-1 truncate">{item.label}</span>
								{item.meta && <span className="text-[11px] text-subtle">{item.meta}</span>}
							</div>
						))}
						<div className="my-[6px] h-px bg-line" />
						{workspaceItems.map((item) => (
							<div
								key={item.label}
								className="flex h-[30px] items-center gap-2 rounded-[6px] px-2 text-[12.5px] text-ink"
							>
								<span className={`${item.icon} size-4 shrink-0 text-muted`} />
								<span className="min-w-0 flex-1 truncate">{item.label}</span>
							</div>
						))}
					</div>

					{/* 项目：小号标题 + 末尾的添加；会话行缩进一级 */}
					<div className="mt-4 flex h-6 items-center px-3">
						<span className="text-[11px] font-semibold text-subtle">项目</span>
						<span className="flex-1" />
						<span className="icon-[lucide--folder-plus] size-[15px] text-subtle" />
					</div>

					<div className="mt-[2px] flex flex-col gap-[1px] px-[10px]">
						<div className="flex h-[30px] items-center gap-2 rounded-[6px] px-2 text-[12.5px]">
							<span className="icon-[lucide--folder] size-4 shrink-0 text-[#3ba7ff]" />
							<span className="min-w-0 flex-1 truncate">EnsoCode</span>
						</div>
						<div className="mt-[1px] flex flex-col gap-[1px] pl-[18px]">
							<div className="flex h-[30px] items-center gap-2 rounded-[6px] bg-selection px-2 text-[12.5px]">
								<span className="icon-[lucide--message-square] size-[13px] shrink-0 text-[#3ba7ff]" />
								<span className="min-w-0 flex-1 truncate">打开deepseek 搜搜 rpc…</span>
								<span className="shrink-0 text-[11px] text-subtle">11小时前</span>
							</div>
							<div className="flex h-[30px] items-center gap-2 rounded-[6px] px-2 text-[12.5px] text-muted">
								<span className="icon-[lucide--message-square] size-[13px] shrink-0 text-subtle" />
								<span className="min-w-0 flex-1 truncate">打开deepseek 搜搜…</span>
							</div>
						</div>
						<div className="mt-[2px] flex h-[30px] items-center gap-2 rounded-[6px] px-2 text-[12.5px]">
							<span className="icon-[lucide--folder] size-4 shrink-0 text-[#3ba7ff]" />
							<span className="min-w-0 flex-1 truncate">eaves-members</span>
						</div>
					</div>

					<div className="flex-1" />

					{/* 底栏一行：本机节点（可切换）+ 版本胶囊 | 已归档 · 设置。
					    更新不常驻——真更新时才在这里换成「更新 v0.2.92」按钮。 */}
					<div className="flex h-9 items-center gap-1.5 px-[10px] pb-1">
						<span className="flex h-7 items-center gap-1.5 rounded-[6px] px-1.5 text-[12.5px] font-medium">
							<span className="icon-[lucide--laptop] size-4 text-muted" />
							本机
							<span className="icon-[lucide--chevron-down] size-3 text-subtle" />
						</span>
						<span className="rounded-full bg-track px-1.5 py-[1px] font-mono text-[11px] text-subtle">
							v0.2.91
						</span>
						<span className="flex-1" />
						<span className="flex size-7 items-center justify-center rounded-[6px] text-subtle">
							<span className="icon-[lucide--archive] size-4" />
						</span>
						<span className="flex size-7 items-center justify-center rounded-[6px] text-subtle">
							<span className="icon-[lucide--settings-2] size-4" />
						</span>
					</div>
				</Sheet>

				{/* 会话也是一片纸：自己的头、自己的输入框与状态条 */}
				<Sheet className="min-w-0 flex-1">
					<div className="shrink-0 border-b border-line">
						<ChatBand variant="unified" windowActions />
					</div>
					<ChatBody />
					<ChatComposer />
					<ChatStatus variant="unified" />
				</Sheet>

				{/* 右面板同样是一片纸，头里带页签 */}
				<Sheet className="w-[401px] shrink-0">
					<div className="shrink-0 border-b border-line">
						<PanelBand variant="unified" />
					</div>
					<PanelBody variant="unified" />
				</Sheet>
			</div>
		</div>
	);
}
