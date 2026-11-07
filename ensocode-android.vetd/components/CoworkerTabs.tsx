import { Link } from "react-router";
import { RunningMark } from "./Eaves";

/**
 * 会话雇了 coworker 时，标题下面一排标签：主会话加每位 coworker，可切换查看。
 * 手机不雇也不解雇（与桌面 CoworkerTabs 同观感）。最右边是这个会话的后台入口。
 */
export function CoworkerTabs({ background }: { background: string }) {
	return (
		<div className="flex items-center gap-1.5 px-4 pb-2">
			<span className="flex h-8 items-center rounded-full bg-pill px-3.5 text-[13px] font-medium text-pill-ink">主会话</span>
			<span className="flex h-8 items-center gap-1.5 rounded-full bg-card2 px-3.5 text-[13px] font-medium text-ink2">
				<RunningMark size={10} />
				安全审查
			</span>
			<Link
				to="/tasks"
				className="ml-auto flex h-8 items-center gap-1 rounded-full px-2.5 text-[13px] text-ink2"
			>
				<span className="icon-[lucide--layers] size-3.5" />
				{background}
				<span className="icon-[lucide--chevron-right] size-3.5" />
			</Link>
		</div>
	);
}
