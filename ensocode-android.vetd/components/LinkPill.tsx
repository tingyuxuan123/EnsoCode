import { Link } from "react-router";
import { computer } from "./data";

/**
 * 电脑与连接状态（LinkPill.kt）：没有实心底，只有一圈发丝，状态靠记号说话。
 * 在线是绿勾；离线换成断开的电脑和叉，加一层淡红。`compact` 是首页标题旁的小号。
 */
export function LinkPill({ online, compact = false }: { online: boolean; compact?: boolean }) {
	if (compact) {
		return (
			<Link
				to="/pair"
				aria-label={online ? `已连接 ${computer}` : `${computer} 离线`}
				className={`ml-2 flex h-[30px] items-center gap-1 rounded-full border-[0.75px] px-[9px] ${
					online ? "border-line" : "border-red/35 bg-red/[0.08] text-red"
				}`}
			>
				<span className={`${online ? "icon-[mdi--laptop]" : "icon-[mdi--laptop-off]"} size-[15px]`} />
				<span className={`${online ? "icon-[mdi--check] text-green" : "icon-[mdi--close]"} size-[13px]`} />
			</Link>
		);
	}
	return (
		<Link
			to="/pair"
			className={`flex h-10 items-center gap-[7px] rounded-full border-[0.75px] px-4 text-[14px] font-medium ${
				online ? "border-line" : "border-red/35 bg-red/[0.08] text-red"
			}`}
		>
			<span className={`${online ? "icon-[mdi--laptop]" : "icon-[mdi--laptop-off]"} size-5`} />
			{online ? computer : "电脑离线"}
			<span className={`${online ? "icon-[mdi--check] text-green" : "icon-[mdi--close]"} size-[18px]`} />
		</Link>
	);
}
