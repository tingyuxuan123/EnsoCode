import type { Variant } from "./variant";

const row = "flex items-center gap-2 rounded-control px-2 text-[13px]";

export function Sidebar({ variant }: { variant: Variant }) {
	const unified = variant === "unified";
	return (
		<aside className="flex w-[236px] shrink-0 flex-col">
			{/* 分段 36 + 搜索 36 */}
			<div className="flex items-center gap-2 px-3 pt-3">
				<div className="flex h-9 min-w-0 flex-1 items-center gap-0.5 rounded-block bg-track p-0.5">
					<span
						className={`flex h-[30px] flex-1 items-center justify-center bg-paper text-[12.5px] font-medium ${
							unified
								? "rounded-control shadow-[inset_0_0_0_1px_var(--color-line)]"
								: "rounded-[6px] shadow-[0_0_0_0.5px_rgb(0_0_0/6%),0_1px_2px_rgb(0_0_0/5%)]"
						}`}
					>
						项目
					</span>
					<span className="flex h-[30px] flex-1 items-center justify-center text-[12.5px] text-muted">
						对话
					</span>
				</div>
				<button
					type="button"
					aria-label="搜索任意内容"
					className="flex size-9 shrink-0 items-center justify-center rounded-block bg-track text-muted"
				>
					<span className="icon-[lucide--search] size-4" />
				</button>
			</div>

			<div className="mt-3 flex flex-col px-2">
				<button type="button" className={`${row} h-9 w-full`}>
					<span className="icon-[lucide--circle-plus] size-[17px] text-accent" />
					<span className="flex-1 text-left">新建任务</span>
					<kbd className="rounded-[4px] border border-line px-1 text-[11px] text-subtle">⌘N</kbd>
				</button>
				<button type="button" className={`${row} mt-1 h-9 w-full`}>
					<span className="icon-[lucide--puzzle] size-[17px] text-muted" />
					<span className="flex-1 text-left">扩展</span>
				</button>
			</div>

			{/* 项目头：全部折叠 + 添加 */}
			<div className="mt-4 flex h-[21px] items-center px-2">
				<span className="flex-1" />
				<span className="flex size-[21px] items-center justify-center text-subtle">
					<span className="icon-[lucide--chevrons-up-down] size-[15px]" />
				</span>
				<span className="ml-1 flex size-[21px] items-center justify-center text-subtle">
					<span className="icon-[lucide--plus] size-[15px]" />
				</span>
			</div>

			<div className="mt-[7px] flex items-center px-2">
				<span className="rounded-control bg-track px-2 py-[3px] text-[11px]">全部 1</span>
				<span className="flex-1" />
				<span className="flex size-[23px] items-center justify-center text-subtle">
					<span className="icon-[lucide--text-search] size-[15px]" />
				</span>
			</div>

			<div className="mt-1 flex flex-col px-2">
				<div className="flex items-center gap-2 px-2 py-1 text-[13px]">
					<span className="icon-[lucide--folder-open] size-4 text-muted" />
					<span className="flex-1">EnsoCode</span>
					<span className="icon-[lucide--message-square-plus] size-[15px] text-subtle" />
					<span className="icon-[lucide--ellipsis] size-[15px] text-subtle" />
				</div>

				<div className="mt-1 rounded-control bg-selection px-2 py-[6px]">
					<div className="flex items-center gap-2">
						<span className="min-w-0 flex-1 truncate text-[13px]">打开deepseek 搜搜 rpc 什么意思</span>
					</div>
					<div className="mt-0.5 flex items-center gap-1">
						<span className="icon-[lucide--globe] size-3 text-subtle" />
						<span className="text-[11px] text-subtle">2</span>
					</div>
				</div>

				<div className="mt-1 flex items-center gap-2 px-2 py-[6px] text-[12.5px] text-muted">
					<span className="min-w-0 flex-1 truncate">打开deepseek 搜搜 rpc…</span>
				</div>
			</div>

			<div className="flex-1" />
			<div className="flex h-[47px] items-center gap-2 border-t border-line px-3 text-[12px] text-muted">
				<span className="flex items-center gap-1">
					<span className="icon-[lucide--laptop] size-4" />
					本机
					<span className="icon-[lucide--chevron-down] size-3.5" />
				</span>
				<span className="flex-1" />
				<span className="flex h-8 items-center justify-center px-1">
					<span className="icon-[lucide--archive] size-4" />
				</span>
			</div>
		</aside>
	);
}
