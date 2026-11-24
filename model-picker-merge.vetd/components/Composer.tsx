/**
 * 输入条：与线上一致的两段式——上面是输入区，下面是工具行；工具行右侧是模型胶囊与发送。
 * 工具行从左到右：新会话 · 预设（全局 + 锁）· 分支 · 计划 · 审批档位；放不下时按这个顺序收成图标。
 * 输入条下面还有一条状态栏（目录 / token / 速度 / 上下文 / 缓存 / 设置），它属于同一次输入行为。
 *
 * `open` 是这个设计想补的一处状态：模型胶囊被点开时，它自己要有"我展开了"的样子，
 * 否则浮层和触发它的那个胶囊之间没有任何视觉联系。
 */
export function Composer({
	model,
	level,
	open = false,
	reasoning = true,
}: {
	model: string;
	level: string;
	open?: boolean;
	reasoning?: boolean;
}) {
	return (
		<div className="w-full">
			<div className="rounded-[12px] bg-sunken ring-1 ring-inset ring-white/[0.075]">
				<div className="flex h-[46px] items-center px-4">
					<span className="truncate text-[13px] text-faint">输入 @ 选择文件或 Agent</span>
				</div>
				<div className="flex h-[40px] items-center gap-0.5 px-2">
					<Tool icon="icon-[lucide--square-pen]" label="新会话" iconOnly />
					<Tool icon="icon-[lucide--layers]" label="全局">
						<span className="icon-[lucide--lock] size-3 text-faint" aria-hidden />
					</Tool>
					<Tool icon="icon-[lucide--git-branch]" label="main" chevron />
					<Tool icon="icon-[lucide--clipboard-list]" label="计划" />
					<Tool icon="icon-[lucide--shield-off]" label="完全放行" chevron />

					<div className="ml-auto flex items-center gap-1.5">
						<span
							className={`flex h-[28px] min-w-0 items-center gap-1.5 rounded-[6px] pl-2 pr-1 ${
								open ? "bg-white/[0.11] ring-1 ring-inset ring-white/[0.14]" : "bg-white/[0.04]"
							}`}
						>
							<span className="icon-[lucide--sparkles] size-3.5 shrink-0 text-brand" aria-hidden />
							<span className="max-w-[190px] truncate text-[12px] text-ink">{model}</span>
							{reasoning && (
								<span className="flex h-[17px] shrink-0 items-center gap-[3px] rounded-[4px] bg-brand/[0.14] px-1">
									<span className="icon-[lucide--brain] size-[11px] text-brand" aria-hidden />
									<span className="text-[10.5px] font-medium text-brand">{level}</span>
								</span>
							)}
							<span
								className={`icon-[lucide--chevron-down] size-3 shrink-0 transition-transform ${
									open ? "-rotate-180 text-muted" : "text-faint"
								}`}
								aria-hidden
							/>
						</span>
						<span className="flex size-[26px] items-center justify-center rounded-[7px] bg-brand">
							<span className="icon-[lucide--arrow-up] size-3.5 text-white" aria-hidden />
						</span>
					</div>
				</div>
			</div>
			<StatusStrip />
		</div>
	);
}

function Tool({
	icon,
	label,
	children,
	chevron,
	iconOnly,
}: {
	icon: string;
	label: string;
	children?: React.ReactNode;
	chevron?: boolean;
	iconOnly?: boolean;
}) {
	return (
		<span className="flex h-[26px] items-center gap-1 rounded-[6px] px-1.5 text-[11.5px] text-muted">
			<span className={`${icon} size-3.5 shrink-0`} aria-hidden />
			{!iconOnly && <span className="whitespace-nowrap">{label}</span>}
			{children}
			{chevron && <span className="icon-[lucide--chevron-down] size-3 shrink-0 text-faint" aria-hidden />}
		</span>
	);
}

/** 输入条下的状态栏：左边是工作目录，右边一串读数，末位是状态栏自身的设置入口。 */
export function StatusStrip() {
	return (
		<div className="mt-1.5 flex h-[22px] items-center gap-3 px-1 text-[11px] text-faint">
			<span className="flex min-w-0 items-center gap-1">
				<span className="icon-[lucide--folder] size-3 shrink-0" aria-hidden />
				<span className="truncate">EnsoCode</span>
				<span className="icon-[lucide--chevron-up] size-2.5 shrink-0" aria-hidden />
			</span>
			<span className="ml-auto flex items-center gap-3 tabular-nums">
				<span className="flex items-center gap-1">
					<span className="icon-[lucide--arrow-down-up] size-3" aria-hidden />
					<span className="text-muted">31.1K</span>
					<span className="icon-[lucide--arrow-down] size-2.5" aria-hidden />
					<span>101</span>
				</span>
				<span className="flex items-center gap-1">
					<span className="icon-[lucide--zap] size-3" aria-hidden />
					1.9s · 38.3 tok/s
				</span>
				<span className="flex items-center gap-1">
					<span className="icon-[lucide--database] size-3" aria-hidden />
					10%
				</span>
				<span className="flex items-center gap-1">
					<span className="icon-[lucide--circle-dashed] size-3" aria-hidden />
					3%
				</span>
				<span className="icon-[lucide--sliders-horizontal] size-3" aria-hidden />
			</span>
		</div>
	);
}
