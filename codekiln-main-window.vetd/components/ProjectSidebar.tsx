import { ConversationStatus, ExtensionsIcon } from "./BrandIcons";
import {
	ArchiveIcon,
	ChevronDownIcon,
	ChevronsUpDownIcon,
	CirclePlusIcon,
	FolderGit2Icon,
	FolderOpenIcon,
	MonitorIcon,
	PinIcon,
	PlusIcon,
	SearchIcon,
	TextSearchIcon,
} from "./LucideIcons";

/**
 * 会话侧栏 —— 严格对齐 src/renderer/components/chat/Sidebar.tsx：
 * 分段 Tabs(h-36) + 搜索 → 新建任务/扩展 → 项目筛选 chip → 项目分组（项目行 + 其下会话行）→ 页脚。
 * 会话行：min-h-36 / grid-cols-[auto_1fr] / gap-x-2 / py-1.5 pr-2 pl-2 / rounded-md / 13px。
 */
const CHIP =
	"flex h-7 shrink-0 items-center gap-1 rounded-full bg-elevated/50 px-2.5 text-[12px] text-muted";

function SectionLabel({ children }: { children: React.ReactNode }) {
	return (
		<div className="truncate px-2 py-2 text-[11px] font-medium text-muted">{children}</div>
	);
}

function Chip({ label, count, selected }: { label: string; count: number; selected?: boolean }) {
	return (
		<span
			className={`${CHIP} ${selected ? "bg-white/10 font-medium text-surface-foreground" : ""}`}
		>
			{label}
			<span className="text-[11px] tabular-nums opacity-70">{count}</span>
		</span>
	);
}

type Tone = "idle" | "running" | "attention" | "waiting" | "failed" | "unread";

type Row = {
	title: string;
	time: string;
	tone: Tone;
	badge?: string;
	active?: boolean;
};

/** 项目行：IconSlot(FolderOpen/FolderGit2) + 项目名 + hover 才出现的 pin / 新建 */
function ProjectRow({ name, folded }: { name: string; folded?: boolean }) {
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

function ConversationRow({ row }: { row: Row }) {
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
				{row.badge && (
					<span className="shrink-0 rounded-[4px] border border-border px-1 text-[11px] text-muted">
						{row.badge}
					</span>
				)}
				<span className="shrink-0 text-[11px] tabular-nums text-faint">{row.time}</span>
			</div>
		</div>
	);
}

/** Active 分组：当前正在运行的会话（Sidebar 的 t('Active')） */
const ACTIVE: Row[] = [
	{ title: "从现有代码还原UI设计图", time: "现在", tone: "running", active: true },
	{ title: "项目助手代审模型", time: "现在", tone: "running" },
];

/** 项目 → 其下会话（真实侧栏是两级嵌套，不是扁平列表） */
const PROJECTS: { name: string; folded?: boolean; rows: Row[] }[] = [
	{
		name: "EnsoCode",
		rows: [
			{ title: "从现有代码还原UI设计图", time: "现在", tone: "running" },
			{ title: "项目助手代审模型", time: "50分钟前", tone: "attention" },
			{ title: "llmdoc 知识地图插件", time: "1小时前", tone: "waiting", badge: "@1" },
			{ title: "设计模式未创建画布而直接改代码", time: "1小时前", tone: "idle" },
			{ title: "个人版本发布", time: "4小时前", tone: "unread" },
		],
	},
	{
		name: "yusangfang",
		folded: true,
		rows: [],
	},
	{
		name: "Moonyy",
		rows: [
			{ title: "Moonyy设计稿还原集成", time: "昨天", tone: "failed", badge: "@1" },
		],
	},
];

export function ProjectSidebar() {
	return (
		<aside className="flex w-[264px] shrink-0 flex-col overflow-hidden rounded-card border border-border bg-shell">
			{/* 项目 / 对话 分段 + 全局搜索 */}
			<div className="flex shrink-0 items-center gap-2 px-[12px] pt-[12px]">
				<div className="flex h-[36px] min-w-0 flex-1 items-center rounded-[8px] bg-elevated p-[3px]">
					<span className="flex h-full flex-1 items-center justify-center rounded-[6px] bg-panel text-[13px] font-medium text-surface-foreground">
						项目
					</span>
					<span className="flex h-full flex-1 items-center justify-center text-[13px] text-muted">
						对话
					</span>
				</div>
				<button
					type="button"
					aria-label="搜索全部"
					className="flex size-[36px] shrink-0 items-center justify-center rounded-[6px] bg-elevated text-muted"
				>
					<SearchIcon className="size-4" />
				</button>
			</div>

			{/* 新建任务 / 扩展 */}
			<button
				type="button"
				className="mx-3 mt-3 flex h-[36px] shrink-0 items-center gap-2 rounded-[6px] px-1.5 text-left text-[14px] text-surface-foreground hover:bg-white/4"
			>
				<CirclePlusIcon className="size-[17px] shrink-0 text-primary" />
				<span>新建任务</span>
				<span className="ml-auto rounded border border-border px-1 text-[11px] text-muted">
					⌘N
				</span>
			</button>
			<button
				type="button"
				className="mx-3 mt-1 flex h-[36px] shrink-0 items-center gap-2 rounded-[6px] px-1.5 text-left text-[14px] text-surface-foreground hover:bg-white/4"
			>
				<ExtensionsIcon className="size-[17px] shrink-0" />
				<span>扩展</span>
			</button>

			{/* 项目标题行：全部折叠/展开 + 添加项目或分组 */}
			<div className="mt-4 flex shrink-0 items-center gap-1 px-4 text-[12px] text-muted">
				<span className="min-w-0 flex-1 truncate">项目</span>
				<ChevronsUpDownIcon className="size-3.5" />
				<PlusIcon className="size-4" />
			</div>

			{/* 分组 chip */}
			<div className="flex shrink-0 items-center gap-1 px-3 pt-2 pb-1">
				<div className="flex min-w-0 flex-1 gap-1 overflow-hidden">
					<Chip label="全部" count={8} selected />
					<Chip label="工作" count={5} />
					<Chip label="个人" count={2} />
				</div>
				<TextSearchIcon className="size-3.5 shrink-0 text-muted" />
			</div>

			{/* 列表：Active 分组 + 项目分组（两级嵌套） */}
			<div className="min-h-0 flex-1 space-y-2 overflow-hidden px-3 pt-1 pb-2">
				<div>
					<SectionLabel>运行中</SectionLabel>
					<div className="flex flex-col gap-y-0.5">
						{ACTIVE.map((row) => (
							<ConversationRow key={row.title} row={row} />
						))}
					</div>
				</div>

				<div className="flex flex-col gap-y-0.5">
					{PROJECTS.map((project) => (
						<div key={project.name}>
							<ProjectRow name={project.name} folded={project.folded} />
							{!project.folded && project.rows.length > 0 && (
								<div className="flex flex-col gap-y-0.5">
									{project.rows.map((row) => (
										<ConversationRow key={row.title} row={row} />
									))}
								</div>
							)}
						</div>
					))}
					<button
						type="button"
						className="mt-1 flex h-[28px] w-full items-center justify-center rounded-[8px] py-1 text-[11px] text-muted hover:bg-white/4 hover:text-surface-foreground"
					>
						展开其余 103 条
					</button>
				</div>
			</div>

			{/* 页脚：本机 + 归档 */}
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
