import { Outlet } from "react-router";

/** 外壳只负责字体和安卓底部的手势条；每个页面自己画背景与状态栏。 */
export default function Layout() {
	return (
		<div className="relative h-full overflow-hidden bg-page font-sans text-ink antialiased">
			<Outlet />
			<div className="pointer-events-none absolute inset-x-0 bottom-2 z-30 flex justify-center">
				<span className="h-1 w-[108px] rounded-full bg-white opacity-85 mix-blend-difference" />
			</div>
		</div>
	);
}
