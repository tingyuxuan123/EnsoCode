import {
	ChevronRightIcon,
	ClipboardListIcon,
	CornerDownLeftIcon,
	ImagePlusIcon,
	Minimize2Icon,
	PuzzleIcon,
	SparklesIcon,
	SquareSlashIcon,
	TargetIcon,
	TerminalIcon,
	XIcon,
} from "./LucideIcons";

/**
 * `/` 命令面板 v3 —— 数据与结构对齐 composerCommands.ts：
 *  - 三组：bundled/prompt(系统内置) / 会话命令 / /skill:* 项目技能
 *  - 每项：ComposerCommandIcon + 名称 + 类型标签
 *  - 选中项预览：标题 / 描述 / usage / options / 填入按钮
 *  - footer：↑↓ 选择 · ↵ 填入 · Esc 关闭
 *
 * v3 的视觉语言（与输入区三段式一致）：
 *  1. 面板不是一个"浮起来的盒子"，而是从写作面向上生长出来的一块 —— 共用 14px 圆角与 elevated 底色。
 *  2. 左栏不再逐行高亮整条，只用「名称变亮 + 左侧一根短竖条」标记光标位置。
 *  3. 分组之间只用留白和一行 11px 标签分开，不画分隔线。
 *  4. 右栏是"这张卡片的说明书"：大标题、一句话、usage chip、可选参数、填入键。
 */

type Kind = "system" | "session" | "skill";

type Item = {
	kind: Kind;
	label: string;
	code?: string;
	icon: "vetta" | "image" | "plugin" | "goal" | "compact" | "plan" | "slash";
	tag?: string;
};

const SYSTEM: Item[] = [
	{ kind: "system", label: "Vetta 设计", code: "/skill:vetta-ui-design", icon: "vetta" },
	{ kind: "system", label: "图像生成", code: "/image", icon: "image", tag: "能力" },
	{ kind: "system", label: "制作插件", code: "/plugin", icon: "plugin", tag: "能力" },
];

const SESSION: Item[] = [
	{ kind: "session", label: "设定会话目标", code: "/goal", icon: "goal", tag: "目标" },
	{ kind: "session", label: "压缩上下文", code: "/compact", icon: "compact", tag: "上下文" },
	{ kind: "session", label: "进入计划模式", code: "/plan", icon: "plan", tag: "计划" },
];

const SKILLS: Item[] = [
	{ kind: "skill", label: "diffs", code: "/skill:diffs", icon: "slash" },
	{ kind: "skill", label: "enso-cdp", code: "/skill:enso-cdp", icon: "slash" },
	{ kind: "skill", label: "project-knowledge", code: "/skill:project-knowledge", icon: "slash" },
];

function CmdIcon({ icon }: { icon: Item["icon"] }) {
	if (icon === "vetta") {
		return (
			<span className="grid size-[18px] shrink-0 place-items-center">
				<svg viewBox="0 0 20 20" aria-hidden className="size-[16px]">
					<path
						d="M4 5.5 8.2 15 10 10.4 11.8 15 16 5.5"
						fill="none"
						stroke="currentColor"
						strokeWidth={2.1}
						strokeLinecap="round"
						strokeLinejoin="round"
						className="text-primary"
					/>
					<circle cx="10" cy="7" r="1.9" className="fill-warning" />
				</svg>
			</span>
		);
	}
	const c = "size-[15px] shrink-0";
	if (icon === "image") return <ImagePlusIcon className={`${c} text-info`} />;
	if (icon === "plugin") return <PuzzleIcon className={`${c} text-warning`} />;
	if (icon === "goal") return <TargetIcon className={`${c} text-muted`} />;
	if (icon === "compact") return <Minimize2Icon className={`${c} text-muted`} />;
	if (icon === "plan") return <ClipboardListIcon className={`${c} text-muted`} />;
	return <SquareSlashIcon className={`${c} text-muted`} />;
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<div>
			<div className="px-2 pb-0.5 text-[10.5px] font-medium tracking-wide text-faint uppercase">
				{label}
			</div>
			<div className="flex flex-col">{children}</div>
		</div>
	);
}

function Row({ item, selected }: { item: Item; selected?: boolean }) {
	return (
		<div
			className={`relative flex h-[30px] items-center gap-2 rounded-[6px] px-2 ${
				selected ? "bg-white/6" : ""
			}`}
		>
			{selected && (
				<span className="absolute top-1/2 left-0 h-3.5 w-[2px] -translate-y-1/2 rounded-full bg-primary" />
			)}
			<CmdIcon icon={item.icon} />
			<span
				className={`min-w-0 flex-1 truncate text-[13px] ${
					selected ? "font-medium text-surface-foreground" : "text-surface-foreground/75"
				}`}
			>
				{item.label}
			</span>
			{item.tag && (
				<span className="shrink-0 rounded-[3px] bg-white/6 px-1.5 py-px text-[10px] text-muted">
					{item.tag}
				</span>
			)}
			{selected && <ChevronRightIcon className="size-3 shrink-0 text-primary" />}
		</div>
	);
}

export function CommandTrayV3() {
	return (
		<section className="absolute inset-x-0 bottom-[calc(100%+6px)] z-20 flex h-[320px] flex-col overflow-hidden rounded-[14px] border border-border bg-panel shadow-[0_16px_48px_-20px_rgb(0_0_0/0.85)]">
			{/* 头部：不画分隔线，靠留白 */}
			<header className="flex h-[42px] shrink-0 items-center justify-between gap-3 px-4">
				<div className="flex min-w-0 items-center gap-2">
					<TerminalIcon className="size-[14px] shrink-0 text-muted" />
					<span className="truncate text-[12.5px] font-semibold">命令与技能</span>
					<span className="shrink-0 rounded-[4px] bg-white/6 px-1.5 py-px text-[10.5px] text-muted tabular-nums">
						10
					</span>
				</div>
				<span className="grid size-6 place-items-center rounded-[5px] text-muted">
					<XIcon className="size-[13px]" />
				</span>
			</header>

			<div className="grid min-h-0 flex-1 grid-cols-[minmax(0,44fr)_minmax(0,56fr)]">
				{/* 左：分组列表 */}
				<div className="relative min-h-0">
				<div className="h-full space-y-2 overflow-y-auto px-2 pt-1 pb-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
					<Group label="系统内置">
						{SYSTEM.map((i) => (
							<Row key={i.label} item={i} selected={i.icon === "vetta"} />
						))}
					</Group>
					<Group label="会话命令">
						{SESSION.map((i) => (
							<Row key={i.label} item={i} />
						))}
					</Group>
					<Group label="项目技能">
						{SKILLS.map((i) => (
							<Row key={i.label} item={i} />
						))}
					</Group>
				</div>
				{/* 滚动边界：一根细线，代替渐变遮罩 */}
				<div className="pointer-events-none absolute inset-x-2 bottom-0 border-t border-border/60" aria-hidden />
				</div>

				{/* 右：说明书式预览 */}
				<div className="flex min-h-0 flex-col gap-3 overflow-y-auto bg-surface/50 p-4">
					<div className="flex items-start gap-2.5">
						<span className="mt-0.5 grid size-[26px] shrink-0 place-items-center rounded-[7px] bg-primary/12">
							<svg viewBox="0 0 20 20" aria-hidden className="size-[15px]">
								<path
									d="M4 5.5 8.2 15 10 10.4 11.8 15 16 5.5"
									fill="none"
									stroke="currentColor"
									strokeWidth={2.1}
									strokeLinecap="round"
									strokeLinejoin="round"
									className="text-primary"
								/>
							</svg>
						</span>
						<div className="min-w-0">
							<h3 className="text-[15px] leading-tight font-semibold">Vetta 设计</h3>
							<p className="mt-1 text-[12px] leading-relaxed text-muted">
								在 Vetta 画布上制作可编辑的界面、幻灯片与交互原型。
							</p>
						</div>
					</div>

					<div className="rounded-[8px] bg-elevated/50 px-2.5 py-2">
						<div className="mb-1 text-[10.5px] text-faint">用法</div>
						<code className="font-mono text-[11.5px] text-surface-foreground">
							/skill:vetta-ui-design
						</code>
					</div>

					<div className="flex flex-wrap gap-1">
						<span className="rounded-[4px] bg-white/5 px-1.5 py-0.5 text-[10.5px] text-muted">
							技能
						</span>
						<span className="rounded-[4px] bg-white/5 px-1.5 py-0.5 text-[10.5px] text-muted">
							可编辑画布
						</span>
						<span className="rounded-[4px] bg-white/5 px-1.5 py-0.5 text-[10.5px] text-muted">
							导出 PDF
						</span>
					</div>

					<div className="mt-auto flex items-center justify-between gap-2">
						<span className="text-[10.5px] text-faint">选中后填入输入框</span>
						<span className="inline-flex h-[28px] items-center gap-1.5 rounded-[6px] bg-primary px-2.5 text-[12px] font-medium text-primary-foreground">
							填入
							<CornerDownLeftIcon className="size-3" />
						</span>
					</div>
				</div>
			</div>

			{/* footer：只留最必要的三个键 */}
			<footer className="flex h-[32px] shrink-0 items-center gap-3 border-t border-border/50 px-4 text-[11px] text-muted">
				<span className="flex items-center gap-1">
					<kbd className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[3px] bg-white/8 px-1 font-sans text-[10.5px]">
						↑↓
					</kbd>
					选择
				</span>
				<span className="flex items-center gap-1">
					<kbd className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[3px] bg-white/8 px-1 font-sans text-[10.5px]">
						↵
					</kbd>
					填入
				</span>
				<span className="flex items-center gap-1">
					<kbd className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[3px] bg-white/8 px-1 font-sans text-[10.5px]">
						Esc
					</kbd>
					关闭
				</span>
				<span className="ml-auto flex items-center gap-1 text-[10.5px] text-faint">
					<SparklesIcon className="size-[11px]" />
					输入关键词可筛选
				</span>
			</footer>
		</section>
	);
}
