export const frame = { width: 1440, height: 900, title: "虚拟模型 · 主模型、快模型与回退" };

import { Btn, Input, ModelSelect, SelectBox, Switch } from "../components/Controls";
import { ModelCenter } from "../components/ModelCenter";
import { Modal } from "../components/Modal";
import { Window } from "../components/Window";
import { virtualModelDetail } from "../components/data";

function Row({
	label,
	hint,
	children,
}: {
	label: string;
	hint?: string;
	children: React.ReactNode;
}) {
	return (
		<div className="flex items-start gap-3 border-t border-white/[0.05] py-[9px]">
			<div className="w-[88px] shrink-0">
				<div className="text-[11.5px] leading-[17px] text-muted">{label}</div>
				{hint ? <div className="text-[10px] leading-[14px] text-faint">{hint}</div> : null}
			</div>
			<div className="min-w-0 flex-1">{children}</div>
		</div>
	);
}

export default function VirtualModel() {
	return (
		<Window
			overlay={
				<Modal
					title="虚拟模型"
					note="在选择器里是一个 id，每次请求内部挑真实成员；成员不含 Cursor"
					width={820}
					footer={
						<>
							<span className="text-[11px] text-faint">
								对新会话生效 · 成员被限流或故障时按顺序换下一个
							</span>
							<span className="ml-auto flex shrink-0 items-center gap-2">
								<Btn>取消</Btn>
								<Btn tone="primary">保存</Btn>
							</span>
						</>
					}
				>
					<div className="space-y-1.5">
						<div className="flex items-center gap-2.5 rounded-[6px] px-2 py-1.5 text-[11.5px] text-faint">
							<span className="icon-[lucide--chevron-right] size-[12px] shrink-0" />
							<Switch on={true} />
							<span className="w-[132px] shrink-0 truncate text-[12px] text-foreground">
								Auto · 评审
							</span>
							<span className="min-w-0 flex-1 truncate">
								主 gpt-6.1-sol · 快 — · 回退 2 · 难度路由：关
							</span>
						</div>

						<div className="rounded-[7px] border border-white/[0.1] bg-white/[0.02]">
							<div className="flex items-center gap-2.5 px-3 py-2.5">
								<Switch on={true} />
								<span className="min-w-0 flex-1">
									<Input value={virtualModelDetail.name} />
								</span>
								<span className="flex shrink-0 items-center gap-2 text-faint">
									<span className="icon-[lucide--chevron-down] size-[12px] rotate-180" />
									<span className="icon-[lucide--trash-2] size-[13px]" />
								</span>
							</div>

							<div className="px-3">
								<Row label="主模型" hint="每个新回合">
									<ModelSelect
										model={virtualModelDetail.primary.model}
										provider={virtualModelDetail.primary.provider}
										context={virtualModelDetail.primary.context}
									/>
								</Row>
								<Row label="快模型" hint="总结与简单回合">
									<div className="flex items-center gap-2">
										<ModelSelect
											model={virtualModelDetail.fast.model}
											provider={virtualModelDetail.fast.provider}
											context={virtualModelDetail.fast.context}
										/>
										<span className="icon-[lucide--x] size-[12px] shrink-0 text-faint" />
									</div>
								</Row>
								<Row label="回退模型" hint="限流时按序">
									<div className="space-y-1.5">
										{virtualModelDetail.fallbacks.map((fallback) => (
											<div key={fallback.model} className="flex items-center gap-2">
												<ModelSelect
													model={fallback.model}
													provider={fallback.provider}
													context={fallback.context}
												/>
												<span className="icon-[lucide--x] size-[12px] shrink-0 text-faint" />
											</div>
										))}
										<div className="flex items-center gap-2 pt-0.5">
											<Btn>
												<span className="icon-[lucide--plus] size-[12px]" />
												添加回退
											</Btn>
											<span className="text-[10.5px] text-faint">最多 8 个</span>
										</div>
									</div>
								</Row>
								<Row label="难度路由" hint="按回合复杂度分流">
									<div className="flex items-center gap-2">
										<span className="block w-[150px]">
											<SelectBox value={virtualModelDetail.classifier} />
										</span>
										<span className="flex items-center gap-1.5 text-[10.5px] text-faint">
											超时
											<span className="block w-[62px]">
												<Input value={virtualModelDetail.timeout} mono />
											</span>
											秒，超时用主模型
										</span>
									</div>
								</Row>
								<p className="border-t border-white/[0.05] py-2 text-[10.5px] leading-[15px] text-faint">
									复杂度由快模型裁判或分类器判断：简单回合走快模型，复杂回合走主模型；分类失败一律走主模型。
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
