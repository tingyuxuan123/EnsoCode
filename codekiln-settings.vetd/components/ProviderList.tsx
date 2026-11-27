import * as React from "react";
import { BrandMark } from "./BrandMark";
import { Badge, Btn, Switch } from "./Controls";
import type { Provider } from "./data";
import { groupProviderRows, providers } from "./data";

const fetchTone: Record<string, string> = {
	pending: "text-faint",
	done: "text-faint",
	error: "text-warning",
};

const fetchIcon: Record<string, string> = {
	pending: "icon-[lucide--minus]",
	done: "icon-[lucide--check]",
	error: "icon-[lucide--triangle-alert]",
};

/** 行内额度：窗口短名 + 百分比 + 一条细线，固定宽度保证多行对齐。 */
function QuotaPill({ short, used, label }: { short: string; used: number; label: string }) {
	return (
		<span className="flex w-[72px] shrink-0 items-center justify-end gap-1.5" title={label}>
			<span className="text-[10.5px] tabular-nums leading-[14px] text-faint">
				{short} {used}%
			</span>
			<span className="h-[3px] w-[26px] overflow-hidden rounded-full bg-white/[0.09]">
				<span className="block h-[3px] rounded-full bg-brand/80" style={{ width: `${used}%` }} />
			</span>
		</span>
	);
}

/**
 * 服务商行：品牌标 + 名称 + 徽章 + 一行明细，右侧模型数、额度、开关。
 * 同厂商有多条（多账号 / 多 Key）才出现分组标题，单条交给品牌标识别。
 */
export function ProviderList({
	items = providers,
	folded = 0,
	total = providers.length,
	failedProviderId,
}: {
	items?: Provider[];
	folded?: number;
	total?: number;
	/** 退登失败的行：条目保留，错误条贴在行下方（与代码一致） */
	failedProviderId?: string;
}) {
	const groups = groupProviderRows(items);

	return (
		<div>
			{groups.map((group) => (
				<div key={group.vendorId}>
					{group.items.length > 1 ? (
						<div className="flex items-center gap-1.5 px-5 pb-1 pt-2 text-[11px] leading-none text-faint">
							<span>{group.label}</span>
							<span className="text-faint/70">{group.items.length}</span>
						</div>
					) : null}
					{group.items.map((provider) => {
						const off = provider.state === "off";
						return (
							<React.Fragment key={provider.id}>
								<div className="flex items-center gap-3 border-t border-white/[0.05] px-5 py-[8px] hover:bg-white/[0.02]">
									<BrandMark brand={provider.brand} />
									<div className="flex min-w-0 flex-1 items-center gap-2">
										<span
											className={`shrink-0 text-[12.5px] font-medium leading-[17px] ${off ? "text-muted line-through" : ""}`}
										>
											{provider.name}
										</span>
										{provider.preset ? <Badge>预设</Badge> : null}
										{provider.tag ? <Badge>{provider.tag}</Badge> : null}
										{provider.importedFrom ? (
											<Badge tone="muted">{provider.importedFrom}</Badge>
										) : null}
										{provider.classifier ? <Badge tone="muted">仅分类器</Badge> : null}
										<span className="min-w-0 truncate text-[11px] leading-[15px] text-faint">
											{provider.detail}
										</span>
										{provider.state === "warn" && !provider.fetch ? (
											<span className="shrink-0 text-[11px] leading-[15px] text-warning">
												1 个模型刷新失败
											</span>
										) : null}
										{provider.fetch ? (
											<span
												className={`flex shrink-0 items-center gap-1 text-[11px] leading-[15px] ${fetchTone[provider.fetch.kind]}`}
											>
												<span
													className={`${fetchIcon[provider.fetch.kind]} size-[11px] shrink-0`}
												/>
												{provider.fetch.text}
											</span>
										) : null}
									</div>
									{provider.quota ? (
										<QuotaPill
											short={provider.quota[0].short}
											used={provider.quota[0].used}
											label={provider.quota[0].label}
										/>
									) : (
										<span className="w-[72px] shrink-0" />
									)}
									<span className="w-[54px] shrink-0 text-right text-[11px] tabular-nums text-faint">
										{provider.models} 模型
									</span>
									<Switch on={!off} />
									<span className="icon-[lucide--pencil] size-[13px] shrink-0 text-faint/70" />
								</div>
								{provider.id === failedProviderId ? (
									<div className="mx-5 mb-2 flex items-center justify-between gap-3 rounded-[6px] border border-destructive/30 bg-destructive/5 px-3 py-1.5 text-[11.5px] leading-[16px] text-destructive">
										<span className="min-w-0 truncate">退登失败：无法连接 accounts.openai.com</span>
										<span className="flex shrink-0 items-center gap-2">
											<Btn>重试</Btn>
											<span>仍要删除</span>
										</span>
									</div>
								) : null}
							</React.Fragment>
						);
					})}
				</div>
			))}
			{folded > 0 ? (
				<div className="flex items-center gap-1.5 border-t border-white/[0.05] px-5 py-[8px] text-[11.5px] text-muted">
					<span>查看全部 {total} 个服务商</span>
					<span className="icon-[lucide--chevron-right] size-[13px] text-faint" />
					<span className="ml-auto text-[11px] text-faint">含已停用与仅分类器</span>
				</div>
			) : null}
		</div>
	);
}
