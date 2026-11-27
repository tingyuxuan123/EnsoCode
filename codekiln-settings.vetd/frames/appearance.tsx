export const frame = { width: 1440, height: 900, title: "外观 · 主题、强调色与排版" };

import { Btn, SelectBox, Switch } from "../components/Controls";
import { SectionCard } from "../components/SectionCard";
import { Segmented } from "../components/Segmented";

/** 四套内置主题：色板是真的，卡片左上是主题自己的三段底色。 */
const themes = [
	{
		name: "深海 Kettu",
		note: "深色 · 当前",
		swatch: ["#0e0e10", "#141416", "#212124"],
		accent: "#f2581b",
		active: true,
	},
	{
		name: "云白 Kettu",
		note: "浅色 · 蓝灰",
		swatch: ["#eef2f4", "#fafbfc", "#ffffff"],
		accent: "#408abf",
		active: false,
	},
	{
		name: "晨雾 Ocean",
		note: "浅色 · 冷调",
		swatch: ["#eaf1f5", "#f5f8fa", "#ffffff"],
		accent: "#5b9aff",
		active: false,
	},
	{
		name: "薄荷 Mint",
		note: "浅色 · 绿调",
		swatch: ["#eef4ee", "#f7faf7", "#ffffff"],
		accent: "#0d8a88",
		active: false,
	},
];

const accents = ["#f2581b", "#e0a54b", "#6fbf8f", "#4f9dd9", "#a08be0", "#d97fa8"];

export default function Appearance() {
	return (
		<div className="px-9 pb-6 font-sans">
			<div className="w-full">
				<div className="flex items-end gap-4 pt-7">
					<div className="min-w-0">
						<h1 className="font-display text-[19px] font-semibold leading-[25px] tracking-tight">
							外观
						</h1>
						<p className="pt-1 text-[11.5px] leading-[16px] text-muted">
							主题决定界面底色与强调色；排版只影响聊天正文，不动整个界面
						</p>
					</div>
					<div className="ml-auto flex shrink-0 items-center gap-3">
						<Btn>获取更多主题</Btn>
					</div>
				</div>

				<div className="space-y-3 pt-5">
					<SectionCard title="主题" note="4 套内置 · 当前 深海 Kettu">
						<div className="grid grid-cols-4 gap-2 border-t border-white/[0.06] px-5 py-2.5">
							{themes.map((theme) => (
								<div
									key={theme.name}
									className={`overflow-hidden rounded-[8px] border ${theme.active ? "border-brand/60" : "border-white/[0.09]"}`}
								>
									<div className="flex h-[40px]">
										{theme.swatch.map((color) => (
											<span key={color} className="flex-1" style={{ backgroundColor: color }} />
										))}
									</div>
									<div className="px-2.5 py-2">
										<div className="flex items-center gap-1.5">
											<span
												className="size-[7px] shrink-0 rounded-full"
												style={{ backgroundColor: theme.accent }}
											/>
											<span className="truncate text-[12px] leading-[17px]">{theme.name}</span>
										</div>
										<div className="truncate pt-0.5 text-[10.5px] leading-[14px] text-faint">
											{theme.note}
										</div>
									</div>
								</div>
							))}
						</div>
					</SectionCard>

					<SectionCard title="个性化" note="模式、强调色与排版都属于当前选中的主题">
						<div className="flex items-center justify-between gap-6 border-t border-white/[0.06] px-5 py-[10px]">
							<div className="min-w-0">
								<div className="text-[12.5px] leading-[17px]">主题模式</div>
								<div className="text-[11px] leading-[15px] text-faint">
									跟随系统时，系统切到浅色会一起切
								</div>
							</div>
							<Segmented options={["浅色", "深色", "跟随系统", "同步终端"]} active="深色" />
						</div>
						<div className="flex items-center justify-between gap-6 border-t border-white/[0.06] px-5 py-[10px]">
							<div className="min-w-0">
								<div className="text-[12.5px] leading-[17px]">强调色</div>
								<div className="text-[11px] leading-[15px] text-faint">
									选中态、开关与链接共用这一个颜色
								</div>
							</div>
							<div className="flex shrink-0 items-center gap-2">
								{accents.map((color) => (
									<span
										key={color}
										className={`size-[15px] rounded-full ${color === accents[0] ? "ring-2 ring-white/70 ring-offset-2 ring-offset-surface" : ""}`}
										style={{ backgroundColor: color }}
									/>
								))}
							</div>
						</div>
						<div className="flex items-center justify-between gap-6 border-t border-white/[0.06] px-5 py-[10px]">
							<div className="min-w-0">
								<div className="text-[12.5px] leading-[17px]">减少动效</div>
								<div className="text-[11px] leading-[15px] text-faint">
									关掉页面切换与列表过渡；滚动与输入保持原样
								</div>
							</div>
							<Switch on={false} />
						</div>
					</SectionCard>

					<SectionCard title="聊天排版" note="只影响对话正文、表格与代码块">
						<div className="grid grid-cols-[1fr_120px_120px] items-center gap-4 border-t border-white/[0.06] px-5 py-[6px] text-[11px] text-faint">
							<span>元素</span>
							<span>字号</span>
							<span>字重</span>
						</div>
						{[
							{ label: "正文", size: "14 px", weight: "400" },
							{ label: "标题", size: "18 px", weight: "600" },
							{ label: "表格", size: "13 px", weight: "400" },
							{ label: "代码", size: "12.5 px", weight: "400" },
						].map((row) => (
							<div
								key={row.label}
								className="grid grid-cols-[1fr_120px_120px] items-center gap-4 border-t border-white/[0.06] px-5 py-[6px]"
							>
								<span className="text-[12.5px] leading-[17px]">{row.label}</span>
								<SelectBox value={row.size} />
								<SelectBox value={row.weight} />
							</div>
						))}
						<div className="flex items-center gap-3 border-t border-white/[0.06] px-5 py-[10px]">
							<div className="min-w-0 flex-1">
								<div className="text-[12.5px] leading-[17px]">恢复默认排版</div>
								<div className="text-[11px] leading-[15px] text-faint">
									回到主题自带的字号与行高，不影响上面的开关
								</div>
							</div>
							<Btn>恢复默认</Btn>
						</div>
					</SectionCard>
				</div>
			</div>
		</div>
	);
}
