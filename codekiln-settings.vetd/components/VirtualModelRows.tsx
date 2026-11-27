import { virtualModels } from "./data";

/**
 * 路由卡里的虚拟模型概览：一行一个可选 id，右端只说回退数量，细节留给展开后的编辑器。
 */
export function VirtualModelRows() {
	return (
		<div>
			{virtualModels.map((model) => (
				<div
					key={model.id}
					className="flex items-center gap-3 border-t border-white/[0.05] py-[8px] hover:bg-white/[0.02]"
				>
					<span className="min-w-0 flex-1 truncate font-mono text-[11.5px] leading-[16px]">
						{model.id}
					</span>
					<span className="shrink-0 text-[11px] text-faint">{model.note}</span>
					<span className="w-[54px] shrink-0 text-right text-[10.5px] tabular-nums text-faint">
						{model.fallbacks > 0 ? `回退 ${model.fallbacks}` : "无回退"}
					</span>
					<span className="icon-[lucide--chevron-right] size-[12px] shrink-0 text-faint" />
				</div>
			))}
			<div className="flex items-center gap-1.5 border-t border-white/[0.05] py-[8px] text-[11.5px] text-muted">
				<span className="icon-[lucide--plus] size-[12px]" />
				<span>新建虚拟模型</span>
				<span className="ml-auto text-[10.5px] text-faint">成员不含 Cursor</span>
			</div>
		</div>
	);
}
