import { routes } from "./data";

/**
 * 四个字段：角色 + 模型（含上下文）贴左，约束与"不可用时怎么办"贴右。
 * 回退不是三档通用能力——只有虚拟模型有回退链，所以这一列写真实行为。
 */
const GRID = "grid grid-cols-[212px_300px_1fr_176px] items-center gap-4 px-5";

export function RouteTable() {
	return (
		<div>
			<div className={`${GRID} border-t border-white/[0.05] py-1.5 text-[11px] text-faint`}>
				<span>角色</span>
				<span>模型 · 上下文</span>
				<span>约束</span>
				<span className="text-right">不可用时</span>
			</div>
			{routes.map((route) => (
				<div
					key={route.role}
					className={`${GRID} border-t border-white/[0.05] py-[9px] hover:bg-white/[0.02]`}
				>
					<div className="min-w-0">
						<div className="truncate text-[13px] font-medium leading-[18px]">{route.role}</div>
						<div className="truncate text-[11px] leading-[15px] text-faint">{route.note}</div>
					</div>
					{route.unset ? (
						<div className="min-w-0">
							<span className="rounded-[5px] border border-dashed border-white/[0.18] px-[7px] py-[2px] text-[11.5px] leading-[15px] text-muted">
								未选择
							</span>
							<div className="pt-[3px] text-[11px] leading-[15px] text-faint">这一档不可用</div>
						</div>
					) : (
						<div className="min-w-0">
							<div className="flex min-w-0 items-baseline gap-2">
								<span className="truncate font-mono text-[12px] leading-[17px]">{route.model}</span>
								<span className="shrink-0 text-[10.5px] tabular-nums leading-[15px] text-faint">
									{route.context}
								</span>
								<span className="icon-[lucide--chevron-down] size-[12px] shrink-0 text-faint" />
							</div>
							<div className="truncate text-[11px] leading-[15px] text-faint">{route.provider}</div>
						</div>
					)}
					<div className="truncate text-[11.5px] leading-[16px] text-muted">{route.constraint}</div>
					<div
						className={`truncate text-right text-[11.5px] leading-[16px] ${route.unset ? "text-warning/80" : "text-faint"}`}
					>
						{route.whenUnavailable}
					</div>
				</div>
			))}
		</div>
	);
}
