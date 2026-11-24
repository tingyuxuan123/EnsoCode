import type { CSSProperties } from "react";

/**
 * 模型与推理浮层：三栏——条目轨｜模型列表（可搜索）｜所选模型的推理档位。
 * 结构借自 open-vetta 的选模型面板；右栏的控制件是 CodeKiln 自己的开关 + 档位滑杆。
 */
export type Level = "低" | "中" | "高" | "极高" | "最高";

export interface PickerModel {
	name: string;
	id: string;
	window: string;
	selected?: boolean;
}

export interface PickerGroup {
	vendor: string;
	meta?: string;
	badge?: string;
	models: PickerModel[];
}

export interface RailEntry {
	key: string;
	label: string;
	mark: string;
	icon?: string;
}

export interface ModelPickerPanelProps {
	rail: RailEntry[];
	activeRail: string;
	query: string;
	groups: PickerGroup[];
	levels: Level[];
	level: Level;
	reasoningOn?: boolean;
	reasoningMode?: "follow" | "on" | "off";
	note: string;
	/** 右栏归属的模型：列表很长时，滑杆调的是哪一个要能一眼确认 */
	modelLabel?: string;
	searching?: boolean;
	/** 弹层高度；搜索结果少时跟着收，避免底部一片空 */
	height?: number;
}

const THUMB_PX = 28;

/** 滑块圆心、填充端点、档位点共用同一条几何：首末档各内缩半个滑块 */
function offset(index: number, count: number): string {
	const ratio = count > 1 ? index / (count - 1) : 0;
	return `calc(${THUMB_PX / 2}px + (100% - ${THUMB_PX}px) * ${ratio})`;
}

function RailItem({ entry, active }: { entry: RailEntry; active: boolean }) {
	return (
		<div
			title={entry.label}
			className={`flex size-[34px] shrink-0 items-center justify-center rounded-[8px] transition-colors ${
				active
					? "bg-white/[0.09] text-ink ring-1 ring-inset ring-white/[0.07]"
					: "text-faint hover:bg-white/[0.04] hover:text-muted"
			}`}
		>
			{entry.icon ? (
				<span className={`${entry.icon} size-[15px]`} aria-hidden />
			) : (
				<span className="text-[11.5px] font-semibold leading-none">{entry.mark}</span>
			)}
		</div>
	);
}

function Switch({ on }: { on: boolean }) {
	return (
		<span
			className={`relative flex h-4 w-7 shrink-0 items-center rounded-full px-0.5 transition-colors ${
				on ? "bg-brand" : "bg-white/15"
			}`}
		>
			<span
				className={`size-3 rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.35)] transition-transform ${
					on ? "translate-x-3" : "translate-x-0"
				}`}
			/>
		</span>
	);
}

function LevelSlider({ levels, level }: { levels: Level[]; level: Level }) {
	const index = Math.max(0, levels.indexOf(level));
	const style: CSSProperties = { width: offset(index, levels.length) };
	return (
		<div className="select-none">
			<div className="relative h-7">
				<div className="absolute inset-x-0 top-0.5 h-6 overflow-hidden rounded-full bg-white/[0.08] ring-1 ring-inset ring-white/[0.05]">
					<div
						className="absolute inset-y-0 left-0 overflow-hidden rounded-full bg-brand"
						style={style}
					/>
				</div>
				{levels.map((entry, dotIndex) => (
					<span
						key={entry}
						style={{ left: offset(dotIndex, levels.length) }}
						className={`absolute top-3 size-1 -translate-x-1/2 rounded-full ${
							dotIndex <= index ? "bg-white/55" : "bg-white/25"
						}`}
					/>
				))}
				<span
					style={{ left: offset(index, levels.length) }}
					className="absolute top-0 size-7 -translate-x-1/2 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.35)] ring-1 ring-black/20"
				/>
			</div>
			<div className="relative mt-1.5 h-4">
				{levels.map((entry, labelIndex) => (
					<span
						key={entry}
						style={{ left: offset(labelIndex, levels.length) }}
						className={`absolute top-0 whitespace-nowrap text-[11px] leading-4 ${
							labelIndex === 0
								? "text-left"
								: labelIndex === levels.length - 1
									? "-translate-x-full text-right"
									: "-translate-x-1/2 text-center"
						} ${labelIndex === index ? "font-medium text-ink" : "text-faint"}`}
					>
						{entry}
					</span>
				))}
			</div>
		</div>
	);
}

const MODE_LABEL: Record<"follow" | "on" | "off", string> = {
	follow: "跟随",
	on: "开",
	off: "关",
};

export function ModelPickerPanel({
	rail,
	activeRail,
	query,
	groups,
	levels,
	level,
	reasoningOn = true,
	reasoningMode,
	note,
	modelLabel,
	searching = false,
	height = 368,
}: ModelPickerPanelProps) {
	return (
		<div
			style={{ height }}
			className="flex w-[604px] overflow-hidden rounded-panel bg-surface text-ink shadow-[0_0_0_0.5px_rgba(255,255,255,0.12),0_28px_64px_-24px_rgba(0,0,0,0.9)]"
		>
			<div className="flex w-[52px] shrink-0 flex-col items-center gap-1.5 bg-rail p-1.5">
				{rail.map((entry) => (
					<RailItem key={entry.key} entry={entry} active={!searching && entry.key === activeRail} />
				))}
			</div>

			<div className="flex w-[340px] shrink-0 flex-col border-l border-hairline p-2">
				<div className="relative">
					<span
						className="icon-[lucide--search] pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-faint"
						aria-hidden
					/>
					<div className="flex h-8 w-full items-center rounded-md bg-white/[0.045] pl-8 pr-11 text-[12.5px] ring-1 ring-inset ring-white/[0.06]">
						<span className={query ? "truncate text-ink" : "truncate text-faint"}>
							{query || "搜索模型、账号或网关"}
						</span>
					</div>
					<span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded-[4px] bg-white/[0.06] px-1.5 py-[2px] font-mono text-[10px] leading-3 text-faint">
						⌘P
					</span>
				</div>

				<div className="mt-2 flex h-[18px] items-center gap-1.5 px-2">
					{searching ? (
						<span className="text-[11px] text-muted">
							{groups[0].models.length} 个结果
						</span>
					) : (
						<>
							<span className="truncate text-[11px] text-muted">{groups[0].vendor}</span>
							{groups[0].badge ? (
								<span className="shrink-0 rounded-[3px] px-1 text-[9.5px] font-medium uppercase leading-4 tracking-wide text-faint ring-1 ring-inset ring-white/15">
									{groups[0].badge}
								</span>
							) : null}
							{groups[0].meta ? (
								<span className="ml-auto truncate font-mono text-[10.5px] text-faint">
									{groups[0].meta}
								</span>
							) : null}
						</>
					)}
				</div>

				<div className="flex min-h-0 flex-col overflow-hidden">
					{groups[0].models.map((model) => (
						<div
							key={`${model.id}-${model.name}`}
							className={`flex h-[42px] shrink-0 items-center gap-2 rounded-row px-2 transition-colors ${
								model.selected ? "bg-white/[0.07]" : "hover:bg-white/[0.04]"
							}`}
						>
							<span className="flex min-w-0 flex-1 flex-col justify-center">
								<span className="truncate text-[12.5px] leading-[17px] text-ink">{model.name}</span>
								<span className="truncate font-mono text-[10.5px] leading-[14px] text-faint">
									{model.id}
								</span>
							</span>
							<span className="shrink-0 text-[10.5px] tabular-nums text-faint">{model.window}</span>
							<span className="flex size-3.5 shrink-0 items-center justify-center">
								{model.selected ? (
									<span className="icon-[lucide--check] size-3.5 text-brand" aria-hidden />
								) : null}
							</span>
						</div>
					))}
				</div>
			</div>

			<div className="flex w-[212px] shrink-0 flex-col border-l border-hairline bg-sunken px-3 py-3">
				<div className="flex h-[18px] items-center justify-between">
					<span className="text-[11px] text-muted">推理</span>
					{reasoningMode ? null : <Switch on={reasoningOn} />}
				</div>

				{reasoningMode ? (
					<div className="mt-2 flex h-6 gap-1">
						{(["follow", "on", "off"] as const).map((mode) => (
							<span
								key={mode}
								className={`flex flex-1 items-center justify-center rounded-chip text-[10.5px] ${
									reasoningMode === mode
										? "bg-white/[0.10] text-ink ring-1 ring-inset ring-white/[0.10]"
										: "text-faint ring-1 ring-inset ring-white/[0.06]"
								}`}
							>
								{MODE_LABEL[mode]}
							</span>
						))}
					</div>
				) : null}

				<p className="mt-1.5 truncate text-[11px] text-faint">{modelLabel}</p>

				<div className="flex flex-1 flex-col justify-center">
					<LevelSlider levels={levels} level={level} />
				</div>
				<p className="shrink-0 text-[11px] leading-4 text-faint">{note}</p>
			</div>
		</div>
	);
}
