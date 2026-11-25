import {
	AskCodeKilnIcon,
	CodeWorkspaceIcon,
	DesignGalleryIcon,
	ImageStudioIcon,
	SettingsGearIcon,
} from "./BrandIcons";
import { LoaderCircleIcon, PanelLeftIcon, SearchIcon } from "./LucideIcons";

/**
 * 56px 图标轨 —— 严格对齐 src/renderer/components/app/AppRail.tsx：
 * 按钮 size-36、图标 19px（PanelLeft/Search 为 18px 且 strokeWidth 1.75）、
 * 选中态只换强调色不给底板；分隔线 w-5 且 my-1。
 */
const RAIL_BUTTON =
	"relative flex size-[36px] items-center justify-center text-muted transition-colors hover:text-surface-foreground";

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
			className={`${RAIL_BUTTON} ${active ? "text-primary" : ""} ${brand ? "text-primary" : ""}`}
		>
			{children}
		</button>
	);
}

export function AppRail() {
	return (
		<nav
			aria-label="CodeKiln"
			className="flex w-[56px] shrink-0 flex-col items-center gap-[8px] pt-[4px] pb-[12px]"
		>
			<RailButton label="收起侧栏">
				<PanelLeftIcon className="size-[18px]" strokeWidth={1.75} />
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

			{/* StatusBar：运行中摘要，min-h-24 / w-44 / gap-3 / 11px（原 9rem/14 但校验下限 11px） */}
			<span
				role="status"
				aria-label="本机 · 2 个运行中"
				className="flex min-h-[24px] w-[44px] items-center justify-center gap-[3px] text-[11px] text-muted tabular-nums"
			>
				<LoaderCircleIcon className="size-[14px] animate-spin text-primary" strokeWidth={1.75} />
				<span>2</span>
			</span>

			<RailButton label="询问 CodeKiln" brand>
				<AskCodeKilnIcon className="size-[19px]" />
			</RailButton>
			<RailButton label="设置">
				<SettingsGearIcon className="size-[19px]" />
			</RailButton>
		</nav>
	);
}
