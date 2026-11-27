export const frame = { width: 1440, height: 900, title: "模型路由 · 三档加虚拟模型" };

import { Link } from "react-router";
import { Modal } from "../components/Modal";
import { ModelCenter } from "../components/ModelCenter";
import { ModelSelect, SelectBox, Switch } from "../components/Controls";
import { Segmented } from "../components/Segmented";
import { VirtualModelRows } from "../components/VirtualModelRows";
import { Window } from "../components/Window";

const REASONING_LEVELS = ["最低", "低", "中", "高", "极高", "最高"];

function SectionHead({ title, note }: { title: string; note?: string }) {
	return (
		<div className="flex items-baseline gap-2 pb-1 pt-5">
			<h3 className="text-[13px] font-semibold leading-[17px]">{title}</h3>
			{note ? <span className="text-[11px] leading-[15px] text-faint">{note}</span> : null}
		</div>
	);
}

function Row({
	label,
	note,
	children,
}: {
	label: string;
	note?: string;
	children: React.ReactNode;
}) {
	return (
		<div className="flex items-center justify-between gap-6 border-t border-white/[0.05] py-[9px]">
			<div className="min-w-0 flex-1">
				<div className="text-[12.5px] leading-[17px]">{label}</div>
				{note ? <div className="text-[11px] leading-[15px] text-faint">{note}</div> : null}
			</div>
			<div className="shrink-0">{children}</div>
		</div>
	);
}

export default function RouteSheet() {
	return (
		<Window
			overlay={
				<Modal
					title="模型路由"
					note="新会话按这三档取模型；进行中的会话切换模型后才用新配置"
					width={800}
					footer={
						<>
							<Link to="/agent-types" className="flex items-center gap-1.5 text-[11px] text-faint">
								<span className="icon-[lucide--bot] size-[12px]" />
								子代理候选模型在「子代理类型」里维护
								<span className="icon-[lucide--arrow-right] size-[11px]" />
							</Link>
							<span className="ml-auto text-[11px] text-faint">改动立即保存</span>
						</>
					}
				>
					<SectionHead title="默认对话" />
					<Row label="模型">
						<ModelSelect model="gpt-6.1-sol" provider="ChatGPT 订阅" context="200K" />
					</Row>
					<Row label="推理强度" note="六档，跟模型声明的档位取交集">
						<Segmented options={REASONING_LEVELS} active="高" />
					</Row>
					<Row label="跟随上一次选择" note="开启后新会话沿用你上次选的模型，这里的默认值只作兜底">
						<Switch on={false} />
					</Row>

					<SectionHead title="会话标题总结" note="首条消息后生成短标题" />
					<Row label="启用">
						<Switch on={true} />
					</Row>
					<Row label="模型" note="不开启推理；失效时回落到默认对话">
						<div className="flex items-center gap-3">
							<ModelSelect model="gpt-4.1-mini" provider="OpenAI（已停用）" stale />
							<span className="flex items-center gap-1 text-[11.5px] text-muted">
								<span className="icon-[lucide--rotate-ccw] size-[11px]" />
								跟随默认
							</span>
						</div>
					</Row>
					<p className="flex items-center gap-1.5 border-t border-white/[0.05] py-[8px] text-[11px] leading-[15px] text-warning">
						<span className="icon-[lucide--triangle-alert] size-[12px] shrink-0" />
						选中的模型已不可用（服务商被停用）—— 标题会回落到默认对话
					</p>

					<SectionHead title="助手代审" note="危险操作的二次判断，不回退" />
					<Row label="模型" note="需要先选一个模型，这一档才可用">
						<ModelSelect model="" provider="" unset />
					</Row>
					<Row label="自动管理放行" note="只在分类器模型很确定时自动放行">
						<div className="flex items-center gap-3">
							<span className="text-[11.5px] text-faint">需先选择模型</span>
							<Switch on={false} dim />
						</div>
					</Row>
					<Row label="自动放行阈值" note="接近阈值时可能这次放行、下次不放行">
						<span className="block w-[150px]">
							<SelectBox value="0.90 · 默认" />
						</span>
					</Row>

					<SectionHead title="虚拟模型" note="一个可选 id，每次请求内部挑真实成员" />
					<div className="px-0">
						<VirtualModelRows />
					</div>
				</Modal>
			}
		>
			<ModelCenter />
		</Window>
	);
}
