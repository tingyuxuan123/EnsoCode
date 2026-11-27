import type { ReactNode } from "react";

/** 一个分区就是一张描边卡片：标题在卡内，行之间只有极淡的分隔线。 */
export function SectionCard({
	title,
	note,
	action,
	children,
}: {
	title: string;
	note?: string;
	action?: ReactNode;
	children: ReactNode;
}) {
	return (
		<section className="overflow-hidden rounded-[10px] border border-white/[0.09] bg-white/[0.012]">
			<div className="flex items-baseline gap-2 px-5 pb-2 pt-3.5">
				<h2 className="text-[13px] font-semibold leading-[18px]">{title}</h2>
				{note ? (
					<span className="truncate text-[11px] leading-[15px] text-faint">{note}</span>
				) : null}
				{action ? (
					<span className="ml-auto flex shrink-0 items-center gap-3 text-[11.5px] text-muted">
						{action}
					</span>
				) : null}
			</div>
			{children}
		</section>
	);
}
