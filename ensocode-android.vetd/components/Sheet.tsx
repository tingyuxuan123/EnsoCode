import type { ReactNode } from "react";
import { Link } from "react-router";

/**
 * 底部面板（Sheet.kt）：压暗下面的页面，点空白处关闭；顶部一根拖动条，
 * 标题一行，右侧放这张面板自己的状态或动作。
 */
export function Sheet({
	backTo,
	title,
	aside,
	children,
}: {
	backTo: string;
	title: string;
	aside?: ReactNode;
	children: ReactNode;
}) {
	return (
		<>
			<Link
				to={backTo}
				aria-label="关闭"
				className="absolute inset-0 z-10 bg-ink/35"
			/>
			<section className="absolute inset-x-0 bottom-0 z-20 rounded-t-[28px] bg-page pb-9 shadow-[0_-12px_40px_rgb(0_0_0/0.18)]">
				<div className="flex justify-center pt-2.5 pb-1">
					<span className="h-1 w-9 rounded-full bg-faint/60" />
				</div>
				<header className="flex items-center gap-3 px-5 pt-2 pb-3">
					<h2 className="flex-1 text-[17px] leading-[22px] font-semibold">{title}</h2>
					{aside}
				</header>
				{children}
			</section>
		</>
	);
}

/** 面板里一组的小标题。 */
export function SheetLabel({ children }: { children: ReactNode }) {
	return <h3 className="px-6 pt-4 pb-2 text-[13px] leading-[18px] font-medium text-dim">{children}</h3>;
}
