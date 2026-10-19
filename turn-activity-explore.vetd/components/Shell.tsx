import type { ReactNode } from "react";

/** 与 EnsoCode 主窗口一致的壳：外壳 + 侧栏卡片 + 会话卡片。 */
export function Shell({
	children,
	label,
	dark = false,
}: {
	children: ReactNode;
	label: string;
	dark?: boolean;
}) {
	return (
		<div
			className={`flex h-full flex-col bg-shell text-foreground ${dark ? "theme-dark" : ""}`}
		>
			<div className="drag-region flex h-11 shrink-0 items-center gap-2 pl-[84px] pr-3">
				<span className="size-1.5 rounded-full bg-brand" />
				<span className="text-[13px] font-medium text-muted-foreground">EnsoCode</span>
				<div className="ml-auto flex items-center gap-1">
					<span className="flex size-7 items-center justify-center rounded-lg text-muted-foreground">
						<span className="icon-[lucide--fold-horizontal] size-4" />
					</span>
					<span className="flex size-7 items-center justify-center rounded-lg text-muted-foreground">
						<span className="icon-[lucide--panel-right] size-4" />
					</span>
				</div>
			</div>
			<div className="flex min-h-0 flex-1 gap-1 px-2 pb-2">
				<Sidebar />
				<div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-panel">
					<TabStrip />
					<div className="min-h-0 flex-1 overflow-hidden">{children}</div>
					<Composer />
					<div className="absolute right-3 top-[11px] rounded-md border border-dashed border-border px-2 py-0.5 text-[10px] text-muted-foreground">
						{label}
					</div>
				</div>
			</div>
		</div>
	);
}

function Sidebar() {
	return (
		<div className="flex w-[232px] shrink-0 flex-col overflow-hidden rounded-xl border border-border bg-panel">
			<div className="flex h-11 shrink-0 items-center justify-between pl-2.5 pr-2">
				<div className="flex items-center gap-1.5 text-[13px]">
					<span className="icon-[lucide--laptop] size-4 text-muted-foreground" />
					<span>本机</span>
					<span className="icon-[lucide--chevron-down] size-3.5 text-muted-foreground" />
				</div>
				<div className="flex items-center gap-0.5 text-muted-foreground">
					<span className="flex size-8 items-center justify-center rounded-lg">
						<span className="icon-[lucide--search] size-4" />
					</span>
					<span className="flex size-8 items-center justify-center rounded-lg">
						<span className="icon-[lucide--plus] size-4" />
					</span>
				</div>
			</div>
			<div className="flex items-center gap-1 px-2 pb-2">
				<span className="flex items-center gap-1.5 rounded-md bg-accent px-2 py-1 text-[12px] font-medium">
					全部
					<span className="text-muted-foreground">1</span>
				</span>
				<span className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] text-muted-foreground">
					最近
					<span>1</span>
				</span>
				<span className="ml-auto flex size-7 items-center justify-center text-muted-foreground">
					<span className="icon-[lucide--arrow-down-wide-narrow] size-3.5" />
				</span>
			</div>
			<div className="flex-1 overflow-hidden px-2">
				<div className="flex items-center gap-2 py-2 pl-1 text-[13px]">
					<span className="icon-[lucide--folder] size-4 text-muted-foreground" />
					<span>测试文件夹</span>
				</div>
				<div className="flex items-center gap-2 rounded-lg bg-brand/10 py-1.5 pl-1 pr-2 text-[13px]">
					<span className="flex size-4 items-center justify-center">
						<span className="size-1.5 rounded-full bg-brand" />
					</span>
					<span className="min-w-0 flex-1 truncate">梳理一下这个项目的结构</span>
					<span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
						现在
					</span>
				</div>
			</div>
			<div className="flex items-center justify-between px-2 py-2 text-muted-foreground">
				<span className="icon-[lucide--panel-left-close] size-4" />
				<div className="flex items-center gap-1">
					<span className="icon-[lucide--sparkles] size-4" />
					<span className="icon-[lucide--settings] size-4" />
				</div>
			</div>
		</div>
	);
}

function TabStrip() {
	return (
		<div className="flex h-11 shrink-0 items-center gap-1 border-b border-border px-2">
			<span className="flex items-center gap-1.5 rounded-lg bg-accent px-2.5 py-1 text-[12px] font-medium">
				<span className="icon-[lucide--message-circle] size-3" />
				梳理一下这个项目的结构
			</span>
			<span className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[12px] text-muted-foreground">
				<span className="icon-[lucide--plus] size-3.5" />
			</span>
		</div>
	);
}

function Composer() {
	return (
		<div className="shrink-0 px-6 pb-3 pt-1">
			<div className="mx-auto w-full max-w-[780px]">
				<div className="rounded-2xl border border-border bg-background px-3.5 pb-2 pt-3 shadow-sm">
					<div className="text-[13px] text-muted-foreground">输入 @ 选择文件或 Agent</div>
					<div className="mt-3 flex items-center gap-3 text-[11px] text-muted-foreground">
						<span className="icon-[lucide--image] size-3.5" />
						<span className="flex items-center gap-1">
							<span className="icon-[lucide--layers] size-3.5" />
							全局
							<span className="icon-[lucide--chevron-down] size-3" />
						</span>
						<span className="flex items-center gap-1">
							<span className="icon-[lucide--house] size-3.5" />
							本地
							<span className="icon-[lucide--chevron-down] size-3" />
						</span>
						<span className="flex items-center gap-1">
							<span className="icon-[lucide--list-checks] size-3.5" />
							计划
						</span>
						<span className="flex items-center gap-1">
							<span className="icon-[lucide--shield-check] size-3.5" />
							完全放行
							<span className="icon-[lucide--chevron-down] size-3" />
						</span>
						<span className="flex items-center gap-1">
							deepseek-v4.1-flash
							<span className="icon-[lucide--chevron-down] size-3" />
						</span>
						<span className="ml-auto flex size-7 items-center justify-center rounded-lg bg-brand text-white">
							<span className="icon-[lucide--arrow-up] size-3.5" />
						</span>
					</div>
				</div>
			</div>
		</div>
	);
}

/** 用户消息：中性面，不用品牌色（强调色留给主操作）。 */
export function UserTurn({ text }: { text: string }) {
	return (
		<div className="flex flex-col items-end gap-1">
			<div className="max-w-[80%] rounded-2xl rounded-br-md border border-border bg-secondary px-4 py-2.5 text-[13px]">
				{text}
			</div>
			<div className="flex items-center gap-1 pr-1 text-[10px] text-muted-foreground">
				<span className="icon-[lucide--undo-2] size-3" />
				回退
				<span className="tabular-nums">14:06</span>
			</div>
		</div>
	);
}

export function ReplyHead({
	model = "deepseek-v4.1-flash",
	time = "14:06",
}: {
	model?: string;
	time?: string;
}) {
	return (
		<div className="flex items-center gap-2">
			<span className="flex size-6 items-center justify-center rounded-full border border-border bg-panel">
				<span className="icon-[lucide--aperture] size-3.5 text-brand" />
			</span>
			<span className="text-[13px] font-medium">Enso</span>
			<span className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
				{model}
			</span>
			<span className="text-[11px] text-muted-foreground tabular-nums">{time}</span>
		</div>
	);
}

/** 会话列：与真实应用的阅读列同宽。 */
export function ChatColumn({ children }: { children: ReactNode }) {
	return (
		<div className="mx-auto flex w-full max-w-[780px] flex-col gap-5 px-6 pt-5">
			{children}
		</div>
	);
}
