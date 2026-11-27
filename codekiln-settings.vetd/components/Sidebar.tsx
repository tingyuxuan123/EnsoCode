import { Link, useLocation } from "react-router";
import { navItems } from "./data";

/** 窗口内打开的弹层仍停在来源分类上。 */
const MODEL_OVERLAYS = [
	"/provider-drawer",
	"/provider-drawer-sub",
	"/provider-drawer-preset",
	"/route-sheet",
	"/provider-setup",
	"/provider-api",
	"/provider-edit",
	"/local-import",
	"/virtual-model",
	"/pool-provider",
	"/delete-confirm",
	"/empty",
	"/refreshing",
];
const AGENT_OVERLAYS = ["/agent-type-edit"];

/** 平铺的 16 个分类：设置里没有二级分组，路径就是唯一层级。 */
export function Sidebar() {
	const { pathname } = useLocation();

	return (
		<aside className="flex w-[250px] shrink-0 flex-col gap-[2px] overflow-y-auto border-r border-line bg-shell px-2.5 py-3">
			{navItems.map((item) => {
				const active =
					item.to === pathname ||
					(item.to === "/" && MODEL_OVERLAYS.includes(pathname)) ||
					(item.to === "/agent-types" && AGENT_OVERLAYS.includes(pathname));
				const row = (
					<>
						<span className={`${item.icon} size-[14px] shrink-0`} />
						<span className="truncate">{item.label}</span>
					</>
				);
				const className = active
					? "flex h-[34px] w-full items-center gap-2.5 rounded-[7px] bg-white/[0.07] px-2.5 text-[12.5px] text-foreground"
					: "flex h-[34px] w-full items-center gap-2.5 rounded-[7px] px-2.5 text-[12.5px] text-muted hover:bg-white/[0.04] hover:text-foreground";
				return item.to ? (
					<Link key={item.label} to={item.to} className={className}>
						{row}
					</Link>
				) : (
					<span key={item.label} className={className}>
						{row}
					</span>
				);
			})}
		</aside>
	);
}
