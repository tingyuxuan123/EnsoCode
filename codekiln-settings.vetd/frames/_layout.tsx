import { Outlet, useLocation } from "react-router";
import { Window } from "../components/Window";

/** 叠加层两屏自己带壳（要在侧栏之上盖遮罩），所以这里只放行。 */
const OVERLAYS = [
	"/provider-drawer",
	"/provider-drawer-sub",
	"/provider-drawer-preset",
	"/route-sheet",
	"/provider-setup",
	"/provider-api",
	"/provider-edit",
	"/local-import",
	"/virtual-model",
	"/agent-type-edit",
	"/pool-provider",
	"/delete-confirm",
];

export default function Layout() {
	const { pathname } = useLocation();
	if (OVERLAYS.includes(pathname)) return <Outlet />;
	return (
		<Window>
			<div className="h-full overflow-y-auto">
				<Outlet />
			</div>
		</Window>
	);
}
