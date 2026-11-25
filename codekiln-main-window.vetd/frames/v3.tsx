export const frame = { width: 1440, height: 900, title: "改版稿 v3 · 三段式输入区" };

import { AskCodeKilnIcon, ConversationStatus, ThinkingSparkIcon } from "../components/BrandIcons";
import { ExtensionsIcon } from "../components/BrandIcons";
import { CommandTrayV3 } from "../components/CommandTrayV3";
import {
	ArchiveIcon,
	ArrowUpIcon,
	BrainIcon,
	ChevronDownIcon,
	ChevronRightIcon,
	ChevronsUpDownIcon,
	CirclePlusIcon,
	ClipboardListIcon,
	CoinsIcon,
	DatabaseIcon,
	FolderIcon,
	FolderGit2Icon,
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
	XIcon,
	FileCodeIcon,
	FilesIcon,
} from "../components/LucideIcons";
import {
	AskCodeKilnIcon as EnsoIcon,
	CodeWorkspaceIcon,
	DesignGalleryIcon,
	ImageStudioIcon,
	SettingsGearIcon,
} from "../components/BrandIcons";

/**
 * v3 改版 —— 改结构，不改皮肤。
 *
 * 核心判断：现有输入区把「写什么」和「怎么执行」压进同一条 28px 高的工具条，
 * 状态行再作为第二行 12px 小字，于是三件事（写 / 跑 / 看）挤在一个视觉层级里。
 *
 * v3 把它们拆成三段，各占一个清晰的位置：
 *   1. 写作区（大）—— 唯一的高光对象，占满宽度，行高 22px
 *   2. 执行带（中）—— 权限/分支/计划 收进一枚"执行胶囊"，模型单独靠右
 *   3. 观测带（小）—— token/缓存/上下文 变成可读的迷你条，不再是一串数字
 */

const COL = "mx-auto w-full max-w-[880px] px-[24px]";

/* ── 左轨：只在选中项上给一根贴着图标轨的短竖条 ── */
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
				active || brand ? "text-primary" : "text-muted hover:text-surface-foreground"
			}`}
		>
			{active && (
				<span className="absolute top-1/2 -left-[10px] h-5 w-[2px] -translate-y-1/2 rounded-full bg-primary" />
			)}
			{children}
		</button>
	);
}

function AppRail() {
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
			<span className="flex min-h-[24px] w-[44px] items-center justify-center gap-[3px] text-[11px] text-muted tabular-nums">
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

/* ── 侧栏 ── */
type Tone = "idle" | "running" | "attention" | "waiting" | "failed" | "unread";
type Row = { title: string; time: string; tone: Tone; asks?: number; active?: boolean };

function RowItem({ row }: { row: Row }) {
	return (
		<div
			className={`grid min-h-[34px] cursor-pointer grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2 rounded-[6px] py-1.5 pr-2 pl-2 text-[13px] ${
				row.active
					? "bg-white/8 font-medium text-surface-foreground"
					: "text-muted hover:bg-white/4"
			}`}
		>
			<ConversationStatus tone={row.tone} active={row.active} />
			<div className="flex min-w-0 items-center gap-2">
				<span className="min-w-0 flex-1 truncate">{row.title}</span>
				{row.asks ? (
					<span className="flex shrink-0 gap-[3px] text-warning">
						<span className="size-[3px] rounded-full bg-current" />
						<span className="size-[3px] rounded-full bg-current" />
					</span>
				) : null}
				<span className="shrink-0 text-[11px] text-muted tabular-nums">{row.time}</span>
			</div>
		</div>
	);
}

const ACTIVE: Row[] = [
	{ title: "从现有代码还原UI设计图", time: "现在", tone: "running", active: true },
	{ title: "项目助手代审模型", time: "现在", tone: "running" },
];
const PROJECTS: { name: string; folded?: boolean; rows: Row[] }[] = [
	{
		name: "EnsoCode",
		rows: [
			{ title: "从现有代码还原UI设计图", time: "现在", tone: "running" },
			{ title: "项目助手代审模型", time: "50分钟前", tone: "attention" },
			{ title: "llmdoc 知识地图插件", time: "1小时前", tone: "waiting", asks: 1 },
			{ title: "设计模式未创建画布而直接改代码", time: "1小时前", tone: "idle" },
		],
	},
	{ name: "yusangfang", folded: true, rows: [] },
	{ name: "Moonyy", rows: [{ title: "Moonyy设计稿还原集成", time: "昨天", tone: "failed", asks: 1 }] },
];

function Sidebar() {
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
					className="flex size-[32px] shrink-0 items-center justify-center rounded-[6px] text-muted"
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
				<span className="ml-auto rounded border border-border px-1 text-[11px] text-muted">⌘N</span>
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
						全部<span className="text-[11px] tabular-nums opacity-70">8</span>
					</span>
					<span className="flex h-7 shrink-0 items-center gap-1 rounded-full bg-elevated/50 px-2.5 text-[12px] text-muted">
						工作<span className="text-[11px] tabular-nums opacity-70">5</span>
					</span>
					<span className="flex h-7 shrink-0 items-center gap-1 rounded-full bg-elevated/50 px-2.5 text-[12px] text-muted">
						个人<span className="text-[11px] tabular-nums opacity-70">2</span>
					</span>
				</div>
				<TextSearchIcon className="size-3.5 shrink-0 text-muted" />
			</div>

			<div className="min-h-0 flex-1 space-y-2 overflow-hidden px-3 pt-1 pb-2">
				<div>
					<div className="truncate px-2 py-2 text-[11px] font-medium text-muted">运行中</div>
					<div className="flex flex-col gap-y-0.5">
						{ACTIVE.map((r) => (
							<RowItem key={r.title} row={r} />
						))}
					</div>
				</div>
				<div className="flex flex-col gap-y-0.5">
					{PROJECTS.map((p) => (
						<div key={p.name}>
							<div className="group flex h-[34px] w-full items-center gap-1.5 rounded-[6px] px-2 hover:bg-white/4">
								<span className="flex size-4 shrink-0 items-center justify-center text-muted">
									{p.folded ? (
										<FolderGit2Icon className="size-[14px]" />
									) : (
										<FolderOpenIcon className="size-[14px]" />
									)}
								</span>
								<span className="min-w-0 flex-1 truncate text-[14px] font-medium text-surface-foreground">
									{p.name}
								</span>
								<PinIcon className="size-3.5 shrink-0 text-muted opacity-0 group-hover:opacity-100" />
								<PlusIcon className="size-3.5 shrink-0 text-muted opacity-0 group-hover:opacity-100" />
							</div>
							{!p.folded && p.rows.length > 0 && (
								<div className="flex flex-col gap-y-0.5 pl-3">
									{p.rows.map((r) => (
										<RowItem key={r.title} row={r} />
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

/* ── 会话区 ── */
function ToolRow({
	icon: Icon,
	kind,
	summary,
	failed,
}: {
	icon: (p: { className?: string }) => React.ReactElement;
	kind: string;
	summary: string;
	failed?: boolean;
}) {
	return (
		<div className="flex items-center gap-2 py-[3px]">
			<span
				className={`inline-flex size-[20px] shrink-0 items-center justify-center rounded-[5px] ${
					failed ? "text-destructive" : "text-muted"
				}`}
			>
				<Icon className="size-[13px] shrink-0" />
			</span>
			<span className="shrink-0 text-[12px] font-medium text-surface-foreground/75">{kind}</span>
			<span className={`min-w-0 flex-1 truncate font-mono text-[11.5px] ${failed ? "text-destructive/80" : "text-muted"}`}>
				{summary}
			</span>
		</div>
	);
}

/* ── 三段式输入区：本稿的核心改动 ─────────────────────────────── */
function ComposerV3() {
	return (
		<div className={COL}>
			{/* 执行带：先看清"在什么权限、哪个分支下写"，再动笔 */}
			<div className="mb-2 flex items-center gap-2">
				<span className="flex h-[30px] min-w-0 items-center gap-1.5 rounded-full bg-elevated/60 pr-2 pl-2.5 text-[12px]">
					<GitBranchIcon className="size-[13px] shrink-0 text-muted" />
					<span className="shrink-0 text-surface-foreground/85">main</span>
					<span className="mx-0.5 h-3 w-px shrink-0 bg-white/12" aria-hidden />
					<ClipboardListIcon className="size-[13px] shrink-0 text-muted" />
					<span className="shrink-0 text-muted">计划</span>
					<span className="mx-0.5 h-3 w-px shrink-0 bg-white/12" aria-hidden />
					<ShieldOffIcon className="size-[13px] shrink-0 text-warning" />
					<span className="shrink-0 font-medium text-warning">完全放行</span>
					<ChevronDownIcon className="size-3 shrink-0 text-muted" />
				</span>
			</div>

			{/* 写作区：无边框大输入，靠底色和周围留白立住，不用方框包 */}
			<div className="relative rounded-[14px] bg-elevated/45 px-4 pt-3 pb-2">
				<CommandTrayV3 />
				<div className="min-h-[44px] font-mono text-[14px] leading-[22px] text-surface-foreground">
					/
				</div>

				{/* 输入区内只有：附件 + 模型 + 发送 */}
				<div className="flex items-end justify-between gap-2 pt-1">
					<div className="flex items-center gap-1">
						<span className="flex size-[28px] items-center justify-center rounded-[6px] text-muted">
							<ImagePlusIcon className="size-[15px]" />
						</span>
						<span className="flex size-[28px] items-center justify-center rounded-[6px] text-muted">
							<SquareSlashIcon className="size-[15px]" />
						</span>
					</div>

					<div className="flex min-w-0 items-center gap-2">
						<span className="flex h-[28px] min-w-0 items-center gap-1.5 text-[12px] text-muted">
							<SparkleIcon className="size-[13px] shrink-0 text-primary" />
							<span className="min-w-0 truncate">Deepseek-v4.1-flash-02</span>
							<span className="flex h-[17px] shrink-0 items-center gap-[3px] rounded-[4px] bg-primary/15 px-1 text-primary">
								<BrainIcon className="size-[10px]" />
								<span className="text-[10px] font-medium leading-none">最高</span>
							</span>
							<ChevronDownIcon className="size-3 shrink-0" />
						</span>
						<span className="flex size-[30px] shrink-0 items-center justify-center rounded-[8px] bg-primary text-primary-foreground">
							<ArrowUpIcon className="size-[15px]" />
						</span>
					</div>
				</div>
			</div>

			{/* 运行带：正在跑的事，紧贴输入框下方 */}
			<div className="mt-2 flex items-center gap-1.5">
				<span className="flex h-[26px] items-center gap-1.5 rounded-full bg-destructive/10 px-2.5 text-[11.5px] text-destructive">
					<TerminalIcon className="size-[12px] shrink-0" />
					1 失败
				</span>
				<span className="flex h-[26px] items-center gap-1.5 rounded-full bg-elevated/40 px-2.5 text-[11.5px] text-muted">
					<LoaderCircleIcon className="size-[12px] shrink-0 animate-spin text-primary" />
					Agent 1
				</span>
				<span className="flex h-[26px] items-center gap-2 rounded-full bg-elevated/40 px-2.5 text-[11.5px] text-muted">
					<LoaderCircleIcon className="size-[12px] shrink-0 animate-spin text-primary" />
					进度
					<span className="h-[3px] w-7 overflow-hidden rounded-full bg-white/12">
						<span className="block h-full w-2/3 rounded-full bg-primary" />
					</span>
				</span>
			</div>

			{/* 观测带：三个可读的小条，不是一串等重数字 */}
			<div className="mt-2 flex items-center gap-4 px-1 text-[11.5px] text-muted tabular-nums">
				<span className="flex min-w-0 items-center gap-1.5">
					<FolderIcon className="size-[12px] shrink-0 opacity-70" />
					<span className="max-w-[140px] truncate">EnsoCode</span>
				</span>

				<span className="ml-auto flex items-center gap-3">
					{/* token：条 + 数字，条长代表上下文占比 */}
					<span className="flex items-center gap-1.5">
						<CoinsIcon className="size-[12px] shrink-0 opacity-70" />
						<span>15.7M</span>
					</span>
					<span className="flex items-center gap-1.5">
						<DatabaseIcon className="size-[12px] shrink-0 opacity-70" />
						<span className="h-[3px] w-8 overflow-hidden rounded-full bg-white/10">
							<span className="block h-full w-[97%] rounded-full bg-success" />
						</span>
						<span className="text-surface-foreground/70">97%</span>
					</span>
					<span className="flex items-center gap-1.5">
						<span className="h-[3px] w-8 overflow-hidden rounded-full bg-white/10">
							<span className="block h-full w-[16%] rounded-full bg-primary" />
						</span>
						<span>16%</span>
					</span>
					<span className="flex size-[20px] items-center justify-center rounded-full text-muted">
						<Settings2Icon className="size-[12px]" />
					</span>
				</span>
			</div>
		</div>
	);
}

export default function RedesignV3() {
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
				<AppRail />
				<Sidebar />

				<section className="relative flex min-w-0 flex-1 flex-col overflow-hidden rounded-card border border-border bg-surface">
					<div className="flex h-[40px] shrink-0 items-center gap-[4px] border-b border-line px-2.5">
						<span className="flex h-[28px] items-center gap-[6px] rounded-[6px] bg-elevated px-[9px] text-[12px] font-medium text-surface-foreground">
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

					<div className="flex min-h-0 flex-1 flex-col">
						<div className={`${COL} flex min-h-0 flex-1 flex-col justify-end gap-3 pt-5 pb-4`}>
							<div className="flex justify-end">
								<div className="max-w-[86%] rounded-[10px] bg-elevated px-4 py-2.5 text-[14px] leading-[24px]">
									更具当前代码，帮我先把 ui设计图还原出来
								</div>
							</div>

							<div className="flex items-center gap-1.5 py-0.5 text-[12.5px] text-muted">
								<ChevronRightIcon className="size-3.5 shrink-0" />
								<ThinkingSparkIcon className="size-[12px] shrink-0" />
								<span className="font-medium">思考</span>
								<span className="tabular-nums opacity-70">· 5.7s</span>
							</div>

							<div className="flex flex-col">
								<ToolRow icon={TerminalIcon} kind="终端" summary="sed -n '1,160p' shared.css" />
								<ToolRow icon={WrenchIcon} kind="computer" summary="截图主窗口" failed />
								<ToolRow icon={WrenchIcon} kind="computer" summary="desktop.windows() → 10" />
								<ToolRow icon={FolderOpenIcon} kind="读取" summary="Composer.tsx" />
							</div>

							<div className="text-[14px] leading-[1.75] text-surface-foreground">
								<p className="my-2 first:mt-0">
									已按代码还原主窗口。下面是要点，逐项都能在源码里对上。
								</p>
								<h3 className="mt-3 mb-1.5 text-[14px] font-semibold">图标来源</h3>
								<ul className="my-2 list-disc space-y-1 pl-5 marker:text-muted">
									<li>
										图标轨与状态点走{" "}
										<code className="rounded-[4px] bg-elevated/70 px-1 py-px font-mono text-[11px]">
											NavIcons.tsx
										</code>{" "}
										自绘 SVG
									</li>
									<li>
										其余走{" "}
										<code className="rounded-[4px] bg-elevated/70 px-1 py-px font-mono text-[11px]">
											lucide-react
										</code>{" "}
										原始几何
									</li>
								</ul>
							</div>

							<div className="flex items-center gap-2 py-0.5 text-[12.5px]">
								<AskCodeKilnIcon className="size-[13px] text-primary" />
								<span className="text-surface-foreground/75">消化 echo 的运行结果</span>
								<span className="text-muted tabular-nums">· 4 秒</span>
							</div>
						</div>
					</div>

					<div className="shrink-0 pb-3">
						<ComposerV3 />
					</div>
				</section>

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
