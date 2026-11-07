import { Link } from "react-router";
import { LinkPill } from "./LinkPill";
import { computer } from "./data";

const entries = [
	{ to: "/", icon: "icon-[lucide--square-pen]", title: "新任务", detail: "Eaves" },
	{ to: "/board", icon: "icon-[lucide--layout-dashboard]", title: "任务看板", detail: "2 个等你" },
	{ to: "/members", icon: "icon-[lucide--users]", title: "成员", detail: "2 条待处理" },
	{ to: "/pair", icon: "icon-[lucide--scan-line]", title: "连接电脑", detail: computer },
];

/** 首页最上面：Eaves 字标、连接状态、关闭。 */
export function HomeHeader({ online = true }: { online?: boolean }) {
	return (
		<header className="relative flex items-center py-2 pr-4 pl-5">
			<h1 className="text-[22px] leading-7 font-bold">Eaves</h1>
			<LinkPill
				online={online}
				compact
			/>
			<div className="flex-1" />
			<Link
				to="/"
				aria-label="关闭"
				className="glass flex size-12 items-center justify-center rounded-full"
			>
				<span className="icon-[lucide--x] size-5" />
			</Link>
		</header>
	);
}

/** 首页的几个入口：一个图标一行字，没有底。 */
export function HomeEntries() {
	return (
		<nav className="pt-1 pb-2">
			{entries.map((e) => (
				<Link
					key={e.title}
					to={e.to}
					className="flex items-center gap-3.5 px-5 py-2.5"
				>
					<span className={`${e.icon} size-6`} />
					<span className="flex-1 text-[16px] leading-[22px] font-medium">{e.title}</span>
					<span className="max-w-[170px] truncate text-[14px] leading-5 text-dim">{e.detail}</span>
				</Link>
			))}
		</nav>
	);
}

/** 浮在列表末尾的搜索和设置；没有任务时搜索变淡、不可点。 */
export function HomeDock({ canSearch = true }: { canSearch?: boolean }) {
	return (
		<>
			<div className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-page via-page/80 to-transparent" />
			<div className="absolute right-4 bottom-8 flex items-center gap-3">
				<button
					aria-label="搜索"
					disabled={!canSearch}
					className={`glass flex size-14 items-center justify-center rounded-full ${canSearch ? "" : "opacity-40"}`}
				>
					<span className="icon-[lucide--search] size-6" />
				</button>
				<button
					aria-label="设置"
					className="glass flex size-14 items-center justify-center rounded-full"
				>
					<span className="icon-[lucide--settings] size-6" />
				</button>
			</div>
		</>
	);
}

/** 首页顶部的柔光，跟着列表一起滚走（HomeScreen 的 glow）。 */
export function HomeGlow() {
	return (
		<div
			className="pointer-events-none absolute inset-x-0 top-0 h-[420px]"
			style={{ background: "radial-gradient(80% 100% at 50% 0%, #ffffff 0%, rgb(255 255 255 / 0) 100%)" }}
		/>
	);
}

/** 新任务页左上的晨光：紫在左上、蓝在右侧，到页面中段淡回底色。 */
export function Dawn() {
	return (
		<div
			className="pointer-events-none absolute inset-x-0 top-0 h-[560px]"
			style={{
				background:
					"radial-gradient(90% 62% at 0% 0%, var(--color-dawn-side) 0%, transparent 70%), radial-gradient(85% 58% at 100% 6%, var(--color-dawn) 0%, transparent 72%)",
			}}
		/>
	);
}
