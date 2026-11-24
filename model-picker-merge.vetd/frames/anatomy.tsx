export const frame = { width: 1040, height: 600, title: "结构来源 · 借来什么，留下什么" };

import { ModelPickerPanel } from "../components/ModelPickerPanel";
import { LEVELS, MAGPIE_GROUP, RAIL } from "../components/data";

const LEGEND = [
	{
		n: 1,
		title: "条目轨",
		body: "借自 open-vetta 的第一栏。这里放账号与网关条目：切换来源一步到位，模型不再藏在二级菜单里。",
	},
	{
		n: 2,
		title: "搜索 + ⌘P",
		body: "关键词跨全部条目检索；⌘P 是现有快捷键，用它打开时直接聚焦搜索框。",
	},
	{
		n: 3,
		title: "条目头",
		body: "厂商名留在列表顶部，账号邮箱 / 网关地址跟在右侧——来源信息不丢，但不占一次点击。",
	},
	{
		n: 4,
		title: "模型行",
		body: "名称 + 上游/模型 小字 + 上下文窗口 + 选中勾。同一个 magpie 后面挂着多个上游，重名靠第二行分开。",
	},
	{
		n: 5,
		title: "推理开关",
		body: "CodeKiln 原来的二态开关，从列表底部搬到所属模型的右栏，和它真正作用的那个模型对齐。",
	},
	{
		n: 6,
		title: "档位滑杆",
		body: "几何不动：整宽轨道、白滑块、档位点、底部标签。只把颜色从写死的紫改成品牌橙派生。",
	},
];

function Pin({ n, left, top }: { n: number; left: number; top: number }) {
	return (
		<span
			style={{ left, top }}
			className="absolute flex size-[18px] items-center justify-center rounded-full bg-brand text-[9px] font-semibold leading-none text-white ring-[3px] ring-ground"
		>
			{n}
		</span>
	);
}

export default function Anatomy() {
	return (
		<div className="flex h-full gap-9 bg-ground px-10 py-10">
			<div className="flex w-[604px] shrink-0 flex-col">
				<div className="mb-3 flex items-baseline justify-between">
					<p className="text-[12px] text-ink">模型与推理浮层</p>
					<p className="font-mono text-[11px] text-faint">604 × 368 · 三栏</p>
				</div>
				<div className="relative w-[604px]">
					<ModelPickerPanel
						rail={RAIL}
						activeRail="magpie"
						query=""
						groups={[MAGPIE_GROUP]}
						levels={LEVELS}
						level="最高"
						modelLabel="GPT-6.2 Sol"
						note="不支持的档位会自动降档。"
					/>
					<Pin n={1} left={18} top={54} />
					<Pin n={2} left={350} top={12} />
					<Pin n={3} left={120} top={47} />
					<Pin n={4} left={316} top={128} />
					<Pin n={5} left={544} top={8} />
					<Pin n={6} left={452} top={140} />
				</div>
			</div>

			<div className="flex min-w-0 flex-1 flex-col">
				<p className="text-[11px] text-muted">结构来源</p>
				<p className="mt-1 text-[13px] font-medium leading-5 text-ink">
					骨架借 open-vetta，推理控制件留自家
				</p>
				<div className="mt-5 flex flex-col gap-4">
					{LEGEND.map((item) => (
						<div key={item.n} className="flex gap-3">
							<span className="flex size-[16px] shrink-0 items-center justify-center rounded-full text-[9.5px] font-semibold leading-none text-faint ring-1 ring-inset ring-white/20">
								{item.n}
							</span>
							<div className="min-w-0">
								<p className="text-[12px] font-medium leading-4 text-ink">{item.title}</p>
								<p className="mt-1 text-[11px] leading-[17px] text-faint">{item.body}</p>
							</div>
						</div>
					))}
				</div>
				<p className="mt-auto border-t border-hairline pt-3 text-[10.5px] leading-4 text-faint">
					深色令牌沿用应用：地面 #141416、浮层 #212124、强调 #f2581b。浮层右边缘与输入条右边缘对齐；胶囊展开时底色提亮、箭头翻转，和这一栏同时出现。
				</p>
			</div>
		</div>
	);
}
