import type { Variant } from "./variant";

/** 面板顶带：三个页签各自带关闭 ×，右侧 展开 + 新建标签页。 */
export function PanelBand({ variant }: { variant: Variant }) {
	const unified = variant === "unified";
	return (
		<div className={`flex items-center px-3 ${unified ? "h-10" : "h-[39px]"}`}>
			{["浏览器", "浏览器"].map((label, index) => (
				<span
					key={`${label}-${index}`}
					className="flex h-7 items-center gap-1.5 px-2 text-[12.5px] text-muted"
				>
					<span className="icon-[lucide--globe] size-4" />
					{label}
					<span className="icon-[lucide--x] size-3 text-subtle" />
				</span>
			))}
			<span className="flex h-7 items-center gap-1.5 rounded-control bg-paper px-2 text-[12.5px] shadow-[inset_0_0_0_1px_var(--color-line)]">
				<span className="icon-[lucide--smartphone] size-4 text-muted" />
				移动设备
				<span className="icon-[lucide--x] size-3 text-subtle" />
			</span>
			<span className="flex-1" />
			<span className="icon-[lucide--maximize-2] size-[15px] text-muted" />
			<span className="icon-[lucide--plus] size-[15px] text-muted" />
		</div>
	);
}

function DeviceRow({
	title,
	status,
	action,
	running,
	unified,
}: {
	title: string;
	status: string;
	action: string;
	running: boolean;
	unified: boolean;
}) {
	return (
		<div
			className={`flex items-center gap-3 px-3 py-2 shadow-[inset_0_0_0_1px_var(--color-line)] ${
				unified ? "rounded-block" : "rounded-field"
			}`}
		>
			<div className="min-w-0 flex-1">
				<div className="truncate text-[12px]">{title}</div>
				<div className="mt-0.5 truncate text-[11px] text-subtle">模拟器</div>
			</div>
			<span className={`shrink-0 text-[11px] ${running ? "text-success" : "text-subtle"}`}>
				{status}
			</span>
			<button
				type="button"
				className="h-6 shrink-0 rounded-control px-2 text-[11px] shadow-[inset_0_0_0_1px_var(--color-line)]"
			>
				{action}
			</button>
		</div>
	);
}

export function PanelBody({ variant }: { variant: Variant }) {
	const unified = variant === "unified";
	return (
		<div className="flex min-h-0 flex-1 flex-col overflow-hidden">
			<div className="flex shrink-0 items-center gap-2 px-3 pt-2 pb-1">
				<span className="icon-[lucide--smartphone] size-3.5 text-muted" />
				<span className="text-[12px]">移动设备</span>
				<span className="flex-1" />
				<span className="icon-[lucide--refresh-cw] size-4 text-muted" />
			</div>
			<div className="min-h-0 flex-1 overflow-hidden px-3">
				<div className="mb-1 text-[11px] text-subtle">Android · 2</div>
				<div className="flex flex-col gap-2">
					<DeviceRow title="Pixel 10 Pro" status="运行中" action="停止" running unified={unified} />
					<DeviceRow
						title="Eaves Members Test"
						status="已停止"
						action="开始"
						running={false}
						unified={unified}
					/>
				</div>
				<div className="mt-3 flex items-center gap-2 text-[11px] text-subtle">
					<span className="icon-[lucide--settings-2] size-3.5" />
					<span>环境待配置</span>
					<span className="flex-1" />
					<span className="font-mono">3/7</span>
					<span className="icon-[lucide--chevron-down] size-3.5" />
				</div>
			</div>
		</div>
	);
}

/** 现状：右面板自带一条 39px 顶带 + 整条左边线，和会话栏并列成两张纸。 */
export function DevicePanel({ variant }: { variant: Variant }) {
	return (
		<aside className="flex w-[401px] shrink-0 flex-col border-l border-line bg-paper">
			<div className="shrink-0 border-b border-line">
				<PanelBand variant={variant} />
			</div>
			<PanelBody variant={variant} />
		</aside>
	);
}
