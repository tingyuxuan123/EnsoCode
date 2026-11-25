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
 * `/` 命令面板 —— 结构对齐 src/renderer/components/chat/ComposerCommandTray.tsx：
 * header(46px) / 双栏 grid 46fr:54fr / 左列表分组 / 右预览 / footer(36px) Kbd 提示。
 *
 * 美化点（不动信息量）：
 * 1. 左栏选中态从 bg-brand/12 改为"左侧 2px 强调条 + 极淡底"，
 *    扫读时竖条比整块淡底更容易定位光标所在行。
 * 2. 分组标题加一条延伸到右边缘的细线，让三组有段落感而不是三堆文字。
 * 3. 右栏预览的标题与描述之间加 1px 分隔，用法字段从"边框盒"改为"行内代码块"，
 *    减少一个方框，层级靠间距和字重区分。
 * 4. footer 的 Kbd 提示合并为一组，右侧留白让"填入输入框"动作更靠视觉重心。
 */

type Item = {
	kind: "builtin" | "command" | "skill";
	name: string;
	sub?: string;
	icon: "vetta" | "image" | "puzzle" | "target" | "compact" | "plan" | "spark";
};

const SYSTEM: Item[] = [
	{ kind: "builtin", name: "Vetta 设计", sub: "技能", icon: "vetta" },
	{ kind: "builtin", name: "图像生成", sub: "能力", icon: "image" },
	{ kind: "builtin", name: "制作插件", sub: "能力", icon: "puzzle" },
];

const SESSION: Item[] = [
	{ kind: "command", name: "/goal", sub: "设定会话目标", icon: "target" },
	{ kind: "command", name: "/compact", sub: "压缩上下文", icon: "compact" },
	{ kind: "command", name: "/plan", sub: "进入计划模式", icon: "plan" },
];

const SKILLS: Item[] = [
	{ kind: "skill", name: "/skill:diffs", icon: "spark" },
	{ kind: "skill", name: "/skill:enso-cdp", icon: "spark" },
	{ kind: "skill", name: "/skill:project-knowledge", icon: "spark" },
];

function CmdIcon({ icon }: { icon: Item["icon"] }) {
	if (icon === "vetta") {
		/* Vetta 标记：品牌色双形，取自 composerCommands 的 vettaMark 语义 */
		return (
			<span className="grid size-[20px] shrink-0 place-items-center">
				<svg viewBox="0 0 20 20" aria-hidden className="size-[18px]">
					<path d="M4 5.5 8.2 15 10 10.4 11.8 15 16 5.5" fill="none" stroke="#a78bfa" strokeWidth={2.1} strokeLinecap="round" strokeLinejoin="round" />
					<circle cx="10" cy="7" r="1.9" fill="#fbbf24" />
				</svg>
			</span>
		);
	}
	const cls = "size-[16px] shrink-0";
	if (icon === "image") return <ImagePlusIcon className={`${cls} text-info`} />;
	if (icon === "puzzle") return <PuzzleIcon className={`${cls} text-warning`} />;
	if (icon === "target") return <TargetIcon className={`${cls} text-muted`} />;
	if (icon === "compact") return <Minimize2Icon className={`${cls} text-muted`} />;
	if (icon === "plan") return <ClipboardListIcon className={`${cls} text-muted`} />;
	if (icon === "spark") return <SparklesIcon className={`${cls} text-muted`} />;
	return <SquareSlashIcon className={`${cls} text-muted`} />;
}

function GroupHeader({ name }: { name: string }) {
	return (
		<div className="flex items-center gap-2 px-2.5 pt-1 pb-0.5 h-[18px]">
			<span className="shrink-0 text-[11px] font-medium text-muted">{name}</span>
			<span className="h-px flex-1 bg-white/8" aria-hidden />
		</div>
	);
}

function Row({ item, selected }: { item: Item; selected?: boolean }) {
	return (
		<div
			className={`relative flex min-h-[26px] w-full items-center gap-2 rounded-[7px] px-2.5 ${
				selected ? "bg-primary/8" : ""
			}`}
		>
			{selected && (
				<span className="absolute top-1/2 left-0 h-4 w-[2px] -translate-y-1/2 rounded-full bg-primary" />
			)}
			<CmdIcon icon={item.icon} />
			{item.kind === "builtin" ? (
				<span className="min-w-0 flex-1 truncate text-[13px] font-medium text-surface-foreground">
					{item.name}
				</span>
			) : (
				<code className="min-w-0 flex-1 truncate font-mono text-[12px] font-medium text-surface-foreground">
					{item.name}
				</code>
			)}
			{item.sub && (
				<span className="shrink-0 truncate text-[11px] text-muted">
					{item.kind === "builtin" ? item.sub : ""}
				</span>
			)}
			{item.kind === "builtin" && (
				<ChevronRightIcon className={`size-3.5 shrink-0 text-muted ${selected ? "" : "invisible"}`} />
			)}
		</div>
	);
}

function Kbd({ children }: { children: React.ReactNode }) {
	return (
		<kbd className="inline-flex h-[22px] min-w-[22px] items-center justify-center gap-1 rounded-[4px] border border-line bg-elevated/50 px-[5px] font-sans text-[11px] font-medium text-muted">
			{children}
		</kbd>
	);
}

export function CommandTray() {
	return (
		<section className="absolute inset-x-0 bottom-[calc(100%-1px)] z-10 flex h-[384px] min-w-0 flex-col overflow-hidden rounded-t-[12px] border border-b-0 border-border bg-panel text-surface-foreground shadow-[0_-8px_32px_-16px_rgb(0_0_0/0.7)]">
			{/* header 46px */}
			<header className="flex h-[46px] shrink-0 items-center justify-between gap-3 px-4">
				<div className="flex min-w-0 items-center gap-2">
					<TerminalIcon className="size-[15px] shrink-0 text-muted" />
					<span className="truncate text-[13px] font-semibold">命令与技能</span>
				</div>
				<div className="flex shrink-0 items-center gap-2 text-[12px] text-muted">
					<span className="tabular-nums">10 个结果</span>
					<span className="grid size-7 place-items-center rounded-[6px]">
						<XIcon className="size-[15px]" />
					</span>
				</div>
			</header>

			{/* 双栏 46 : 54 */}
			<div className="grid min-h-0 flex-1 grid-cols-[42fr_58fr] border-y border-border/75">
				{/* 左：分组列表 */}
				<div className="min-h-0 overflow-y-auto px-2 py-1">
					<div className="mb-0">
						<GroupHeader name="系统内置" />
						<div className="flex flex-col gap-y-0.5">
							{SYSTEM.map((item) => (
								<Row key={item.name} item={item} selected={item.name === "Vetta 设计"} />
							))}
						</div>
					</div>
					<div className="mb-0">
						<GroupHeader name="会话命令" />
						<div className="flex flex-col gap-y-0.5">
							{SESSION.map((item) => (
								<Row key={item.name} item={item} />
							))}
						</div>
					</div>
					<div>
						<GroupHeader name="项目技能" />
						<div className="flex flex-col gap-y-0.5">
							{SKILLS.map((item) => (
								<Row key={item.name} item={item} />
							))}
						</div>
					</div>
				</div>

				{/* 右：预览 */}
				<div className="flex min-h-0 min-w-0 flex-col gap-3 overflow-y-auto border-l border-border/75 bg-surface/60 p-4">
					<div>
						<h3 className="min-w-0 text-[18px] leading-tight font-semibold wrap-anywhere">
							Vetta 设计
						</h3>
						<p className="mt-2 text-[13px] leading-relaxed text-muted">
							在 Vetta 画布上制作可编辑的界面、幻灯片和交互原型。
						</p>
					</div>

					<div className="h-px bg-white/8" aria-hidden />

					{/* 用法：行内代码块，不再套一个边框盒 */}
					<div className="flex items-baseline gap-2 text-[12px]">
						<span className="shrink-0 text-faint">用法</span>
						<code className="rounded-[5px] bg-elevated/70 px-1.5 py-0.5 font-mono text-[11.5px] text-surface-foreground">
							/skill:vetta-ui-design
						</code>
					</div>

					<div className="mt-auto flex justify-end pt-1">
						<span className="inline-flex min-h-[30px] items-center gap-1.5 rounded-[6px] bg-primary px-2.5 text-[12px] font-medium text-primary-foreground">
							填入输入框
							<CornerDownLeftIcon className="size-3.5" />
						</span>
					</div>
				</div>
			</div>

			{/* footer 36px */}
			<footer className="flex h-[36px] shrink-0 items-center gap-3 border-b border-border/75 px-4 text-[12px] text-muted">
				<span className="inline-flex items-center gap-1">
					<Kbd>↑</Kbd>
					<Kbd>↓</Kbd>
					选择
				</span>
				<span className="inline-flex items-center gap-1">
					<Kbd>↵</Kbd>
					填入输入框
				</span>
				<span className="inline-flex items-center gap-1">
					<Kbd>Esc</Kbd>
					关闭
				</span>
			</footer>
		</section>
	);
}
