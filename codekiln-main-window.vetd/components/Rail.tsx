const railButton =
	"relative flex size-9 items-center justify-center rounded-control text-muted transition-colors";

/** 真实图标轨：折叠侧边栏 · 图片工作台 · 设计 · 协作看板 … 询问 · 设置（底部两项）。 */
const items = [
	{ icon: "icon-[lucide--panel-left]", label: "折叠侧边栏" },
	{ icon: "icon-[lucide--image]", label: "图片工作台", gap: true },
	{ icon: "icon-[lucide--ruler]", label: "设计" },
	{ icon: "icon-[lucide--square-kanban]", label: "协作看板" },
];

export function Rail() {
	return (
		<nav className="flex w-14 shrink-0 flex-col items-center gap-2 bg-rail py-3">
			{items.map((item) => (
				<div key={item.label} className={item.gap ? "mt-6 flex flex-col" : "flex flex-col"}>
					<button type="button" aria-label={item.label} title={item.label} className={railButton}>
						<span className={`${item.icon} size-[18px]`} />
					</button>
				</div>
			))}
			<div className="flex-1" />
			<button
				type="button"
				aria-label="询问 CodeKiln"
				title="询问 CodeKiln"
				className={`${railButton} text-accent`}
			>
				<span className="icon-[lucide--sparkles] size-[19px]" />
			</button>
			<button type="button" aria-label="设置" title="设置" className={railButton}>
				<span className="icon-[lucide--settings-2] size-[19px]" />
			</button>
		</nav>
	);
}
