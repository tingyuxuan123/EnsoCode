export const frame = { width: 1440, height: 900, title: "子代理类型 · 编辑与工具集" };

import { AgentTypesPage } from "../components/AgentTypesPage";
import { Badge, Btn, Checkbox, Field, Input, SelectBox, TextArea } from "../components/Controls";
import { Modal } from "../components/Modal";
import { Window } from "../components/Window";
import { agentTypeDraft, mcpChoices, skillChoices } from "../components/data";

export default function AgentTypeEdit() {
	return (
		<Window
			overlay={
				<Modal
					title="编辑子代理类型"
					note="保存后同名自定义会顶替内置行；删除自定义即恢复内置"
					width={980}
					footer={
						<>
							<span className="flex items-center gap-1.5 text-[11px] text-faint">
								<span className="icon-[lucide--info] size-[12px]" />
								描述会进 subagent 工具的 agent_type 说明，决定主 agent 何时选它
							</span>
							<span className="ml-auto flex shrink-0 items-center gap-2">
								<Btn>取消</Btn>
								<Btn tone="primary">保存</Btn>
							</span>
						</>
					}
				>
					<div className="flex gap-6">
						<div className="flex min-w-0 flex-1 flex-col gap-3">
							<div className="grid grid-cols-2 gap-3">
								<Field label="名称（slug）" hint="小写、短横线">
									<Input value={agentTypeDraft.name} mono />
								</Field>
								<Field label="描述" hint="一句话，给主 agent 看">
									<Input value={agentTypeDraft.description} />
								</Field>
							</div>
							<Field label="系统提示" hint="纯文本，支持换行">
								<TextArea value={agentTypeDraft.systemPrompt} rows={12} />
							</Field>
							<div className="grid grid-cols-2 gap-3">
								<Field label="模型选择" hint="候选 4 个">
									<SelectBox value={agentTypeDraft.modelMode} />
								</Field>
								<Field label="工具集">
									<SelectBox value={agentTypeDraft.toolset} />
								</Field>
							</div>
							<p className="text-[10.5px] leading-[15px] text-faint">
								选「固定模型」才会出现服务商、模型与思考档；跟随会话与候选挑选都不写覆盖。
							</p>
						</div>

						<div className="flex w-[320px] shrink-0 flex-col gap-4">
							<div>
								<div className="flex items-baseline gap-2 pb-1.5">
									<span className="text-[11px] leading-[15px] text-muted">技能</span>
									<span className="text-[10.5px] text-faint">
										{skillChoices.filter((skill) => skill.checked).length}/{skillChoices.length}
									</span>
									<span className="ml-auto text-[10.5px] text-faint">全选</span>
								</div>
								<div className="flex h-[27px] items-center gap-1.5 rounded-[6px] border border-border px-2 text-[11px] text-faint">
									<span className="icon-[lucide--search] size-[12px] shrink-0" />
									筛选技能…
								</div>
								<div className="mt-1.5 space-y-0.5 rounded-[6px] border border-white/[0.07] p-1">
									{skillChoices.map((skill) => (
										<div
											key={skill.name}
											className={`flex items-center gap-2 px-1.5 py-[6px] ${skill.checked ? "" : "opacity-70"}`}
										>
											<Checkbox checked={skill.checked} />
											<span className="min-w-0 flex-1 truncate font-mono text-[11px] leading-[15px]">
												{skill.name}
											</span>
											<Badge tone="outline">{skill.source}</Badge>
										</div>
									))}
								</div>
							</div>

							<div>
								<div className="flex items-baseline gap-2 pb-1.5">
									<span className="text-[11px] leading-[15px] text-muted">MCP 服务</span>
									<span className="text-[10.5px] text-faint">
										{mcpChoices.filter((mcp) => mcp.checked).length}/{mcpChoices.length}
									</span>
								</div>
								<div className="space-y-0.5 rounded-[6px] border border-white/[0.07] p-1">
									{mcpChoices.map((mcp) => (
										<div
											key={mcp.name}
											className={`flex items-center gap-2 px-1.5 py-[6px] ${mcp.checked ? "" : "opacity-70"}`}
										>
											<Checkbox checked={mcp.checked} />
											<span className="min-w-0 flex-1 truncate font-mono text-[11px] leading-[15px]">
												{mcp.name}
											</span>
											<Badge tone="outline">{mcp.transport}</Badge>
										</div>
									))}
								</div>
								<p className="pt-1.5 text-[10.5px] leading-[15px] text-faint">
									只读工具集保留 read / grep / find / ls，外加这里绑定的 MCP。
								</p>
							</div>
						</div>
					</div>
				</Modal>
			}
		>
			<AgentTypesPage />
		</Window>
	);
}
