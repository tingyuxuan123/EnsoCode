import type { ReactNode } from "react";
import { Link } from "react-router";

const leads = {
	drawer: { icon: "icon-[lucide--menu]", label: "打开任务列表" },
	back: { icon: "icon-[lucide--arrow-left]", label: "返回" },
	close: { icon: "icon-[lucide--x]", label: "关闭" },
};

/**
 * 每个页面顶部的一行：左边抽屉 / 返回，中间标题和一行说明（模型、文件数…），
 * 右边放这一页自己的按钮。没有背景，也不画底线。
 */
export function TopBar({
	lead,
	to,
	title,
	detail,
	menu = false,
	children,
}: {
	lead: keyof typeof leads;
	to: string;
	title: string;
	detail?: string;
	menu?: boolean;
	children?: ReactNode;
}) {
	const l = leads[lead];
	return (
		<header className="relative flex h-14 items-center gap-1 pr-4 pl-1">
			<Link
				to={to}
				aria-label={l.label}
				className="flex size-12 shrink-0 items-center justify-center rounded-full text-ink"
			>
				<span className={`${l.icon} size-6`} />
			</Link>
			<div className="min-w-0 flex-1">
				<div className="truncate text-[17px] leading-[22px] font-medium">{title}</div>
				{detail && (
					<div className="flex items-center gap-0.5 text-[12px] leading-4 text-dim">
						<span className="truncate">{detail}</span>
						{menu && <span className="icon-[lucide--chevron-down] size-3.5 shrink-0" />}
					</div>
				)}
			</div>
			{children}
		</header>
	);
}
