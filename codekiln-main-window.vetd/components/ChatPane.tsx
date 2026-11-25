import { AskCodeKilnIcon, ConversationStatus, ThinkingSparkIcon } from "./BrandIcons";
import {
	ArrowDownIcon,
	ArrowUpIcon,
	ChevronDownIcon,
	ChevronRightIcon,
	ChevronUpIcon,
	ClipboardListIcon,
	CoinsIcon,
	DatabaseIcon,
	FileCodeIcon,
	FilesIcon,
	BrainIcon,
	CircleDotIcon,
	CopyIcon,
	GitForkIcon,
	ChartGanttIcon,
	ImageIcon,
	MessageCircleIcon,
	ScanIcon,
	Settings2Icon,
	SparkleIcon,
	FolderIcon,
	FolderOpenIcon,
	GitBranchIcon,
	ImagePlusIcon,
	LoaderCircleIcon,
	ShieldOffIcon,
	SquareSlashIcon,
	TerminalIcon,
	TerminalSquareIcon,
	UnfoldHorizontalIcon,
	WrenchIcon,
} from "./LucideIcons";

/** 消息与输入共用阅读列 —— 取自 MessageTimeline.tsx 的 CHAT_COL */
const CHAT_COL = "mx-auto w-full max-w-[860px] px-[16px] @min-[36rem]:px-[24px]";

/**
 * 工具 / 思考摘要行 —— 对齐 ToolSummaryRow.tsx：
 * 22px rounded-[7px] 徽标（border-border/55 + bg-secondary/50）· 13px 类型词 ·
 * 12.5px 弱化摘要 · 尾部状态 · chevron(40% 透明度)。
 */
function ToolRow({
	icon: Icon,
	kind,
	summary,
	trailing,
	expanded,
}: {
	icon: (p: { className?: string }) => React.ReactElement;
	kind: string;
	summary: React.ReactNode;
	trailing?: React.ReactNode;
	expanded?: boolean;
}) {
	return (
		<div className="flex items-center gap-2 py-1">
			<span className="inline-flex size-[22px] shrink-0 items-center justify-center rounded-[7px] border border-border/55 bg-elevated/50 text-muted">
				<Icon className="size-[13px] shrink-0" />
			</span>
			<span className="shrink-0 whitespace-nowrap text-[13px] font-medium text-surface-foreground/80">
				{kind}
			</span>
			<span className="flex min-w-0 flex-1 items-center gap-1.5 text-[12.5px] text-muted">
				<span className="min-w-0 truncate font-mono">{summary}</span>
				{trailing}
			</span>
			<ChevronRightIcon
				className={`size-3.5 shrink-0 text-muted ${expanded ? "rotate-90 opacity-90" : "opacity-40"}`}
			/>
		</div>
	);
}

/** 思考行：chevron + 双星灵光 + 「思考」+ 耗时 */
function ThinkingRow({ seconds }: { seconds: string }) {
	return (
		<div className="flex items-center gap-1.5 py-1 text-[13px] text-muted">
			<ChevronRightIcon className="size-3.5 shrink-0" />
			<ThinkingSparkIcon className="size-[13px] shrink-0" />
			<span className="font-medium">思考</span>
			<span className="tabular-nums opacity-70">· {seconds}</span>
		</div>
	);
}

/** 用户气泡：max-w-86% / rounded-[6px] / bg-muted / 14px 行高 24px（TimelineRow） */
function UserMessage({ children }: { children: React.ReactNode }) {
	return (
		<div className="flex justify-end">
			<div className="max-w-[86%] rounded-[6px] bg-elevated px-[16px] py-[10px] text-[14px] leading-[24px] text-surface-foreground">
				{children}
			</div>
		</div>
	);
}

/** assistant 正文：Markdown 组件映射的真实排版（p my-2/1.7、ul my-2.5 pl-5 space-y-1.5） */
function Prose({ children }: { children: React.ReactNode }) {
	return <div className="text-[14px] text-surface-foreground">{children}</div>;
}

function InlineCode({ children }: { children: React.ReactNode }) {
	return (
		<code className="mx-0.5 rounded-[5px] bg-elevated/70 px-1 py-px font-mono text-[11px]">
			{children}
		</code>
	);
}

export function ChatPane() {
	return (
		<section className="relative flex min-w-0 flex-1 flex-col overflow-hidden rounded-card border border-border bg-surface">
			{/* 协作页签条：28px 胶囊 + MessageCircle 12px 图标；右端宽度开关 + 状态点 */}
			<div className="flex h-[40px] shrink-0 items-center gap-[4px] border-b border-line px-2.5">
				<span className="flex h-[28px] min-w-0 shrink-0 items-center gap-[6px] rounded-[6px] bg-elevated px-[9px] text-[12px] font-medium text-surface-foreground">
					<MessageCircleIcon className="size-[12px] shrink-0" />
					<span className="truncate">从现有代码还原UI设计图</span>
				</span>
				<div className="ml-auto flex shrink-0 items-center gap-1.5">
					<span className="flex size-[26px] items-center justify-center rounded-[6px] text-muted">
						<UnfoldHorizontalIcon className="size-[14px]" strokeWidth={1.75} />
					</span>
					<span className="flex items-center px-0.5">
						<ConversationStatus tone="running" />
					</span>
				</div>
			</div>

			{/* 时间线：外层 relative 承载浮动按钮，内层滚动 */}
			<div className="relative flex min-h-0 flex-1 flex-col">
			<div className={`${CHAT_COL} flex min-h-0 flex-1 flex-col justify-end gap-3 overflow-hidden pt-5 pb-12`}>
				<UserMessage>更具当前代码，帮我先把 ui设计图还原出来</UserMessage>

				<ThinkingRow seconds="5.7s" />

				<div className="flex flex-col gap-0.5">
					{/* 工具组折叠行：group 形态汇总 ran {{count}} commands */}
					<ToolRow
						icon={TerminalIcon}
						kind="终端"
						summary="ran 2 commands"
						trailing={<span className="shrink-0 tabular-nums opacity-70">2 个命令</span>}
					/>
					<ToolRow
						icon={TerminalIcon}
						kind="终端"
						summary="cd /Users/yfdl/githubproject/EnsoCode && sed -n '1,160p' src/renderer/styl…"
					/>
					<ToolRow
						icon={WrenchIcon}
						kind="computer"
						summary="截图 CodeKiln 主窗口"
						trailing={<span className="shrink-0 text-destructive">ReferenceError</span>}
					/>
					<ToolRow
						icon={WrenchIcon}
						kind="computer"
						summary="desktop.windows() → 10 个窗口"
					/>
				</div>

				<ThinkingRow seconds="20.4s" />

				{/* assistant 正文块：relative + group/reply，右上角动作条（CopyButton / ForkButton） */}
				<div className="group/reply relative">
					{/* data-reply-actions：absolute top-0 right-0，size-24 rounded-4 */}
					<div className="absolute top-0 right-0 flex items-center gap-1 text-muted">
						<span className="flex size-[24px] shrink-0 items-center justify-center rounded-[4px]">
							<CopyIcon className="size-[13px]" />
						</span>
						<span className="flex size-[24px] shrink-0 items-center justify-center rounded-[4px]">
							<GitForkIcon className="size-[13px]" />
						</span>
					</div>
					<Prose>
					<p className="my-2 leading-[1.7] first:mt-0">
						已按代码还原主窗口。下面是要点，逐项都能在源码里对上。
					</p>

					<h3 className="mt-2 mb-1 text-[14px] font-semibold">图标来源</h3>
					<ul className="my-2.5 list-disc space-y-1.5 pl-5 leading-[1.7] marker:text-muted">
						<li>
							图标轨与状态点走 <InlineCode>NavIcons.tsx</InlineCode> 的自绘 SVG
						</li>
						<li>
							其余走 <InlineCode>lucide-react@1.33.0</InlineCode> 的原始几何
						</li>
					</ul>

					<h3 className="mt-2 mb-1 text-[14px] font-semibold">关键尺寸</h3>
					<div className="my-2 max-w-full overflow-x-auto">
						<table className="w-full table-fixed border-collapse text-[13px] leading-[1.6]">
							<thead>
								<tr>
									<th className="w-[30%] border-b border-border px-2.5 py-1.5 text-left font-medium whitespace-normal">
										区块
									</th>
									<th className="w-[30%] border-b border-border px-2.5 py-1.5 text-left font-medium whitespace-normal">
										取值
									</th>
								</tr>
							</thead>
							<tbody>
								{[
									["图标轨", "56px · 图标 19px · 按钮 36px"],
									["侧栏", "264px · 行 36px"],
									["阅读列", "max-w-860px · px-24"],
								].map(([k, v]) => (
									<tr key={k}>
										<td className="w-[30%] border-b border-border/50 px-2.5 py-1.5 align-top whitespace-normal text-muted">
											{k}
										</td>
										<td className="border-b border-border/50 px-2.5 py-1.5 align-top whitespace-normal font-mono text-[12px]">
											{v}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
					</Prose>
				</div>

				{/* 本轮变更文件卡 */}
				<div className="overflow-hidden rounded-[6px] border border-line text-[12px]">
					<header className="flex h-[36px] items-center gap-2 bg-elevated/60 px-3">
						<FilesIcon className="size-[14px] shrink-0 text-muted" />
						<span className="font-medium text-surface-foreground">已修改 9 个文件</span>
						<span className="ml-auto flex items-center gap-2 tabular-nums">
							<span className="text-success">+412</span>
							<span className="text-destructive">-58</span>
							<span className="flex h-1.5 w-12 overflow-hidden rounded-full bg-elevated">
								<span className="h-full w-[82%] bg-success" />
								<span className="h-full w-[18%] bg-destructive" />
							</span>
						</span>
					</header>
					<ul className="divide-y divide-line border-t border-line">
						{[
							["src/renderer/styles/", "kettuLight.css", "+175", "-0"],
							["src/renderer/styles/", "cloudLight.css", "+113", "-22"],
							["src/renderer/styles/", "mintLight.css", "+238", "-0"],
						].map(([dir, name, add, del]) => (
							<li key={name} className="flex h-[36px] items-center gap-2 px-3">
								<FileCodeIcon className="size-[14px] shrink-0 text-muted" />
								<span className="min-w-0 flex-1 truncate">
									<span className="text-muted">{dir}</span>
									<span className="font-medium text-surface-foreground">{name}</span>
								</span>
								<span className="shrink-0 tabular-nums">
									<span className="text-success">{add}</span>
									<span className="ml-1.5 text-destructive">{del}</span>
								</span>
							</li>
						))}
					</ul>
				</div>

				{/* 本轮耗时（TurnWaterfallDetails 的 summary 形态） */}
				<details className="max-w-xl text-[12px] leading-normal text-muted">
					<summary className="inline-flex cursor-pointer list-none items-center gap-1.5 py-1">
						<ChartGanttIcon className="size-3.5" />
						<span>本轮耗时</span>
						<span className="tabular-nums">· 6m 4s</span>
						<ChevronRightIcon className="size-3" />
					</summary>
				</details>

				{/* 运行中状态行：Enso 星核 + 消化工具结果 */}
				<div className="flex items-center gap-2 py-1 text-[13px]">
					<AskCodeKilnIcon className="size-[14px] text-primary" />
					<span className="text-surface-foreground/80">消化 echo 的运行结果</span>
					<span className="text-muted tabular-nums">· 4 秒</span>
				</div>


			</div>


			{/* 回到顶部：浮在时间线之上（MessageTimeline absolute bottom-4） */}
			<button
				type="button"
				className="absolute bottom-3 left-1/2 z-10 inline-flex h-7 -translate-x-1/2 items-center gap-1.5 rounded-full border border-border/80 bg-panel px-3 text-[11px] font-medium text-muted"
			>
				<ArrowDownIcon className="size-3" />
				回到顶部
			</button>
			</div>

			{/* 输入区 */}
			<div className="shrink-0 pt-1 pb-3">
				<div className={CHAT_COL}>
					{/* TaskBar：输入框上方 mb-1.5 的一排 chip（后台命令 / 后台 Agent / 当前进度） */}
					<div className="mb-1.5 flex flex-wrap items-center gap-1.5">
						{/* 后台命令：running>0 时图标换成 LoaderCircle 旋转，失败角标 -top-0.5 -right-0.5 size-2 */}
						<span className="relative inline-flex h-[28px] items-center gap-[6px] rounded-[6px] border border-border/80 bg-surface px-[10px] text-[12px] text-muted">
							<TerminalSquareIcon className="size-[14px]" />
							<span>后台命令</span>
							<span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-destructive" />
						</span>
						<span className="relative inline-flex h-[28px] items-center gap-[6px] rounded-[6px] border border-border/80 bg-surface px-[10px] text-[12px] text-muted">
							<LoaderCircleIcon className="size-[14px] animate-spin" />
							<span>后台 Agent</span>
							<span className="tabular-nums">· 1</span>
							<span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-destructive" />
						</span>
						{/* 当前进度：progress.active 时 LoaderCircle，否则 ListTodo */}
						<span className="inline-flex h-[28px] items-center gap-[6px] rounded-[6px] border border-border/80 bg-surface px-[10px] text-[12px] text-muted">
							<LoaderCircleIcon className="size-[14px] animate-spin" />
							<span>当前进度</span>
							<span className="tabular-nums">2/3</span>
						</span>
					</div>

					{/* data-slot="composer"：rounded-xl + border + bg-card（无静态投影） */}
					<div className="rounded-[10px] border border-border bg-panel">
						{/* data-composer-editor：min-h-64 / px-14 / pt-12 / pb-4 */}
						<div className="flex min-h-[64px] items-start gap-1.5 px-[14px] pt-[12px] pb-[4px]">
							<span className="text-[14px] leading-[20px] text-muted">
								消息将排队，本轮结束后发送…
							</span>
						</div>

						{/* data-composer-toolbar：border-t border-border/60 px-8 pt-5 pb-8 */}
						<div className="flex items-end justify-between gap-[4px] border-t border-border/60 px-[8px] pt-[5px] pb-[8px]">
							<div className="flex min-w-0 flex-1 flex-wrap items-center gap-[4px]">
								<span className="flex size-[28px] shrink-0 items-center justify-center rounded-[6px] text-muted">
									<ImagePlusIcon className="size-[14px]" />
								</span>
								<span className="flex size-[28px] shrink-0 items-center justify-center rounded-[6px] text-muted">
									<SquareSlashIcon className="size-[15px]" />
								</span>
								{/* WorktreePicker：h-28 / gap-4 / px-8 / GitBranch 14px + 名称 + chevron 12px */}
								<span className="flex h-[28px] min-w-0 shrink-0 items-center gap-[4px] rounded-[6px] px-[8px] text-[12px] text-muted">
									<GitBranchIcon className="size-[14px] shrink-0" />
									<span className="min-w-0 truncate">main</span>
									<ChevronDownIcon className="h-3 w-3 shrink-0" />
								</span>
								{/* PlanModeToggle：h-28，只有图标 + 文字，无 chevron（代码里就是 button 不是 popover） */}
								<span className="flex h-[28px] min-w-0 shrink-0 items-center gap-[4px] rounded-[6px] px-[8px] text-[12px] text-muted">
									<ClipboardListIcon className="size-[14px] shrink-0" />
									<span>计划</span>
								</span>
								{/* ApprovalModePicker(full)：h-28 + ShieldOff 14px + chevron 12px */}
								<span className="flex h-[28px] min-w-0 max-w-full shrink-0 items-center gap-[4px] rounded-[6px] px-[8px] text-[12px] text-muted">
									<ShieldOffIcon className="size-[14px] shrink-0" />
									<span className="min-w-0 truncate">完全放行</span>
									<ChevronDownIcon className="h-3 w-3 shrink-0" />
								</span>
							</div>

							{/* ModelPicker 触发胶囊：h-28 / bg-muted/45 / Sparkle 品牌橙 / Brain 档位小块 / chevron */}
							<span className="flex h-[28px] min-w-[56px] max-w-[256px] shrink items-center gap-[6px] rounded-[6px] bg-elevated/45 px-[8px] text-[12px] text-surface-foreground">
								<SparkleIcon className="size-[14px] shrink-0 text-primary" />
								<span className="min-w-0 truncate">Deepseek-v4.1-flash-02</span>
								<span className="flex h-[17px] shrink-0 items-center gap-[3px] rounded-[4px] bg-primary/15 px-1 text-primary">
									<BrainIcon className="size-[11px]" />
									<span className="text-[10.5px] font-medium leading-none">最高</span>
								</span>
								<ChevronDownIcon className="size-3 shrink-0" />
							</span>

							{/* 发送：size-32 / rounded-6 / bg-brand */}
							<span className="flex size-[32px] shrink-0 items-center justify-center rounded-[6px] bg-primary text-primary-foreground">
								<ArrowUpIcon className="size-[16px]" />
							</span>
						</div>
					</div>

					{/* 状态行：StatsLine —— mt-4 / h-26 / gap-2，左侧 place、右侧 tray */}
					<div className="mt-[4px] flex h-[26px] min-w-0 items-center gap-[2px] px-[4px] text-[12px] text-muted tabular-nums">
						<span className="flex min-w-0 items-center gap-[2px]">
							<span className="flex h-[24px] shrink-0 items-center gap-[6px] rounded-full px-[8px]">
								<FolderIcon className="size-[13px] shrink-0 opacity-75" />
								<span className="max-w-[160px] truncate">EnsoCode</span>
								<ChevronUpIcon className="size-[11px] shrink-0 opacity-45" />
							</span>
						</span>
						<span className="ml-auto flex min-w-0 items-center gap-[2px]">
							<span className="flex h-[24px] items-center gap-[6px] rounded-full px-[8px]">
								<CoinsIcon className="size-[13px] shrink-0 opacity-75" />↑15.7M ↓75.2K
							</span>
							<span className="flex h-[24px] items-center gap-[6px] rounded-full px-[8px]">
								<DatabaseIcon className="size-[13px] shrink-0 opacity-75" />
								97%
							</span>
							<span className="flex h-[24px] items-center gap-[6px] rounded-full px-[8px]">
								<svg viewBox="0 0 12 12" aria-hidden className="size-[12px] shrink-0 -rotate-90">
									<circle cx="6" cy="6" r="4.6" fill="none" stroke="currentColor" strokeOpacity={0.22} strokeWidth={1.6} />
									<circle cx="6" cy="6" r="4.6" fill="none" stroke="currentColor" strokeWidth={1.6} strokeDasharray="9.3 26" strokeLinecap="round" />
								</svg>
								16%
							</span>
						</span>
						{/* 状态行末尾的段位设置入口：size-24 rounded-full + Settings2 13px */}
						<span className="flex size-[24px] shrink-0 items-center justify-center rounded-full text-faint">
							<Settings2Icon className="size-[13px]" />
						</span>
					</div>
				</div>
			</div>
		</section>
	);
}
