import type { Variant } from "./variant";

const body = "text-[13.5px] text-ink leading-[1.8]";

const rows = [
	["网络频段", "无 5G 毫米波，缺 14/29/71/53 等北美专用频段；Wi-Fi 7 不支持 6GHz"],
	["插卡", "双实体 nano-SIM，今年也支持 eSIM"],
	["卫星通信", "暂不支持，等后续开通"],
	["无线充电", "MagSafe/Qi2 封顶 15W"],
	["AI", "用已过审的大陆 AI 供应商服务"],
	["FaceTime", "不支持音频通话"],
	["保修", "全国联保"],
];

/** 会话栏顶带：页签（message-circle 202×26）· 添加协作者 · 右侧 EnsoCode / main。 */
export function ChatBand({
	variant,
	windowActions,
}: {
	variant: Variant;
	/** 没有标题栏的版本：把窗口右上角那三个显示控制挂到这条带上 */
	windowActions?: boolean;
}) {
	const unified = variant === "unified";
	return (
		<div className={`flex items-center gap-1 px-3 ${unified ? "h-10" : "h-[35px]"}`}>
			<div className="flex h-[26px] items-center gap-1.5 rounded-control bg-paper px-2 shadow-[inset_0_0_0_1px_var(--color-line)]">
				<span className="icon-[lucide--message-circle] size-3.5 text-muted" />
				<span className="max-w-[180px] truncate text-[12.5px]">打开deepseek 搜搜 rpc 什么意思</span>
				<span className="icon-[lucide--x] size-3 text-subtle" />
			</div>
			<span className="flex size-6 items-center justify-center rounded-control text-subtle">
				<span className="icon-[lucide--plus] size-4" />
			</span>
			<span className="flex-1" />
			{windowActions && (
				<>
					<span className="flex size-6 items-center justify-center text-muted">
						<span className="icon-[lucide--unfold-horizontal] size-[15px]" />
					</span>
					<span className="flex size-6 items-center justify-center text-muted">
						<span className="icon-[lucide--smartphone] size-[15px]" />
					</span>
					<span className="flex size-6 items-center justify-center text-muted">
						<span className="icon-[lucide--panel-right] size-[15px]" />
					</span>
				</>
			)}
		</div>
	);
}

export function ChatBody() {
	return (
		<div className="min-h-0 flex-1 overflow-hidden px-6 pt-4">
			<div className="mx-auto w-full max-w-[525px]">
				<table className="w-full border-collapse text-[13.5px]">
					<tbody>
						<tr className="border-b border-line">
							<th className="w-[86px] py-2.5 text-left font-semibold">维度</th>
							<th className="py-2.5 text-left font-semibold">国行</th>
						</tr>
						{rows.map(([key, value]) => (
							<tr key={key} className="border-b border-line align-top">
								<td className="py-2.5 pr-4 font-semibold whitespace-nowrap">{key}</td>
								<td className="py-2.5 leading-[1.6]">{value}</td>
							</tr>
						))}
					</tbody>
				</table>
				<p className={`${body} mt-4`}>社区里的其他高频议题（搜索结果清一色是这些）：</p>
				<ul className={`${body} mt-2 space-y-1.5`}>
					<li className="flex gap-2">
						<span className="text-subtle">·</span>
						<span>美版为什么只卖国行半价（¥7258 的商品卡就在结果里）</span>
					</li>
					<li className="flex gap-2">
						<span className="text-subtle">·</span>
						<span>卡贴机 / 改卡槽能不能买（《卡贴机18p到底能不能买？！》《美版苹果18改卡槽》）</span>
					</li>
					<li className="flex gap-2">
						<span className="text-subtle">·</span>
						<span>如何判断有无拆修、无锁 vs 有锁</span>
					</li>
				</ul>
			</div>
		</div>
	);
}

/** 输入框：112 高、工具栏 28 高，顺序按真实 GUI：图片 · 全局 · main · 计划 · 完全放行 ·｜模型 · 思考档 · 发送。 */
export function ChatComposer() {
	return (
		<div className="shrink-0 px-6 pb-2">
			<div className="mx-auto w-full">
				<div className="flex h-[112px] flex-col rounded-field bg-paper shadow-[inset_0_0_0_1px_var(--color-line),0_1px_2px_rgb(0_0_0/4%),0_10px_24px_-10px_rgb(0_0_0/14%)]">
					<div className="px-3 pt-3 text-[13px] text-subtle">输入 @ 选择文件或 Agent</div>
					<div className="flex-1" />
					<div className="flex items-center gap-1.5 px-2 pb-2 text-muted">
						<span className="flex size-7 items-center justify-center">
							<span className="icon-[lucide--image-plus] size-4" />
						</span>
						<span className="flex size-7 items-center justify-center">
							<span className="icon-[lucide--layers] size-4" />
						</span>
						<span className="flex h-7 items-center gap-1 rounded-control px-1.5 text-[11.5px] text-ink">
							<span className="icon-[lucide--git-branch] size-3.5 text-muted" />
							main
							<span className="icon-[lucide--chevron-down] size-3 text-subtle" />
						</span>
						<span className="flex h-7 items-center gap-1 rounded-control px-1.5 text-[11.5px] text-ink">
							<span className="icon-[lucide--clipboard-list] size-3.5 text-muted" />
							计划
						</span>
						<span className="flex size-7 items-center justify-center">
							<span className="icon-[lucide--shield-off] size-4" />
						</span>
						<span className="flex-1" />
						<span className="flex h-7 items-center gap-1 rounded-control px-1.5 text-[11.5px]">
							<span className="icon-[lucide--sparkle] size-3.5 text-muted" />
							DeepSeek V4.1 Flash
							<span className="text-subtle">·</span>
							<span className="icon-[lucide--brain] size-3.5 text-muted" />
							高
							<span className="icon-[lucide--chevron-down] size-3 text-subtle" />
						</span>
						<span className="flex size-8 items-center justify-center rounded-[6px] bg-track text-subtle">
							<span className="icon-[lucide--arrow-up] size-4" />
						</span>
					</div>
				</div>
			</div>
		</div>
	);
}

/** 状态条：左 EnsoCode，右 币(↑↓) · 库(97%) · 6% 环 · 设置。 */
export function ChatStatus({ variant }: { variant: Variant }) {
	return (
		<div
			className={`flex h-[26px] shrink-0 items-center gap-2 border-t border-line px-3 text-[11px] text-subtle ${
				variant === "unified"
					? "[border-image:linear-gradient(to_right,transparent,var(--color-line)_12px,var(--color-line)_calc(100%-12px),transparent)_1]"
					: ""
			}`}
		>
			<span className="icon-[lucide--folder] size-3.5" />
			<span>EnsoCode</span>
			<span className="flex-1" />
			<span className="flex items-center gap-1">
				<span className="icon-[lucide--coins] size-3.5" />
				<span className="font-mono">↑828K ↓6K</span>
			</span>
			<span className="flex items-center gap-1">
				<span className="icon-[lucide--database] size-3.5" />
				<span className="font-mono">97%</span>
			</span>
			<span className="flex items-center gap-1 font-mono">
				<span className="size-2 rounded-full border-[1.5px] border-ink/25" />
				6%
			</span>
			<span className="icon-[lucide--settings-2] size-3.5" />
		</div>
	);
}

/** 现状：会话栏自带 35px 顶带与状态条，右面板另起一条 39px 带。 */
export function ChatPane({ variant }: { variant: Variant }) {
	return (
		<section className="flex min-w-0 flex-1 flex-col bg-paper">
			<div className="shrink-0 border-b border-line">
				<ChatBand variant={variant} />
			</div>
			<ChatBody />
			<ChatComposer />
			<ChatStatus variant={variant} />
		</section>
	);
}
