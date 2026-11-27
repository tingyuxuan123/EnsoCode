export const frame = { width: 1440, height: 900, title: "添加服务商 · API Key 与首次拉取" };

import { Btn, Field, Input, SelectBox } from "../components/Controls";
import { ModelCenter } from "../components/ModelCenter";
import { Modal } from "../components/Modal";
import { Window } from "../components/Window";

export default function ProviderApi() {
	return (
		<Window
			overlay={
				<Modal
					title="添加服务商 · OpenRouter"
					note="填地址和密钥，拉一次模型；拉通才留下可用的条目"
					width={880}
					footer={
						<>
							<Btn>
								<span className="icon-[lucide--zap] size-[12px]" />
								测试连接
							</Btn>
							<span className="block w-[190px]">
								<SelectBox value="deepseek-v4.1-flash" />
							</span>
							<span className="text-[10.5px] text-faint">测试用模型</span>
							<span className="ml-auto flex shrink-0 items-center gap-2">
								<Btn>取消</Btn>
								<Btn tone="primary">保存</Btn>
							</span>
						</>
					}
				>
					<div className="flex gap-6">
						<div className="flex min-w-0 flex-1 flex-col gap-3.5">
							<div className="flex items-end gap-3">
								<Field label="名称" grow>
									<Input value="OpenRouter" />
								</Field>
								<span className="block w-[188px] shrink-0">
									<Field label="API 类型">
										<SelectBox value="openai-completions" />
									</Field>
								</span>
							</div>
							<Field label="地址">
								<Input value="https://openrouter.ai/api/v1" mono />
							</Field>
							<Field label="密钥" hint="只保存在本机 Main 进程">
								<Input
									value="••••••••••••••••••••"
									mono
									trailing={<span className="icon-[lucide--eye] size-[13px] text-faint" />}
								/>
							</Field>

							<div className="rounded-[6px] border border-destructive/25 bg-destructive/5 px-3 py-2">
								<div className="flex items-start gap-2">
									<span className="icon-[lucide--circle-x] size-[13px] shrink-0 text-destructive" />
									<div className="min-w-0 flex-1">
										<p className="text-[11.5px] leading-[16px] text-destructive">
											连接失败：401 Invalid API key
										</p>
										<p className="pt-0.5 text-[10.5px] leading-[15px] text-faint">
											请求已发出、上游拒绝了这个密钥；换密钥或确认账户额度
										</p>
									</div>
									<span className="shrink-0 text-[10.5px] text-muted">查看详情</span>
								</div>
							</div>

							<p className="flex items-start gap-1.5 text-[11px] leading-[16px] text-faint">
								<span className="icon-[lucide--shield] size-[12px] shrink-0" />
								换地址或 API 类型后需要重新输入密钥；否则旧凭证的绑定会失效，保存会被拒绝。
							</p>
						</div>

						<div className="flex w-[280px] shrink-0 flex-col">
							<div className="flex items-baseline gap-2 pb-1.5">
								<span className="text-[11px] leading-[15px] text-muted">模型</span>
								<span className="ml-auto text-[10.5px] text-faint">0 个</span>
							</div>
							<div className="flex flex-1 flex-col items-center justify-center rounded-[6px] border border-dashed border-white/[0.14] px-4 py-8 text-center">
								<span className="icon-[lucide--list-plus] size-[18px] text-faint" />
								<p className="pt-2 text-[12px] leading-[17px]">还没有模型</p>
								<p className="pt-1 text-[11px] leading-[15px] text-faint">
									拉取成功后写入清单；也可以手动加一个 model id
								</p>
							</div>
							<div className="flex items-center gap-2 pt-2">
								<Input placeholder="添加 model id" mono dim />
								<span className="flex size-[30px] shrink-0 items-center justify-center rounded-[6px] border border-border text-faint">
									<span className="icon-[lucide--plus] size-[14px]" />
								</span>
							</div>
							<div className="flex items-center gap-2 pt-2">
								<Btn>
									<span className="icon-[lucide--list-plus] size-[12px]" />
									拉取模型
								</Btn>
								<span className="truncate text-[10.5px] leading-[14px] text-faint">
									只取 id 与能力元数据
								</span>
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
