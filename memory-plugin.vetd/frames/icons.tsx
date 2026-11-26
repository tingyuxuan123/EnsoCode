export const frame = { width: 520, height: 560, title: "图标轨" };

const rail = [
	{ icon: "icon-[lucide--panel-left]", label: "收起侧栏" },
	{ icon: "icon-[lucide--code-xml]", label: "插件" },
	{ icon: "icon-[lucide--sparkles]", label: "扩展" },
	{ icon: "icon-[lucide--circle-dashed]", label: "派发" },
	{ icon: "icon-[lucide--book-marked]", label: "记忆", active: true },
];

export default function Icons() {
	return (
		<div className="flex h-full gap-8 bg-surface px-7 py-8 text-surface-foreground">
			<div className="flex w-[56px] shrink-0 flex-col items-center gap-1 rounded-[10px] border border-line bg-shell py-3">
				{rail.map((item) => (
					<span
						key={item.label}
						className={`flex size-9 items-center justify-center rounded-[8px] ${
							item.active ? "bg-raise text-surface-foreground" : "text-muted"
						}`}
					>
						<span className={`${item.icon} size-[19px]`} />
					</span>
				))}
				<span className="mt-1 h-px w-6 bg-line" />
				<span className="flex size-9 items-center justify-center rounded-[8px] text-muted">
					<span className="icon-[lucide--settings] size-[19px]" />
				</span>
			</div>

			<div className="min-w-0 flex-1">
				<h2 className="text-[13px] font-medium">图标轨里的一套线</h2>
				<p className="mt-1.5 text-[11.5px] leading-[1.7] text-muted">
					19px 图标、1.5 描边、无底色块；选中态只加一层亮度，不加颜色。记忆用书本带书签，和{" "}
					{"</>"}、星火、虚线圈同一套笔画。
				</p>

				<ul className="mt-5 space-y-2.5 border-t border-line pt-4">
					{[
						"图标 19px，画布 24，描边 1.5，圆角端点",
						"颜色取中间灰 #9a9a9e，浅色 #eaf1f5 与深色 #0e0e10 上都成立",
						"不画圆角底板、不用品牌色，选中态由宿主提供",
						"导出时去掉 width/height 与 fill，viewBox 走 0 0 24 24",
					].map((line) => (
						<li key={line} className="flex gap-2 text-[11.5px] leading-[1.65] text-muted">
							<span className="mt-[7px] size-[3px] shrink-0 rounded-full bg-faint" />
							{line}
						</li>
					))}
				</ul>

				<div className="mt-6 rounded-card bg-raise p-3">
					<p className="text-[11px] leading-[1.7] text-faint">
						现在这一枚是 64px 绿底方块，色块在小尺寸里先被读成“另一个应用”，才轮到里面的书。
					</p>
				</div>

				<div className="mt-4 rounded-card border border-line-soft bg-surface px-3 py-2.5">
					<div className="flex items-center justify-between text-[10.5px] text-faint">
						<span>icon.svg · lucide book-marked（ISC）</span>
						<span className="font-mono">24 × 24</span>
					</div>
					<pre className="mt-2 overflow-x-auto font-mono text-[9.5px] leading-[1.65] text-muted/90">
						{`<svg xmlns="http://www.w3.org/2000/svg"
  viewBox="0 0 24 24" fill="none"
  stroke="#9a9a9e" stroke-width="1.5"
  stroke-linecap="round"
  stroke-linejoin="round">
  <path d="M10 2v8l3-3 3 3V2"/>
  <path d="M4 19.5v-15A2.5 2.5 0 0 1
    6.5 2H19a1 1 0 0 1 1 1v18a1 1
    0 0 1-1 1H6.5a1 1 0 0 1 0-5H20"/>
</svg>`}
					</pre>
				</div>
			</div>
		</div>
	);
}
