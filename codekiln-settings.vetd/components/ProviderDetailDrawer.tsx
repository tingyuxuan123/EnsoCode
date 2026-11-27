import type { ReactNode } from "react";
import { Badge, Btn, Switch } from "./Controls";
import { BrandMark } from "./BrandMark";
import type { QuotaWindow } from "./data";
import { apiKeyDetail, presetDetail, subscriptionAccounts } from "./data";

function SectionLabel({ children, right }: { children: string; right?: string }) {
	return (
		<div className="flex items-baseline px-5 pb-1 pt-4 text-[11px] leading-[15px] text-faint">
			<span>{children}</span>
			{right ? <span className="ml-auto">{right}</span> : null}
		</div>
	);
}

function DrawerRow({
	label,
	value,
	mono,
	action,
	children,
}: {
	label: string;
	value?: string;
	mono?: boolean;
	action?: string;
	children?: ReactNode;
}) {
	return (
		<div className="flex items-center gap-3 border-b border-white/[0.05] px-5 py-[10px]">
			<span className="w-[62px] shrink-0 text-[12px] leading-[16px] text-muted">{label}</span>
			{children ?? (
				<>
					<span
						className={`min-w-0 flex-1 truncate text-[12px] leading-[16px] ${mono ? "font-mono text-[11.5px]" : ""}`}
					>
						{value}
					</span>
					{action ? <span className="shrink-0 text-[11.5px] text-muted">{action}</span> : null}
				</>
			)}
		</div>
	);
}

/** 额度条：真实窗口名与百分比，两端有标签。池条目不显示单账号额度。 */
function Quota({ window }: { window: QuotaWindow }) {
	return (
		<div className="px-5 py-[9px]">
			<div className="flex items-baseline gap-2">
				<span className="text-[12px] leading-[17px]">{window.label}</span>
				<span className="ml-auto text-[11px] tabular-nums text-muted">已用 {window.used}%</span>
				<span className="text-[11px] text-faint">{window.reset}</span>
			</div>
			<div className="mt-1.5 h-[3px] w-full rounded-full bg-white/[0.08]">
				<div className="h-[3px] rounded-full bg-brand" style={{ width: `${window.used}%` }} />
			</div>
		</div>
	);
}

function Drawer({
	mark,
	title,
	badge,
	note,
	children,
}: {
	mark: "magpie" | "openai" | "openrouter";
	title: string;
	badge: string;
	note: string;
	children: ReactNode;
}) {
	return (
		<>
			<div className="absolute inset-0 bg-black/45" />
			<aside className="absolute inset-y-0 right-0 flex w-[468px] flex-col border-l border-white/[0.08] bg-raised">
				<div className="flex items-start gap-3 px-5 pb-4 pt-5">
					<BrandMark brand={mark} />
					<div className="min-w-0 flex-1">
						<div className="flex items-baseline gap-2">
							<h2 className="truncate text-[15px] font-semibold leading-[20px]">{title}</h2>
							<Badge>{badge}</Badge>
						</div>
						<p className="pt-0.5 text-[11.5px] leading-[16px] text-faint">{note}</p>
					</div>
					<div className="flex shrink-0 items-center gap-2">
						<Btn>编辑</Btn>
						<span className="icon-[lucide--x] size-[15px] text-faint" />
					</div>
				</div>
				<div className="min-h-0 flex-1 overflow-hidden pb-5">{children}</div>
			</aside>
		</>
	);
}

/**
 * 服务商详情抽屉。三种形态共用一个壳，和代码里的三条入口一一对应：
 * - key：API Key 型（地址 / 密钥 / 类型 / 来源 / 模型清单 / 删除）
 * - subscription：订阅型（账号 / 额度窗口 / 模型 / 账号池 / 退登失败）
 * - preset：预设型（本机地址与端口 / 快照语义 / 移除本机配置）
 */
export function ProviderDetailDrawer({ variant }: { variant: "key" | "subscription" | "preset" }) {
	if (variant === "preset") {
		return (
			<Drawer
				mark="magpie"
				title={presetDetail.name}
				badge="预设"
				note={`${presetDetail.models} 个模型 · 已启用 · 本机代理`}
			>
				<SectionLabel>连接</SectionLabel>
				<div className="border-t border-white/[0.05]">
					<DrawerRow label="地址" value={presetDetail.baseUrl} mono action="修改端口" />
					<DrawerRow label="密钥" value="由应用内置，无需填写" />
				</div>
				<div className="px-5 pt-2 text-[11px] leading-[16px] text-faint">
					{presetDetail.catalogNote}。改端口会先用新地址拉一次模型，拉不通就保留原地址。
				</div>

				<SectionLabel right={`最后刷新 ${apiKeyDetail.lastRefresh}`}>模型</SectionLabel>
				<div className="border-t border-white/[0.05]">
					<DrawerRow label="清单">
						<span className="min-w-0 flex-1 text-[12.5px]">{presetDetail.models} 个模型可用</span>
						<Btn>刷新模型</Btn>
					</DrawerRow>
				</div>
				<div className="px-5 pt-2 text-[11px] leading-[16px] text-faint">
					{presetDetail.snapshotNote}。
				</div>

				<SectionLabel>危险操作</SectionLabel>
				<div className="border-t border-white/[0.05]">
					<DrawerRow label="移除">
						<span className="min-w-0 flex-1 text-[12.5px] text-destructive">移除本条预设</span>
						<Btn tone="danger">移除</Btn>
					</DrawerRow>
				</div>
				<p className="px-5 pt-2 text-[11px] leading-[16px] text-faint">
					只移除应用里的这条配置，不动 Magpie 自身；需要时再点一次「启用」。
				</p>
			</Drawer>
		);
	}

	if (variant === "subscription") {
		const account = subscriptionAccounts[0];
		return (
			<Drawer
				mark="openai"
				title={account.email}
				badge="订阅"
				note={`${account.plan} · 4 个模型 · OAuth 账号`}
			>
				<SectionLabel>账号</SectionLabel>
				<div className="border-t border-white/[0.05]">
					<DrawerRow label="邮箱">
						<span className="min-w-0 flex-1 truncate text-[12.5px]">{account.email}</span>
						<Badge>{account.plan}</Badge>
					</DrawerRow>
					<DrawerRow label="登录">
						<span className="min-w-0 flex-1 truncate text-[12px]">已登录 · 凭证在本机</span>
						<Btn>登出</Btn>
					</DrawerRow>
				</div>

				<SectionLabel right="每 5 小时 / 每周">额度</SectionLabel>
				<div className="border-t border-white/[0.05]">
					{account.quota.map((window, index) => (
						<div key={window.label} className={index === 0 ? "" : "border-t border-white/[0.05]"}>
							<Quota window={window} />
						</div>
					))}
				</div>

				<SectionLabel right={`最后刷新 ${apiKeyDetail.lastRefresh}`}>模型</SectionLabel>
				<div className="border-t border-white/[0.05]">
					<DrawerRow label="清单">
						<span className="min-w-0 flex-1 text-[12.5px]">4 个模型可用</span>
						<Btn>刷新模型</Btn>
					</DrawerRow>
					<DrawerRow label="覆盖">
						<span className="min-w-0 flex-1 truncate text-[11px] leading-[15px] text-faint">
							订阅条目的模型来自统一目录，只能逐个停用，不能改写能力
						</span>
					</DrawerRow>
				</div>

				<SectionLabel>账号池</SectionLabel>
				<div className="border-t border-white/[0.05]">
					<div className="flex items-center gap-3 border-b border-white/[0.05] px-5 py-[10px]">
						<div className="min-w-0 flex-1">
							<div className="text-[12.5px] leading-[17px]">还有 2 个账号没合并</div>
							<div className="text-[11px] leading-[15px] text-faint">
								合并成池后按顺序轮换；池条目不显示单个账号的额度
							</div>
						</div>
						<Btn>创建账号池</Btn>
					</div>
				</div>

				<SectionLabel>危险操作</SectionLabel>
				<div className="border-t border-white/[0.05]">
					<DrawerRow label="删除">
						<span className="min-w-0 flex-1 text-[12.5px] text-destructive">删除并退登该账号</span>
						<Btn tone="danger">删除</Btn>
					</DrawerRow>
					<div className="flex items-start gap-2 border-b border-white/[0.05] px-5 py-[10px]">
						<span className="icon-[lucide--triangle-alert] size-[13px] shrink-0 text-destructive" />
						<div className="min-w-0 flex-1">
							<div className="text-[11.5px] leading-[16px] text-destructive">
								退登失败：无法连接 accounts.openai.com
							</div>
							<div className="text-[11px] leading-[15px] text-faint">
								条目已保留。凭证还在磁盘上，退登成功才会真的删除
							</div>
						</div>
						<div className="flex shrink-0 items-center gap-2">
							<Btn>重试</Btn>
							<span className="text-[11.5px] text-destructive">仍要删除</span>
						</div>
					</div>
				</div>
				<p className="px-5 pt-2 text-[11px] leading-[16px] text-faint">
					删除会先退登这个账号；同厂商的其他账号不受影响。
				</p>
			</Drawer>
		);
	}

	return (
		<Drawer
			mark="openrouter"
			title={apiKeyDetail.name}
			badge="API Key"
			note={`${apiKeyDetail.models} 个模型 · 已启用 · 从 ${apiKeyDetail.importedFrom} 导入`}
		>
			<SectionLabel>连接</SectionLabel>
			<div className="border-t border-white/[0.05]">
				<DrawerRow label="地址" value={apiKeyDetail.baseUrl} mono action="修改" />
				<DrawerRow label="密钥" value={apiKeyDetail.key} mono action="更换" />
				<DrawerRow label="API 类型" value={apiKeyDetail.apiKind} mono />
				<DrawerRow label="来源" value={apiKeyDetail.importedFrom} />
				<DrawerRow label="启用">
					<span className="min-w-0 flex-1 truncate text-[11px] leading-[15px] text-faint">
						停用后连同模型一起从选择器消失，配置保留
					</span>
					<Switch on />
				</DrawerRow>
			</div>

			<SectionLabel right={`最后刷新 ${apiKeyDetail.lastRefresh}`}>模型</SectionLabel>
			<div className="border-t border-white/[0.05]">
				<DrawerRow label="清单">
					<span className="min-w-0 flex-1 text-[12.5px]">
						{apiKeyDetail.enabledModels}/{apiKeyDetail.models} 个已启用
					</span>
					<Btn>刷新模型</Btn>
				</DrawerRow>
				<DrawerRow label="查看">
					<span className="min-w-0 flex-1 truncate text-[11.5px] text-muted">
						逐个模型：启停、推理、上下文与最大 token
					</span>
					<span className="icon-[lucide--chevron-right] size-[13px] shrink-0 text-faint" />
				</DrawerRow>
				<div className="flex items-start gap-2 border-b border-white/[0.05] px-5 py-[10px]">
					<span className="icon-[lucide--triangle-alert] size-[13px] shrink-0 text-warning" />
					<div className="min-w-0 flex-1">
						<div className="text-[11.5px] leading-[16px] text-warning">
							1 个模型未返回：{apiKeyDetail.failedModel.error}
						</div>
						<div className="text-[11px] leading-[15px] text-faint">
							{apiKeyDetail.failedModel.id} 沿用它上一次的清单；重新刷新会再试一次
						</div>
					</div>
				</div>
			</div>

			<SectionLabel>危险操作</SectionLabel>
			<div className="border-t border-white/[0.05]">
				<DrawerRow label="删除">
					<span className="min-w-0 flex-1 text-[12.5px] text-destructive">删除服务商</span>
					<Btn tone="danger">删除</Btn>
				</DrawerRow>
			</div>
			<p className="px-5 pt-2 text-[11px] leading-[16px] text-faint">
				只移除本机配置，不改动上游账号；密钥不会留在磁盘上。
			</p>
		</Drawer>
	);
}
