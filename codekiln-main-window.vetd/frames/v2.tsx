export const frame = { width: 1440, height: 900, title: "改版稿 · 信息层级" };

import { AskCodeKilnIcon, ConversationStatus, ThinkingSparkIcon } from "../components/BrandIcons";
import {
	ArchiveIcon,
	ArrowDownIcon,
	ArrowUpIcon,
	BrainIcon,
	ChevronDownIcon,
	ChevronRightIcon,
	ChevronUpIcon,
	ChevronsUpDownIcon,
	CirclePlusIcon,
	ClipboardListIcon,
	CoinsIcon,
	DatabaseIcon,
	FileCodeIcon,
	FilesIcon,
	FolderGit2Icon,
	FolderIcon,
	FolderOpenIcon,
	GitBranchIcon,
	ImagePlusIcon,
	LoaderCircleIcon,
	MessageCircleIcon,
	MonitorIcon,
	PinIcon,
	PlusIcon,
	SearchIcon,
	Settings2Icon,
	ShieldOffIcon,
	SparkleIcon,
	SquareSlashIcon,
	TerminalIcon,
	TextSearchIcon,
	UnfoldHorizontalIcon,
	WrenchIcon,
} from "../components/LucideIcons";
import { CommandTray } from "../components/CommandTray";
import { ExtensionsIcon } from "../components/BrandIcons";
import {
	AskCodeKilnIcon as EnsoIcon,
	CodeWorkspaceIcon,
	DesignGalleryIcon,
	ImageStudioIcon,
	SettingsGearIcon,
} from "../components/BrandIcons";

/**
 * 改版稿 —— 与 index.tsx 的还原稿并排对比。
 *
 * 改动只针对源码里能验证的问题，每条都在注释里写明依据。
 * 不动的：--brand、--border 12%、shadow-xs 5%、圆角体系、卡片 6px 留缝。
 */

const CHAT_COL = "mx-auto w-full max-w-[880px] px-[24px]";

/* ── 改动 1：图标轨选中态 ────────────────────────────────────────────────
 * 现状：选中只换图标颜色（text-brand），56px 宽的轨上辨识度低。
 * 改版：加一枚 2px 左侧竖条 + 图标提亮，颜色仍用 brand，不引入新色。
 */
function RailButton({
	label,
	active,
	brand,
	children,
}: {
	label: string;
	active?: boolean;
	brand?: boolean;
	children: React.ReactNode;
}) {
	return (
		<button
			type="button"
			title={label}
			aria-label={label}
			className={`relative flex size-[36px] items-center justify-center transition-colors ${
				active ? "text-primary" : brand ? "text-primary" : "text-muted hover:text-surface-foreground"
			}`}
		>
			{active && (
				<span className="absolute top-1/2 -left-[10px] h-5 w-[2px] -translate-y-1/2 rounded-full bg-primary" />
			)}
			{children}
		</button>
	);
}

function AppRailV2() {
	return (
		<nav
			aria-label="CodeKiln"
			className="flex w-[56px] shrink-0 flex-col items-center gap-[8px] pt-[4px] pb-[12px]"
		>
			<RailButton label="收起侧栏">
				<SearchIcon className="size-[18px]" strokeWidth={1.75} />
			</RailButton>

			<div className="my-1 w-5 border-t border-border" />

			<RailButton label="Code" active>
				<CodeWorkspaceIcon className="size-[19px]" />
			</RailButton>
			<RailButton label="图片工作台">
				<ImageStudioIcon className="size-[19px]" />
			</RailButton>
			<RailButton label="设计画廊">
				<DesignGalleryIcon className="size-[19px]" />
			</RailButton>

			<div className="flex-1" />

			<span
				role="status"
				aria-label="本机 · 2 个运行中"
				className="flex min-h-[24px] w-[44px] items-center justify-center gap-[3px] text-[11px] text-muted tabular-nums"
			>
				<LoaderCircleIcon className="size-[14px] animate-spin text-primary" strokeWidth={1.75} />
				<span>2</span>
			</span>

			<RailButton label="询问 CodeKiln" brand>
				<EnsoIcon className="size-[19px]" />
			</RailButton>
			<RailButton label="设置">
				<SettingsGearIcon className="size-[19px]" />
			</RailButton>
		</nav>
	);
}

/* ── 改动 2：侧栏会话行右侧 ──────────────────────────────────────────────
 * 现状（Sidebar.tsx:2408）：时间用 text-muted-foreground/80，11px，
 * 叠在 #141416 上算得 5.55:1 —— 勉强过线但明显偏灰；
 * 且时间与 @1 徽标、状态点三者挤在同一行右侧，信息噪音高。
 * 改版：时间提到 muted 全值（8.03:1）；@1 徽标改为左侧状态点旁的小圆点计数，
 * 让"这条在等我"变成可扫读的形状，而不是行尾一个数字。
 */
type Tone = "idle" | "running" | "attention" | "waiting" | "failed" | "unread";
type Row = { title: string; time: string; tone: Tone; asks?: number; active?: boolean };

function ConversationRowV2({ row }: { row: Row }) {
	return (
		<div
			className={`group grid min-h-[36px] cursor-pointer grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2 gap-y-0.5 rounded-[6px] py-1.5 pr-2 pl-2 text-[13px] transition-colors ${
				row.active
					? "bg-white/8 font-medium text-surface-foreground"
					: "text-muted hover:bg-white/4"
			}`}
		>
			<ConversationStatus tone={row.tone} active={row.active} />
			<div className="flex min-w-0 items-center gap-2">
				<span className="min-w-0 flex-1 truncate">{row.title}</span>
				{/* 待回答：形状而非数字，扫读更快 */}
				{row.asks ? (
					<span className="flex shrink-0 items-center gap-[3px] text-warning">
						<span className="size-[3px] rounded-full bg-current" />
						<span className="size-[3px] rounded-full bg-current" />
					</span>
				) : null}
				{/* 时间：muted 全值，不再 /80 */}
				<span className="shrink-0 text-[11px] text-muted tabular-nums">{row.time}</span>
			</div>
		</div>
	);
}

function ProjectRowV2({ name, folded }: { name: string; folded?: boolean }) {
	return (
		<div className="group flex h-[36px] w-full items-center gap-1 rounded-[6px] px-2 hover:bg-white/4">
			<button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left">
				<span className="flex size-4 shrink-0 items-center justify-center text-muted">
					{folded ? (
						<FolderGit2Icon className="size-[14px]" />
					) : (
						<FolderOpenIcon className="size-[14px]" />
					)}
				</span>
				<span className="min-w-0 flex-1 truncate text-[14px] font-medium text-surface-foreground">
					{name}
				</span>
			</button>
			<PinIcon className="size-3.5 shrink-0 text-muted opacity-0 group-hover:opacity-100" />
			<PlusIcon className="size-3.5 shrink-0 text-muted opacity-0 group-hover:opacity-100" />
		</div>
	);
}

const ACTIVE_V2: Row[] = [
	{ title: "从现有代码还原UI设计图", time: "现在", tone: "running", active: true },
	{ title: "项目助手代审模型", time: "现在", tone: "running" },
];

const PROJECTS_V2: { name: string; folded?: boolean; rows: Row[] }[] = [
	{
		name: "EnsoCode",
		rows: [
			{ title: "从现有代码还原UI设计图", time: "现在", tone: "running" },
			{ title: "项目助手代审模型", time: "50分钟前", tone: "attention" },
			{ title: "llmdoc 知识地图插件", time: "1小时前", tone: "waiting", asks: 1 },
			{ title: "设计模式未创建画布而直接改代码", time: "1小时前", tone: "idle" },
			{ title: "个人版本发布", time: "4小时前", tone: "unread" },
		],
	},
	{ name: "yusangfang", folded: true, rows: [] },
	{
		name: "Moonyy",
		rows: [{ title: "Moonyy设计稿还原集成", time: "昨天", tone: "failed", asks: 1 }],
	},
];

/* ── 改动 3：侧栏顶部「项目 / 对话」分段 ──────────────────────────────────
 * 现状：两段等宽的实心分段控件，占满整行，视觉重量超过下面的列表。
 * 改版：降为轻量的下划线式切换，让列表成为侧栏的主体。
 */
function ProjectSidebarV2() {
	return (
		<aside className="flex w-[264px] shrink-0 flex-col overflow-hidden rounded-card border border-border bg-shell">
			<div className="flex shrink-0 items-center gap-2 px-[12px] pt-[12px]">
				<div className="flex h-[36px] min-w-0 flex-1 items-end gap-4">
					<span className="flex h-full items-center border-b-2 border-primary text-[13px] font-medium text-surface-foreground">
						项目
					</span>
					<span className="flex h-full items-center text-[13px] text-muted">对话</span>
				</div>
				<button
					type="button"
					aria-label="搜索全部"
					className="flex size-[32px] shrink-0 items-center justify-center rounded-[6px] text-muted hover:bg-white/4"
				>
					<SearchIcon className="size-4" />
				</button>
			</div>

			<button
				type="button"
				className="mx-3 mt-3 flex h-[36px] shrink-0 items-center gap-2 rounded-[6px] px-1.5 text-left text-[14px] whitespace-nowrap text-surface-foreground hover:bg-white/4"
			>
				<CirclePlusIcon className="size-[17px] shrink-0 text-primary" />
				<span>新建任务</span>
				<span className="ml-auto rounded border border-border px-1 text-[11px] text-muted">
					⌘N
				</span>
			</button>
			<button
				type="button"
				className="mx-3 mt-1 flex h-[36px] shrink-0 items-center gap-2 rounded-[6px] px-1.5 text-left text-[14px] whitespace-nowrap text-surface-foreground hover:bg-white/4"
			>
				<ExtensionsIcon className="size-[17px] shrink-0" />
				<span>扩展</span>
			</button>

			<div className="mt-4 flex shrink-0 items-center gap-1 px-4 text-[12px] text-muted">
				<span className="min-w-0 flex-1 truncate">项目</span>
				<ChevronsUpDownIcon className="size-3.5" />
				<PlusIcon className="size-4" />
			</div>

			<div className="flex shrink-0 items-center gap-1 px-3 pt-2 pb-1">
				<div className="flex min-w-0 flex-1 gap-1 overflow-hidden">
					<span className="flex h-7 shrink-0 items-center gap-1 rounded-full bg-white/10 px-2.5 text-[12px] font-medium text-surface-foreground">
						全部
						<span className="text-[11px] tabular-nums opacity-70">8</span>
					</span>
					<span className="flex h-7 shrink-0 items-center gap-1 rounded-full bg-elevated/50 px-2.5 text-[12px] text-muted">
						工作
						<span className="text-[11px] tabular-nums opacity-70">5</span>
					</span>
					<span className="flex h-7 shrink-0 items-center gap-1 rounded-full bg-elevated/50 px-2.5 text-[12px] text-muted">
						个人
						<span className="text-[11px] tabular-nums opacity-70">2</span>
					</span>
				</div>
				<TextSearchIcon className="size-3.5 shrink-0 text-muted" />
			</div>

			<div className="min-h-0 flex-1 space-y-2 overflow-hidden px-3 pt-1 pb-2">
				<div>
					<div className="truncate px-2 py-2 text-[11px] font-medium text-muted">运行中</div>
					<div className="flex flex-col gap-y-0.5">
						{ACTIVE_V2.map((row) => (
							<ConversationRowV2 key={row.title} row={row} />
						))}
					</div>
				</div>

				<div className="flex flex-col gap-y-0.5">
					{PROJECTS_V2.map((project) => (
						<div key={project.name}>
							<ProjectRowV2 name={project.name} folded={project.folded} />
							{!project.folded && project.rows.length > 0 && (
								<div className="flex flex-col gap-y-0.5">
									{project.rows.map((row) => (
										<ConversationRowV2 key={row.title} row={row} />
									))}
								</div>
							)}
						</div>
					))}
				</div>
			</div>

			<div className="flex shrink-0 items-center gap-1 border-t border-line px-3 py-2">
				<button
					type="button"
					className="flex h-[32px] min-w-0 flex-1 items-center gap-1.5 rounded-[6px] px-2 text-[13px] text-surface-foreground hover:bg-white/4"
				>
					<MonitorIcon className="size-4 shrink-0 text-muted" />
					<span className="truncate">本机</span>
					<ChevronDownIcon className="size-3.5 shrink-0 text-muted" />
				</button>
				<button
					type="button"
					aria-label="归档 (93)"
					className="flex h-[32px] shrink-0 items-center gap-1.5 rounded-[6px] px-2 text-[11px] text-muted tabular-nums hover:bg-white/4"
				>
					<ArchiveIcon className="size-4" />
					93
				</button>
			</div>
		</aside>
	);
}

/* ── 改动 4：审批档位带风险语义 ─────────────────────────────────────────
 * 现状（ApprovalModePicker.tsx:24）：full = "Full access" / "Run everything without asking"，
 * 图标 ShieldOff 是唯一的视觉差异，文字与其它档位同为 muted —— 权限全开和只读计划长得一样。
 * 改版：full 档用 warning 色（#d9b463 on panel = 8.15:1），并加 12% 同色底，
 * 让"最危险的那一档"在扫读时能被注意到。其余档位保持 muted。
 */

/* ── 改动 5：工具行收敛为一条时间轴 ─────────────────────────────────────
 * 现状：每个工具行都是独立的一行，22px 徽标 + 类型词 + 摘要 + chevron，
 * 一屏里连续 6 行同构，读起来像列表而不是"一次执行过程"。
 * 改版：用一条左侧竖线把同轮的工具串起来，徽标骑在线上，
 * 首尾各有一个端点。仍是 22px 徽标 / 13px 类型词，只改编排。
 */
function TimelineGroup({ children }: { children: React.ReactNode }) {
	return (
		<div className="relative">
			<span className="absolute top-[26px] bottom-[26px] left-[11px] w-px bg-white/22" aria-hidden />
			{children}
		</div>
	);
}

function ToolRowV2({
	icon: Icon,
	kind,
	summary,
	trailing,
	failed,
}: {
	icon: (p: { className?: string }) => React.ReactElement;
	kind: string;
	summary: React.ReactNode;
	trailing?: React.ReactNode;
	failed?: boolean;
}) {
	return (
		<div className="relative flex items-center gap-2 py-1">
			<span
				className={`relative z-10 inline-flex size-[22px] shrink-0 items-center justify-center rounded-full border bg-surface ${
					failed ? "border-destructive/40 text-destructive" : "border-border/70 text-muted"
				}`}
			>
				<Icon className="size-[12px] shrink-0" />
			</span>
			<span className="shrink-0 whitespace-nowrap text-[13px] font-medium text-surface-foreground/80">
				{kind}
			</span>
			<span className="flex min-w-0 flex-1 items-center gap-1.5 text-[12.5px] text-muted">
				<span className="min-w-0 truncate font-mono">{summary}</span>
				{trailing}
			</span>
			<ChevronRightIcon className="size-3.5 shrink-0 text-muted opacity-40" />
		</div>
	);
}

export default function Redesign() {
	return (
		<div className="flex h-full flex-col bg-shell font-sans text-surface-foreground antialiased">
			<header className="flex h-[44px] shrink-0 items-center pl-[84px] pr-3">
				<div className="ml-auto flex items-center gap-1">
					<span className="flex size-7 items-center justify-center rounded-[6px] text-surface-foreground">
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden className="size-4">
							<rect width="18" height="18" x="3" y="3" rx="2" />
							<path d="M15 3v18" />
						</svg>
					</span>
				</div>
			</header>

			<div className="flex min-h-0 flex-1 gap-[6px] pr-[6px] pb-[6px]">
				<AppRailV2 />
				<ProjectSidebarV2 />

				{/* 会话卡 */}
				<section className="relative flex min-w-0 flex-1 flex-col overflow-hidden rounded-card border border-border bg-surface">
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

					<div className="relative flex min-h-0 flex-1 flex-col">
						<div className={`${CHAT_COL} flex min-h-0 flex-1 flex-col justify-end gap-3 pt-5 pb-12`}>
							<div className="flex justify-end">
								<div className="max-w-[86%] rounded-[6px] bg-elevated px-[16px] py-[10px] text-[14px] leading-[24px]">
									更具当前代码，帮我先把 ui设计图还原出来
								</div>
							</div>

							<div className="flex items-center gap-1.5 py-1 text-[13px] text-muted">
								<ChevronRightIcon className="size-3.5 shrink-0" />
								<ThinkingSparkIcon className="size-[13px] shrink-0" />
								<span className="font-medium">思考</span>
								<span className="tabular-nums opacity-70">· 5.7s</span>
							</div>

							{/* 改动 5：时间轴串联 */}
							<TimelineGroup>
								<ToolRowV2
									icon={TerminalIcon}
									kind="终端"
									summary="sed -n '1,160p' src/renderer/styles/shared.css"
								/>
								<ToolRowV2
									icon={WrenchIcon}
									kind="computer"
									summary="截图 CodeKiln 主窗口"
									trailing={<span className="shrink-0 text-destructive">ReferenceError</span>}
									failed
								/>
								<ToolRowV2
									icon={WrenchIcon}
									kind="computer"
									summary="desktop.windows() → 10 个窗口"
								/>
								<ToolRowV2
									icon={FolderOpenIcon}
									kind="读取"
									summary="src/renderer/components/chat/Composer.tsx"
								/>
							</TimelineGroup>

							<div className="text-[14px] text-surface-foreground">
								<p className="my-2 leading-[1.7] first:mt-0">
									已按代码还原主窗口。下面是要点，逐项都能在源码里对上。
								</p>
								<h3 className="mt-2 mb-1 text-[14px] font-semibold">图标来源</h3>
								<ul className="my-2.5 list-disc space-y-1.5 pl-5 leading-[1.7] marker:text-muted">
									<li>
										图标轨与状态点走{" "}
										<code className="mx-0.5 rounded-[5px] bg-elevated/70 px-1 py-px font-mono text-[11px]">
											NavIcons.tsx
										</code>{" "}
										的自绘 SVG
									</li>
									<li>
										其余走{" "}
										<code className="mx-0.5 rounded-[5px] bg-elevated/70 px-1 py-px font-mono text-[11px]">
											lucide-react@1.33.0
										</code>{" "}
										的原始几何
									</li>
								</ul>
							</div>

							<div className="flex items-center gap-2 py-1 text-[13px]">
								<AskCodeKilnIcon className="size-[14px] text-primary" />
								<span className="text-surface-foreground/80">消化 echo 的运行结果</span>
								<span className="text-muted tabular-nums">· 4 秒</span>
							</div>
						</div>

						<button
							type="button"
							className="absolute bottom-3 left-1/2 z-10 inline-flex h-7 -translate-x-1/2 items-center gap-1.5 rounded-full border border-border/80 bg-panel px-3 text-[11px] font-medium text-muted"
						>
							<ArrowDownIcon className="size-3" />
							回到顶部
						</button>
					</div>

					{/* ── 输入区改版 ────────────────────────────────────────────────
					 * 1. TaskBar 三个 chip 原本同重同构、失败态靠一个飘在边框外的圆点表示；
					 *    改版把状态压进 chip 本身：失败整枚染 destructive，运行中留中性，
					 *    当前进度加一条 24px 的细进度轨，扫读时先看到"哪件事出问题"。
					 * 2. 工具条从一条平铺改成三个语义区，用 1px 竖线隔开：
					 *    写入口 / 执行上下文 / 模型与发送。
					 * 3. 状态行从四枚等重药丸改为一簇安静的数字 + 明确标签，
					 *    设置入口提到全对比度（原来 opacity-60 几乎看不见）。
					 */}
					<div className="shrink-0 pt-1 pb-3">
						<div className={CHAT_COL}>
							{/* TaskBar：状态直接写在 chip 上，不再用飘在角上的圆点 */}
							<div className="mb-2 flex flex-wrap items-center gap-1.5">
								<span className="inline-flex h-[28px] items-center gap-[6px] rounded-[6px] border border-destructive/30 bg-destructive/10 px-[10px] text-[12px] text-destructive">
									<TerminalIcon className="size-[14px] shrink-0" />
									<span>后台命令</span>
									<span className="text-[11px] opacity-80">失败</span>
								</span>
								<span className="inline-flex h-[28px] items-center gap-[6px] rounded-[6px] border border-border/80 bg-surface px-[10px] text-[12px] text-muted">
									<LoaderCircleIcon className="size-[14px] shrink-0 animate-spin text-primary" />
									<span>后台 Agent</span>
									<span className="tabular-nums">1</span>
								</span>
								<span className="inline-flex h-[28px] items-center gap-[6px] rounded-[6px] border border-border/80 bg-surface px-[10px] text-[12px] text-muted">
									<LoaderCircleIcon className="size-[14px] shrink-0 animate-spin text-primary" />
									<span>当前进度</span>
									{/* 细进度轨：24×3，取代 "2/3" 这种要读的字 */}
									<span className="h-[3px] w-6 shrink-0 overflow-hidden rounded-full bg-white/12">
										<span className="block h-full w-2/3 rounded-full bg-primary" />
									</span>
									<span className="tabular-nums">2/3</span>
								</span>
							</div>

							{/* 输入框：10px 圆角与工具栏共用一套几何；上方挂 / 命令面板 */}
							<div className="relative rounded-[10px] border border-border bg-panel">
								<CommandTray />
								<div className="flex min-h-[56px] items-center gap-1.5 px-[14px] py-[10px]">
									<span className="font-mono text-[14px] leading-[20px] text-surface-foreground">
										/
									</span>
								</div>

								{/* 工具条：三区，1px 竖线分隔 */}
								<div className="flex items-end justify-between gap-2 border-t border-border/60 px-[8px] pt-[5px] pb-[8px]">
									<div className="flex min-w-0 flex-1 flex-wrap items-center gap-[4px]">
										{/* 区 1：写入口 */}
										<span className="flex size-[28px] shrink-0 items-center justify-center rounded-[6px] text-muted">
											<ImagePlusIcon className="size-[14px]" />
										</span>
										<span className="flex size-[28px] shrink-0 items-center justify-center rounded-[6px] text-muted">
											<SquareSlashIcon className="size-[15px]" />
										</span>

										<span className="mx-1 h-4 w-px shrink-0 bg-white/10" aria-hidden />

										{/* 区 2：执行上下文 */}
										<span className="flex h-[28px] min-w-0 shrink-0 items-center gap-[4px] rounded-[6px] px-[8px] text-[12px] text-muted">
											<GitBranchIcon className="size-[14px] shrink-0" />
											<span className="min-w-0 truncate">main</span>
											<ChevronDownIcon className="h-3 w-3 shrink-0" />
										</span>
										<span className="flex h-[28px] min-w-0 shrink-0 items-center gap-[4px] rounded-[6px] px-[8px] text-[12px] text-muted">
											<ClipboardListIcon className="size-[14px] shrink-0" />
											<span>计划</span>
										</span>
										{/* 最危险的一档：warning 底 + warning 字，一眼能认出 */}
										<span className="flex h-[28px] min-w-0 max-w-full shrink-0 items-center gap-[4px] rounded-[6px] bg-warning/12 px-[8px] text-[12px] text-warning">
											<ShieldOffIcon className="size-[14px] shrink-0" />
											<span className="min-w-0 truncate">完全放行</span>
											<ChevronDownIcon className="h-3 w-3 shrink-0" />
										</span>
									</div>

									{/* 区 3：模型与发送 */}
									<span className="mx-1 h-4 w-px shrink-0 bg-white/10" aria-hidden />
									<span className="flex h-[28px] min-w-[56px] max-w-[256px] shrink items-center gap-[6px] rounded-[6px] bg-elevated/45 px-[8px] text-[12px] text-surface-foreground">
										<SparkleIcon className="size-[14px] shrink-0 text-primary" />
										<span className="min-w-0 truncate">Deepseek-v4.1-flash-02</span>
										<span className="flex h-[17px] shrink-0 items-center gap-[3px] rounded-[4px] bg-primary/15 px-1 text-primary">
											<BrainIcon className="size-[11px]" />
											<span className="text-[10.5px] font-medium leading-none">最高</span>
										</span>
										<ChevronDownIcon className="size-3 shrink-0" />
									</span>

									<span className="flex size-[32px] shrink-0 items-center justify-center rounded-[6px] bg-primary text-primary-foreground">
										<ArrowUpIcon className="size-[16px]" />
									</span>
								</div>
							</div>

							{/* 状态行：一簇安静的数字，带标签；设置入口给足对比度 */}
							<div className="mt-[6px] flex h-[26px] min-w-0 items-center gap-3 px-[4px] text-[12px] text-muted tabular-nums">
								<span className="flex min-w-0 shrink-0 items-center gap-[5px]">
									<FolderIcon className="size-[13px] shrink-0 opacity-75" />
									<span className="max-w-[160px] truncate">EnsoCode</span>
									<ChevronUpIcon className="size-[11px] shrink-0 opacity-45" />
								</span>

								<span className="ml-auto flex min-w-0 items-center gap-[10px]">
									<span className="flex items-center gap-[5px]">
										<CoinsIcon className="size-[13px] shrink-0 opacity-75" />
										<span>15.7M</span>
										<span className="opacity-45">/</span>
										<span>75.2K</span>
									</span>
									<span className="flex items-center gap-[5px]">
										<DatabaseIcon className="size-[13px] shrink-0 opacity-75" />
										<span className="text-faint">缓存</span>
										<span>97%</span>
									</span>
									<span className="flex items-center gap-[5px]">
										<svg viewBox="0 0 12 12" aria-hidden className="size-[12px] shrink-0 -rotate-90">
											<circle cx="6" cy="6" r="4.6" fill="none" stroke="currentColor" strokeOpacity={0.22} strokeWidth={1.6} />
											<circle cx="6" cy="6" r="4.6" fill="none" stroke="currentColor" strokeWidth={1.6} strokeDasharray="9.3 26" strokeLinecap="round" />
										</svg>
										<span className="text-faint">上下文</span>
										<span>16%</span>
									</span>
								</span>

								<span className="mx-1 h-3.5 w-px shrink-0 bg-white/10" aria-hidden />
								<span className="flex size-[24px] shrink-0 items-center justify-center rounded-full text-muted">
									<Settings2Icon className="size-[13px]" />
								</span>
							</div>
						</div>
					</div>
				</section>

				{/* 右侧面板 */}
				<aside className="flex w-[360px] shrink-0 flex-col overflow-hidden rounded-card border border-border bg-surface">
					<div className="flex h-[40px] shrink-0 items-center justify-end gap-0.5 border-b border-line px-2.5">
						<span className="flex size-[26px] items-center justify-center rounded-[6px] text-muted">
							<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden className="size-3.5">
								<polyline points="15 3 21 3 21 9" />
								<polyline points="9 21 3 21 3 15" />
								<line x1="21" x2="14" y1="3" y2="10" />
								<line x1="3" x2="10" y1="21" y2="14" />
							</svg>
						</span>
						<span className="flex size-[26px] items-center justify-center rounded-[6px] text-muted">
							<PlusIcon className="size-[14px]" />
						</span>
					</div>
					<div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
						<p className="text-[14px] text-muted">还没有标签页，新建一个开始使用。</p>
						<span className="flex h-[32px] items-center gap-1.5 rounded-[6px] border border-border bg-panel px-3 text-[13px] font-medium text-surface-foreground">
							<PlusIcon className="size-4" />
							新建标签页
						</span>
					</div>
				</aside>
			</div>
		</div>
	);
}
