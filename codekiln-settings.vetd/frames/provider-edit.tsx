export const frame = { width: 1440, height: 900, title: "编辑服务商 · 模型清单与覆盖" };

import { Badge, Btn, Checkbox, Field, Input, SelectBox, Switch } from "../components/Controls";
import { ModelCenter } from "../components/ModelCenter";
import { Modal } from "../components/Modal";
import { Segmented } from "../components/Segmented";
import { Window } from "../components/Window";
import { apiKeyDetail, modelRoster } from "../components/data";

const BADGE_LABEL = {
	default: { label: "默认", tone: "outline" as const },
	overridden: { label: "已覆盖", tone: "brand" as const },
	catalog: { label: "目录", tone: "plain" as const },
};

export default function ProviderEdit() {
	return (
		<Window
			overlay={
				<Modal
					title="编辑服务商"
					note={`${apiKeyDetail.name} · ${apiKeyDetail.enabledModels}/${apiKeyDetail.models} 个模型已启用`}
					width={1000}
					footer={
						<>
							<span className="flex items-center gap-1.5 text-[11px] text-faint">
								<span className="icon-[lucide--info] size-[12px]" />
								覆盖只作用于这一条服务商里的这个模型，不影响目录事实
							</span>
							<span className="ml-auto flex shrink-0 items-center gap-2">
								<Btn>取消</Btn>
								<Btn tone="primary">保存</Btn>
							</span>
						</>
					}
				>
					<div className="flex gap-6">
						<div className="flex w-[300px] shrink-0 flex-col gap-3">
							<Field label="名称">
								<Input value={apiKeyDetail.name} />
							</Field>
							<Field label="API 类型">
								<SelectBox value={apiKeyDetail.apiKind} />
							</Field>
							<Field label="地址">
								<Input value={apiKeyDetail.baseUrl} mono />
							</Field>
							<Field label="密钥" hint="改地址后需重输">
								<Input
									value={apiKeyDetail.key}
									mono
									trailing={<span className="icon-[lucide--eye] size-[13px] text-faint" />}
								/>
							</Field>
							<Field label="来源">
								<Input value={`从 ${apiKeyDetail.importedFrom} 导入`} dim />
							</Field>
							<div className="flex items-center justify-between gap-3 rounded-[6px] border border-border px-2.5 py-2">
								<div className="min-w-0">
									<div className="text-[11.5px] leading-[16px]">启用</div>
									<div className="text-[10.5px] leading-[14px] text-faint">
										停用后模型一起消失，配置保留
									</div>
								</div>
								<Switch on={true} />
							</div>
						</div>

						<div className="flex min-w-0 flex-1 flex-col">
							<div className="flex items-baseline gap-2 pb-1.5">
								<span className="text-[11px] leading-[15px] text-muted">模型</span>
								<span className="text-[10.5px] text-faint">
									{modelRoster.filter((row) => row.enabled).length}/{modelRoster.length} 已启用
								</span>
								<span className="ml-auto">
									<Btn>
										<span className="icon-[lucide--list-plus] size-[12px]" />
										拉取模型
									</Btn>
								</span>
							</div>

							<div className="flex items-center gap-1.5 pb-1.5">
								<span className="flex h-[27px] min-w-0 flex-1 items-center gap-1.5 rounded-[6px] border border-border px-2 text-[11px] text-faint">
									<span className="icon-[lucide--search] size-[12px] shrink-0" />
									筛选模型…
								</span>
								<Btn>
									<Checkbox checked={false} />
									全选
								</Btn>
								<Btn>启用</Btn>
								<Btn>停用</Btn>
							</div>

							<div className="min-h-0 flex-1 space-y-0.5 rounded-[6px] border border-white/[0.07] p-1">
								{modelRoster.map((row) => {
									const badge = BADGE_LABEL[row.badge];
									const expanded = row.id === "anthropic/claude-sonnet-4.6";
									return (
										<div key={row.id} className="rounded-[5px]">
											<div
												className={`flex items-center gap-2 px-1.5 py-[5px] ${expanded ? "bg-white/[0.04]" : "hover:bg-white/[0.03]"}`}
											>
												<Checkbox checked={false} />
												<Switch on={row.enabled} />
												<span
													className={`min-w-0 flex-1 truncate font-mono text-[11px] leading-[15px] ${row.enabled ? "" : "text-faint line-through"}`}
												>
													{row.id}
												</span>
												<Badge tone={badge.tone}>{badge.label}</Badge>
												{expanded ? (
													<span className="icon-[lucide--chevron-down] size-[12px] shrink-0 rotate-180 text-faint" />
												) : (
													<span className="icon-[lucide--chevron-down] size-[12px] shrink-0 text-faint" />
												)}
												<span className="icon-[lucide--trash-2] size-[12px] shrink-0 text-faint/60" />
											</div>
											{expanded ? (
												<div className="mb-1 ml-6 space-y-2 rounded-[6px] border border-dashed border-white/[0.2] bg-white/[0.03] p-2">
													<div className="flex items-start gap-2">
														<div className="w-[54px] shrink-0 pt-[5px] text-[10.5px] text-faint">
															推理
														</div>
														<Segmented options={["开", "关", "继承"]} active="开" />
													</div>
													<div className="flex items-start gap-2">
														<div className="w-[54px] shrink-0 pt-[5px] text-[10.5px] text-faint">
															思考档
														</div>
														<span className="block w-[130px]">
															<SelectBox value={row.thinking ?? "继承"} />
														</span>
													</div>
													<div className="flex items-start gap-2">
														<div className="w-[54px] shrink-0 pt-[5px] text-[10.5px] text-faint">
															上下文
														</div>
														<span className="block w-[110px]">
															<Input value={row.context} mono />
														</span>
														<div className="w-[54px] shrink-0 pt-[5px] text-[10.5px] text-faint">
															最大 token
														</div>
														<span className="block w-[110px]">
															<Input value={row.maxTokens} mono />
														</span>
														<span className="pt-[8px] text-[10.5px] text-faint">
															留空即继承目录
														</span>
													</div>
												</div>
											) : null}
										</div>
									);
								})}
								<p className="px-1.5 py-1 text-[10.5px] leading-[14px] text-faint">
									新拉到的模型追加为裸行；上游缺席的行会保留，不会因为一次失败消失
								</p>
							</div>
						</div>
					</div>
				</Modal>
			}
		>
			<ModelCenter />
		</Window>
	);
}
