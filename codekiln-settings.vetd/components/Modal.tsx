import type { ReactNode } from "react";

/**
 * 居中弹层：遮罩 + 一档更暗的 sheet。头部只有标题和一行说明，正文自己滚动，
 * 底部固定在边缘——大表单不会把保存按钮顶出画面。
 */
export function Modal({
	title,
	note,
	width = 880,
	footer,
	children,
}: {
	title: string;
	note?: string;
	width?: number;
	footer?: ReactNode;
	children: ReactNode;
}) {
	return (
		<>
			<div className="absolute inset-0 bg-black/55" />
			<div className="absolute inset-0 flex items-center justify-center p-6">
				<div
					className="flex max-h-full min-w-0 flex-col overflow-hidden rounded-[10px] border border-white/[0.09] bg-sheet"
					style={{ width }}
				>
					<header className="flex shrink-0 items-start gap-3 px-5 pb-3.5 pt-4">
						<div className="min-w-0 flex-1">
							<h2 className="text-[15px] font-semibold leading-[20px]">{title}</h2>
							{note ? (
								<p className="pt-0.5 text-[11.5px] leading-[16px] text-faint">{note}</p>
							) : null}
						</div>
						<span className="icon-[lucide--x] mt-0.5 size-[15px] shrink-0 text-faint" />
					</header>
					<div className="min-h-0 flex-1 overflow-hidden px-5 pb-4">{children}</div>
					{footer ? (
						<footer className="flex shrink-0 items-center gap-2 border-t border-white/[0.06] px-5 py-2.5">
							{footer}
						</footer>
					) : null}
				</div>
			</div>
		</>
	);
}
