/**
 * 精确图标集 —— 从本项目 node_modules/lucide-react@1.33.0 的
 * dist/esm/icons/*.mjs 解析 __iconNode 生成（支持跨行属性与转发文件），
 * 与 src/renderer 里 `import { ... } from "lucide-react"` 的几何完全一致。
 */
type IconProps = { className?: string; strokeWidth?: number };

export function FolderIcon({ className, strokeWidth = 2 }: IconProps) {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={strokeWidth}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			className={className}
		>
			<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
		</svg>
	);
}

export function ShieldOffIcon({ className, strokeWidth = 2 }: IconProps) {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={strokeWidth}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			className={className}
		>
			<path d="m2 2 20 20" />
			<path d="M5 5a1 1 0 0 0-1 1v7c0 5 3.5 7.5 7.67 8.94a1 1 0 0 0 .67.01c2.35-.82 4.48-1.97 5.9-3.71" />
			<path d="M9.309 3.652A12.252 12.252 0 0 0 11.24 2.28a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1v7a9.784 9.784 0 0 1-.08 1.264" />
		</svg>
	);
}

export function ClipboardListIcon({ className, strokeWidth = 2 }: IconProps) {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={strokeWidth}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			className={className}
		>
			<rect width="8" height="4" x="8" y="2" rx="1" ry="1" />
			<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
			<path d="M12 11h4" />
			<path d="M12 16h4" />
			<path d="M8 11h.01" />
			<path d="M8 16h.01" />
		</svg>
	);
}

export function ChevronUpIcon({ className, strokeWidth = 2 }: IconProps) {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={strokeWidth}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			className={className}
		>
			<path d="m18 15-6-6-6 6" />
		</svg>
	);
}

export function Settings2Icon({ className, strokeWidth = 2 }: IconProps) {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={strokeWidth}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			className={className}
		>
			<path d="M14 17H5" />
			<path d="M19 7h-9" />
			<circle cx="17" cy="17" r="3" />
			<circle cx="7" cy="7" r="3" />
		</svg>
	);
}

export function SparkleIcon({ className, strokeWidth = 2 }: IconProps) {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={strokeWidth}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			className={className}
		>
			<path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z" />
		</svg>
	);
}

export function BrainIcon({ className, strokeWidth = 2 }: IconProps) {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={strokeWidth}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			className={className}
		>
			<path d="M12 18V5" />
			<path d="M15 13a4.17 4.17 0 0 1-3-4 4.17 4.17 0 0 1-3 4" />
			<path d="M17.598 6.5A3 3 0 1 0 12 5a3 3 0 1 0-5.598 1.5" />
			<path d="M17.997 5.125a4 4 0 0 1 2.526 5.77" />
			<path d="M18 18a4 4 0 0 0 2-7.464" />
			<path d="M19.967 17.483A4 4 0 1 1 12 18a4 4 0 1 1-7.967-.517" />
			<path d="M6 18a4 4 0 0 1-2-7.464" />
			<path d="M6.003 5.125a4 4 0 0 0-2.526 5.77" />
		</svg>
	);
}

export function ImagePlusIcon({ className, strokeWidth = 2 }: IconProps) {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={strokeWidth}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			className={className}
		>
			<path d="M16 5h6" />
			<path d="M19 2v6" />
			<path d="M21 11.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7.5" />
			<path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
			<circle cx="9" cy="9" r="2" />
		</svg>
	);
}

export function SquareSlashIcon({ className, strokeWidth = 2 }: IconProps) {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={strokeWidth}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			className={className}
		>
			<rect width="18" height="18" x="3" y="3" rx="2" />
			<line x1="9" x2="15" y1="15" y2="9" />
		</svg>
	);
}

export function GitBranchIcon({ className, strokeWidth = 2 }: IconProps) {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={strokeWidth}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			className={className}
		>
			<path d="M15 6a9 9 0 0 0-9 9V3" />
			<circle cx="18" cy="6" r="3" />
			<circle cx="6" cy="18" r="3" />
		</svg>
	);
}

export function TerminalIcon({ className, strokeWidth = 2 }: IconProps) {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={strokeWidth}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			className={className}
		>
			<path d="M12 19h8" />
			<path d="m4 17 6-6-6-6" />
		</svg>
	);
}

export function WrenchIcon({ className, strokeWidth = 2 }: IconProps) {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={strokeWidth}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			className={className}
		>
			<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.106-3.105c.32-.322.863-.22.983.218a6 6 0 0 1-8.259 7.057l-7.91 7.91a1 1 0 0 1-2.999-3l7.91-7.91a6 6 0 0 1 7.057-8.259c.438.12.54.662.219.984z" />
		</svg>
	);
}

export function FilesIcon({ className, strokeWidth = 2 }: IconProps) {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={strokeWidth}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			className={className}
		>
			<path d="M15 2h-4a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V8" />
			<path d="M16.706 2.706A2.4 2.4 0 0 0 15 2v5a1 1 0 0 0 1 1h5a2.4 2.4 0 0 0-.706-1.706z" />
			<path d="M5 7a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h8a2 2 0 0 0 1.732-1" />
		</svg>
	);
}

export function FileCodeIcon({ className, strokeWidth = 2 }: IconProps) {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={strokeWidth}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			className={className}
		>
			<path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" />
			<path d="M14 2v5a1 1 0 0 0 1 1h5" />
			<path d="M10 12.5 8 15l2 2.5" />
			<path d="m14 12.5 2 2.5-2 2.5" />
		</svg>
	);
}

export function CoinsIcon({ className, strokeWidth = 2 }: IconProps) {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={strokeWidth}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			className={className}
		>
			<path d="M13.744 17.736a6 6 0 1 1-7.48-7.48" />
			<path d="M15 6h1v4" />
			<path d="m6.134 14.768.866-.5 2 3.464" />
			<circle cx="16" cy="8" r="6" />
		</svg>
	);
}

export function DatabaseIcon({ className, strokeWidth = 2 }: IconProps) {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={strokeWidth}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			className={className}
		>
			<ellipse cx="12" cy="5" rx="9" ry="3" />
			<path d="M3 5V19A9 3 0 0 0 21 19V5" />
			<path d="M3 12A9 3 0 0 0 21 12" />
		</svg>
	);
}

export function ShieldIcon({ className, strokeWidth = 2 }: IconProps) {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={strokeWidth}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			className={className}
		>
			<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
		</svg>
	);
}

export function ShieldCheckIcon({ className, strokeWidth = 2 }: IconProps) {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={strokeWidth}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			className={className}
		>
			<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
			<path d="m9 12 2 2 4-4" />
		</svg>
	);
}

export function ArrowUpIcon({ className, strokeWidth = 2 }: IconProps) {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={strokeWidth}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			className={className}
		>
			<path d="m5 12 7-7 7 7" />
			<path d="M12 19V5" />
		</svg>
	);
}

export function ArrowDownIcon({ className, strokeWidth = 2 }: IconProps) {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={strokeWidth}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			className={className}
		>
			<path d="M12 5v14" />
			<path d="m19 12-7 7-7-7" />
		</svg>
	);
}

export function ChevronDownIcon({ className, strokeWidth = 2 }: IconProps) {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={strokeWidth}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			className={className}
		>
			<path d="m6 9 6 6 6-6" />
		</svg>
	);
}

export function ChevronRightIcon({ className, strokeWidth = 2 }: IconProps) {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={strokeWidth}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			className={className}
		>
			<path d="m9 18 6-6-6-6" />
		</svg>
	);
}

export function ChevronsUpDownIcon({ className, strokeWidth = 2 }: IconProps) {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={strokeWidth}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			className={className}
		>
			<path d="m7 15 5 5 5-5" />
			<path d="m7 9 5-5 5 5" />
		</svg>
	);
}

export function PlusIcon({ className, strokeWidth = 2 }: IconProps) {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={strokeWidth}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			className={className}
		>
			<path d="M5 12h14" />
			<path d="M12 5v14" />
		</svg>
	);
}

export function CirclePlusIcon({ className, strokeWidth = 2 }: IconProps) {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={strokeWidth}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			className={className}
		>
			<circle cx="12" cy="12" r="10" />
			<path d="M8 12h8" />
			<path d="M12 8v8" />
		</svg>
	);
}

export function ArchiveIcon({ className, strokeWidth = 2 }: IconProps) {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={strokeWidth}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			className={className}
		>
			<rect width="20" height="5" x="2" y="3" rx="1" />
			<path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" />
			<path d="M10 12h4" />
		</svg>
	);
}

export function MonitorIcon({ className, strokeWidth = 2 }: IconProps) {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={strokeWidth}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			className={className}
		>
			<rect width="20" height="14" x="2" y="3" rx="2" />
			<line x1="8" x2="16" y1="21" y2="21" />
			<line x1="12" x2="12" y1="17" y2="21" />
		</svg>
	);
}

export function SearchIcon({ className, strokeWidth = 2 }: IconProps) {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={strokeWidth}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			className={className}
		>
			<path d="m21 21-4.34-4.34" />
			<circle cx="11" cy="11" r="8" />
		</svg>
	);
}

export function LoaderCircleIcon({ className, strokeWidth = 2 }: IconProps) {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={strokeWidth}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			className={className}
		>
			<path d="M21 12a9 9 0 1 1-6.219-8.56" />
		</svg>
	);
}

export function PanelLeftIcon({ className, strokeWidth = 2 }: IconProps) {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={strokeWidth}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			className={className}
		>
			<rect width="18" height="18" x="3" y="3" rx="2" />
			<path d="M9 3v18" />
		</svg>
	);
}

export function PanelRightIcon({ className, strokeWidth = 2 }: IconProps) {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={strokeWidth}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			className={className}
		>
			<rect width="18" height="18" x="3" y="3" rx="2" />
			<path d="M15 3v18" />
		</svg>
	);
}

export function TextSearchIcon({ className, strokeWidth = 2 }: IconProps) {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={strokeWidth}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			className={className}
		>
			<path d="M21 5H3" />
			<path d="M10 12H3" />
			<path d="M10 19H3" />
			<circle cx="17" cy="15" r="3" />
			<path d="m21 19-1.9-1.9" />
		</svg>
	);
}

export function UnfoldHorizontalIcon({ className, strokeWidth = 2 }: IconProps) {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={strokeWidth}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			className={className}
		>
			<path d="M16 12h6" />
			<path d="M8 12H2" />
			<path d="M12 2v2" />
			<path d="M12 8v2" />
			<path d="M12 14v2" />
			<path d="M12 20v2" />
			<path d="m19 15 3-3-3-3" />
			<path d="m5 9-3 3 3 3" />
		</svg>
	);
}

export function Maximize2Icon({ className, strokeWidth = 2 }: IconProps) {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={strokeWidth}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			className={className}
		>
			<path d="M15 3h6v6" />
			<path d="m21 3-7 7" />
			<path d="m3 21 7-7" />
			<path d="M9 21H3v-6" />
		</svg>
	);
}

export function CopyIcon({ className, strokeWidth = 2 }: IconProps) {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={strokeWidth}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			className={className}
		>
			<rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
			<path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
		</svg>
	);
}

export function GitForkIcon({ className, strokeWidth = 2 }: IconProps) {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={strokeWidth}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			className={className}
		>
			<circle cx="12" cy="18" r="3" />
			<circle cx="6" cy="6" r="3" />
			<circle cx="18" cy="6" r="3" />
			<path d="M18 9v2c0 .6-.4 1-1 1H7c-.6 0-1-.4-1-1V9" />
			<path d="M12 12v3" />
		</svg>
	);
}

export function CircleDotIcon({ className, strokeWidth = 2 }: IconProps) {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={strokeWidth}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			className={className}
		>
			<circle cx="12" cy="12" r="10" />
			<circle cx="12" cy="12" r="1" />
		</svg>
	);
}

export function CircleIcon({ className, strokeWidth = 2 }: IconProps) {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={strokeWidth}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			className={className}
		>
			<circle cx="12" cy="12" r="10" />
		</svg>
	);
}

export function CircleCheckIcon({ className, strokeWidth = 2 }: IconProps) {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={strokeWidth}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			className={className}
		>
			<circle cx="12" cy="12" r="10" />
			<path d="m9 12 2 2 4-4" />
		</svg>
	);
}

export function MessageCircleIcon({ className, strokeWidth = 2 }: IconProps) {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={strokeWidth}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			className={className}
		>
			<path d="M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719" />
		</svg>
	);
}

export function ChartGanttIcon({ className, strokeWidth = 2 }: IconProps) {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={strokeWidth}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			className={className}
		>
			<path d="M10 6h8" />
			<path d="M12 16h6" />
			<path d="M3 3v16a2 2 0 0 0 2 2h16" />
			<path d="M8 11h7" />
		</svg>
	);
}


export function FolderOpenIcon({ className, strokeWidth = 2 }: IconProps) {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={strokeWidth}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			className={className}
		>
			<path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2" />
		</svg>
	);
}

export function ImageIcon({ className, strokeWidth = 2 }: IconProps) {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={strokeWidth}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			className={className}
		>
			<rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
			<circle cx="9" cy="9" r="2" />
			<path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
		</svg>
	);
}

export function ScanIcon({ className, strokeWidth = 2 }: IconProps) {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={strokeWidth}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			className={className}
		>
			<path d="M3 7V5a2 2 0 0 1 2-2h2" />
			<path d="M17 3h2a2 2 0 0 1 2 2v2" />
			<path d="M21 17v2a2 2 0 0 1-2 2h-2" />
			<path d="M7 21H5a2 2 0 0 1-2-2v-2" />
		</svg>
	);
}

export function LightbulbIcon({ className, strokeWidth = 2 }: IconProps) {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={strokeWidth}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			className={className}
		>
			<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5" />
			<path d="M9 18h6" />
			<path d="M10 22h4" />
		</svg>
	);
}


export function TerminalSquareIcon({ className, strokeWidth = 2 }: IconProps) {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={strokeWidth}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			className={className}
		>
			<path d="m7 11 2-2-2-2" />
			<path d="M11 13h4" />
			<rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
		</svg>
	);
}

export function ListTodoIcon({ className, strokeWidth = 2 }: IconProps) {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={strokeWidth}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			className={className}
		>
			<path d="M13 5h8" />
			<path d="M13 12h8" />
			<path d="M13 19h8" />
			<path d="m3 17 2 2 4-4" />
			<rect x="3" y="4" width="6" height="6" rx="1" />
		</svg>
	);
}


export function FolderGit2Icon({ className, strokeWidth = 2 }: IconProps) {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={strokeWidth}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			className={className}
		>
			<path d="M18 19a5 5 0 0 1-5-5v8" />
			<path d="M9 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v5" />
			<circle cx="13" cy="12" r="2" />
			<circle cx="20" cy="19" r="2" />
		</svg>
	);
}

export function PinIcon({ className, strokeWidth = 2 }: IconProps) {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={strokeWidth}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			className={className}
		>
			<path d="M12 17v5" />
			<path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
		</svg>
	);
}


export function TargetIcon({ className, strokeWidth = 2 }: IconProps) {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={strokeWidth}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			className={className}
		>
			<circle cx="12" cy="12" r="10" />
			<circle cx="12" cy="12" r="6" />
			<circle cx="12" cy="12" r="2" />
		</svg>
	);
}

export function Minimize2Icon({ className, strokeWidth = 2 }: IconProps) {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={strokeWidth}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			className={className}
		>
			<path d="m14 10 7-7" />
			<path d="M20 10h-6V4" />
			<path d="m3 21 7-7" />
			<path d="M4 14h6v6" />
		</svg>
	);
}

export function PuzzleIcon({ className, strokeWidth = 2 }: IconProps) {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={strokeWidth}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			className={className}
		>
			<path d="M15.39 4.39a1 1 0 0 0 1.68-.474 2.5 2.5 0 1 1 3.014 3.015 1 1 0 0 0-.474 1.68l1.683 1.682a2.414 2.414 0 0 1 0 3.414L19.61 15.39a1 1 0 0 1-1.68-.474 2.5 2.5 0 1 0-3.014 3.015 1 1 0 0 1 .474 1.68l-1.683 1.682a2.414 2.414 0 0 1-3.414 0L8.61 19.61a1 1 0 0 0-1.68.474 2.5 2.5 0 1 1-3.014-3.015 1 1 0 0 0 .474-1.68l-1.683-1.682a2.414 2.414 0 0 1 0-3.414L4.39 8.61a1 1 0 0 1 1.68.474 2.5 2.5 0 1 0 3.014-3.015 1 1 0 0 1-.474-1.68l1.683-1.682a2.414 2.414 0 0 1 3.414 0z" />
		</svg>
	);
}

export function CornerDownLeftIcon({ className, strokeWidth = 2 }: IconProps) {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={strokeWidth}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			className={className}
		>
			<path d="M20 4v7a4 4 0 0 1-4 4H4" />
			<path d="m9 10-5 5 5 5" />
		</svg>
	);
}

export function XIcon({ className, strokeWidth = 2 }: IconProps) {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={strokeWidth}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			className={className}
		>
			<path d="M18 6 6 18" />
			<path d="m6 6 12 12" />
		</svg>
	);
}


export function SparklesIcon({ className, strokeWidth = 2 }: IconProps) {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={strokeWidth}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			className={className}
		>
			<path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z" />
			<path d="M20 2v4" />
			<path d="M22 4h-4" />
			<circle cx="4" cy="20" r="2" />
		</svg>
	);
}
