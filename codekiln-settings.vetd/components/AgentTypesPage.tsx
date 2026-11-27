import { Badge, Btn, ModelSelect, SelectBox, Switch } from "./Controls";
import { SectionCard } from "./SectionCard";
import { agentTypes, subagentModels } from "./data";

/**
 * 子代理类型页正文（不含窗口壳）。顺序与真实页面一致：类型清单在上，
 * 候选模型在下面；类型行是三段式——名称与徽章、描述、派发方式。
 */
export function AgentTypesPage({ scroll = 0 }: { scroll?: number }) {
	return (
		<div className="px-9 pb-6 font-sans" style={scroll ? { marginTop: -scroll } : undefined}>
			<div className="w-full">
				<div className="flex items-end gap-4 pt-7">
					<div className="min-w-0">
						<h1 className="font-display text-[19px] font-semibold leading-[25px] tracking-tight">
							子代理类型
						</h1>
						<p className="pt-1 text-[11.5px] leading-[16px] text-muted">
							{agentTypes.length} 个类型 · {subagentModels.length} 个候选模型 · 主 agent 按
							agent_type 派发
						</p>
					</div>
				</div>

				<div className="pt-5">
					<SectionCard title="类型清单" note="同名自定义会顶替内置行；锁定与 general 不能改">
						{agentTypes.map((type) => (
							<div
								key={type.name}
								className="flex items-start gap-3.5 border-t border-white/[0.06] px-5 py-[10px] hover:bg-white/[0.015]"
							>
								<span
									className={`icon-[lucide--bot] mt-[3px] size-[15px] shrink-0 ${type.state === "locked" ? "text-faint" : "text-faint/80"}`}
								/>
								<div className="min-w-0 flex-1">
									<div className="flex min-w-0 items-center gap-2">
										<span className="shrink-0 font-mono text-[13.5px] font-medium leading-[18px]">
											{type.name}
										</span>
										{type.badges.map((badge) => (
											<Badge key={badge}>{badge}</Badge>
										))}
									</div>
									<p className="truncate pt-[3px] text-[12.5px] leading-[18px] text-muted">
										{type.description}
									</p>
									<p className="truncate pt-[2px] text-[11.5px] leading-[17px] text-faint">
										{type.pickedBy}
									</p>
								</div>
								<div className="mt-[2px] flex shrink-0 items-center gap-2.5">
									{type.actions ? (
										<>
											<span className="icon-[lucide--pencil] size-[13px] text-faint" />
											{type.actions === "edit-delete" ? (
												<span className="icon-[lucide--trash-2] size-[13px] text-faint" />
											) : null}
										</>
									) : null}
									{type.state === "locked" ? null : <Switch on={type.state === "on"} />}
								</div>
							</div>
						))}
						<div className="flex items-center justify-center border-t border-white/[0.06] bg-white/[0.015] py-[11px] text-[12.5px] text-muted">
							<span className="icon-[lucide--plus] mr-1.5 size-[13px]" />
							新建类型
						</div>
					</SectionCard>
				</div>

				<div className="space-y-3 pt-3">
					<SectionCard title="同时在编 coworker 上限" note="subagent 不计入，调低不会解散已有成员">
						<div className="flex items-center gap-6 border-t border-white/[0.06] px-5 py-3">
							<div className="min-w-0 flex-1">
								<p className="text-[12px] leading-[17px] text-muted">
									一个会话能同时保留几个 coworker；雇新的前需先解雇
								</p>
							</div>
							<span className="block w-[86px] shrink-0">
								<SelectBox value="4" />
							</span>
						</div>
					</SectionCard>

					<SectionCard
						title="允许子代理指定模型"
						note="派发时从这些模型里挑，描述就是选型规则"
						action={
							<>
								<Btn tone="ghost">
									<span className="icon-[lucide--sparkles] size-[12px] text-brand" />
									AI 自动配置
								</Btn>
								<span className="flex items-center gap-1.5 text-[10.5px] text-faint">
									启用
									<Switch on={true} />
								</span>
							</>
						}
					>
						{subagentModels.map((model) => (
							<div
								key={`${model.model}-${model.note}`}
								className={`flex items-start gap-3 border-t border-white/[0.06] px-5 py-[10px] ${model.enabled ? "" : "opacity-55"}`}
							>
								<Switch on={model.enabled} />
								<div className="min-w-0 flex-1">
									<div className="flex min-w-0 items-center gap-2">
										<span className="min-w-0 shrink">
											<ModelSelect model={model.model} provider={model.provider} />
										</span>
										<Badge tone="outline">思考 {model.thinking}</Badge>
									</div>
									<p className="truncate pt-[3px] text-[11.5px] leading-[17px] text-faint">
										{model.note}
									</p>
								</div>
								<span className="icon-[lucide--trash-2] mt-[6px] size-[13px] shrink-0 text-faint/70" />
							</div>
						))}
						<div className="flex items-center gap-1.5 border-t border-white/[0.06] px-5 py-[9px] text-[11.5px] text-muted">
							<span className="icon-[lucide--plus] size-[13px]" />
							<span>添加模型</span>
							<span className="ml-auto text-[10.5px] text-faint">
								没有可用模型时这一块不生效，子代理跟随会话模型
							</span>
						</div>
					</SectionCard>
				</div>
			</div>
		</div>
	);
}
