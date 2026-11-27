import { Link } from "react-router";
import { BrandMark } from "./BrandMark";
import { ProviderList } from "./ProviderList";
import { RouteTable } from "./RouteTable";
import { SectionCard } from "./SectionCard";
import {
	enabledProviderCount,
	foldedProviderCount,
	modelCount,
	providerTotal,
	providersRefreshing,
	subagentModels,
	virtualModels,
	visibleProviders,
} from "./data";

/**
 * 模型中心页正文（不含侧栏）。三种状态共用同一份骨架：
 * - default：正常
 * - refreshing：全局刷新刚结束，逐行写结果
 * - empty：还没有服务商（路由卡不出现，先让人连上一个）
 *
 * 子代理候选模型不在这一页：它们在「子代理类型」里维护，这里只留一条去路。
 */
export function ModelCenter({
	variant = "default",
	failedProviderId,
}: {
	variant?: "default" | "refreshing" | "empty";
	/** 退登失败的行：删除确认场景里，错误条贴在它下面 */
	failedProviderId?: string;
}) {
	const refreshing = variant === "refreshing";
	const empty = variant === "empty";

	return (
		<div className="px-9 pb-6 font-sans">
			<div className="w-full">
				<div className="flex items-end gap-4 pt-7">
					<div className="min-w-0">
						<h1 className="font-display text-[20px] font-semibold leading-[26px] tracking-tight">
							模型中心
						</h1>
						<p className="pt-1 text-[11.5px] leading-[16px] text-muted">
							{empty
								? "还没有服务商 —— 先启用 Magpie，或从本机导入一个"
								: `${enabledProviderCount} 个服务商 · ${modelCount} 个可用模型 · 改动对下一个会话生效`}
						</p>
					</div>
					<div className="ml-auto flex shrink-0 items-center gap-3">
						<span className="rounded-[6px] bg-foreground px-[11px] py-[5px] text-[12px] font-medium text-surface">
							添加模型或服务商
						</span>
					</div>
				</div>

				{refreshing ? (
					<div className="flex items-center gap-2 pt-4 text-[11.5px] leading-[16px] text-muted">
						<span className="text-warning">模型刷新：6 成功，1 失败</span>
						<span className="ml-auto text-faint">
							失败的那一条不会影响其余服务商，重新刷新会再试一次
						</span>
					</div>
				) : null}

				<div className="space-y-4 pt-5">
					{empty ? null : (
						<SectionCard title="模型路由" note="新会话按这里的三档取模型" action="编辑路由">
							<RouteTable />
							<div className="flex items-center gap-2 border-t border-white/[0.05] px-5 py-[8px] text-[11.5px] text-faint">
								<span className="truncate">
									6 档推理 · 跟随上一次选择：关 · 虚拟模型 {virtualModels.length} 个
								</span>
								<span className="icon-[lucide--chevron-right] ml-auto size-[13px] shrink-0" />
							</div>
							<Link
								to="/agent-types"
								className="flex items-center gap-2 border-t border-white/[0.05] px-5 py-[8px] text-[11.5px] text-muted hover:text-foreground"
							>
								<span className="icon-[lucide--bot] size-[13px] shrink-0 text-faint" />
								<span className="truncate">
									子代理候选模型 {subagentModels.length} 个，在「子代理类型」里维护
								</span>
								<span className="ml-auto text-faint">去配置</span>
								<span className="icon-[lucide--chevron-right] size-[13px] shrink-0 text-faint" />
							</Link>
						</SectionCard>
					)}

					<SectionCard
						title="服务商"
						note={
							empty
								? "共 0 个 · 三种接入方式任选"
								: `共 ${providerTotal} 个 · ${enabledProviderCount} 个已启用`
						}
						action={
							empty ? (
								<span>从本机导入</span>
							) : (
								<>
									<span>从本机导入</span>
									<span>拉取全部模型</span>
								</>
							)
						}
					>
						{empty ? (
							<div className="border-t border-white/[0.05] px-5 py-4">
								<div className="rounded-[6px] border border-dashed border-white/[0.12] px-1 py-1">
									{[
										{
											mark: "magpie" as const,
											name: "启用 Magpie 预设",
											note: "127.0.0.1:3425 · 13 个模型 · 不用填 Key",
											action: "启用",
										},
										{
											mark: null,
											name: "从本机应用导入",
											note: "沿用 Claude Code / Cherry Studio / EnsoAI 里已有的配置",
											action: "导入",
										},
										{
											mark: null,
											name: "手动添加服务商",
											note: "18 个厂商，需要 API Key 或订阅登录",
											action: "添加",
										},
									].map((item, index) => (
										<div
											key={item.name}
											className={`flex items-center gap-3 px-[14px] py-[11px] ${index === 0 ? "" : "border-t border-white/[0.06]"}`}
										>
											<span className="flex size-[24px] shrink-0 items-center justify-center rounded-[5px] bg-white/[0.06]">
												{item.mark ? (
													<BrandMark brand={item.mark} />
												) : (
													<span
														className={`${index === 1 ? "icon-[lucide--hard-drive-download]" : "icon-[lucide--plus]"} size-[14px] text-muted`}
													/>
												)}
											</span>
											<div className="min-w-0 flex-1">
												<div className="text-[12.5px] leading-[17px]">{item.name}</div>
												<div className="text-[11px] leading-[15px] text-faint">{item.note}</div>
											</div>
											<span className="rounded-[6px] border border-border px-[10px] py-[3px] text-[11.5px] text-muted">
												{item.action}
											</span>
										</div>
									))}
								</div>
							</div>
						) : (
							<ProviderList
								items={refreshing ? providersRefreshing : visibleProviders}
								folded={refreshing ? 0 : foldedProviderCount}
								total={providerTotal}
								failedProviderId={failedProviderId}
							/>
						)}
					</SectionCard>

					{empty ? (
						<div className="px-1">
							<div className="pb-1.5 text-[11px] leading-[15px] text-faint">接入之后</div>
							<ul className="space-y-1 text-[11.5px] leading-[17px] text-muted">
								<li>· 拉取该服务商的模型清单，作为一条普通服务商加入列表</li>
								<li>· 模型出现在选择器里，默认对话会自动指向第一个可用模型</li>
								<li>
									· 这里出现默认对话 / 标题与摘要 /
									代审三档路由；子代理候选模型在「子代理类型」里配置
								</li>
							</ul>
						</div>
					) : null}
				</div>
			</div>
		</div>
	);
}
