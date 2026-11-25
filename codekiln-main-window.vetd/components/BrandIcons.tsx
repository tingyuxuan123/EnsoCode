/**
 * 图标轨与步骤行的自绘 SVG —— 路径逐条取自
 * src/renderer/components/app/NavIcons.tsx 与 src/renderer/components/chat/StepIcons.tsx。
 * 这些不是 lucide 图标，用通用图标替代会整体走形。
 */
type P = { className?: string; active?: boolean };

const S = {
	viewBox: "0 0 24 24",
	fill: "none",
	stroke: "currentColor",
	strokeLinecap: "round" as const,
	strokeLinejoin: "round" as const,
	"aria-hidden": true,
};

/** Code 主工作区：开放式 `</>` 几何字符 */
export function CodeWorkspaceIcon({ className }: P) {
	return (
		<svg {...S} strokeWidth={1.85} className={className}>
			<path d="m7.75 8.25-4 3.75 4 3.75" />
			<path d="m16.25 8.25 4 3.75-4 3.75" />
			<path d="m13.75 6.25-3.5 11.5" />
		</svg>
	);
}

/** 图片工作台：右上角破框嵌入四芒星 */
export function ImageStudioIcon({ className, active = false }: P) {
	return (
		<svg {...S} strokeWidth={1.75} className={className}>
			{active && (
				<rect x="4" y="4" width="16" height="16" rx="3.25" fill="currentColor" fillOpacity={0.14} stroke="none" />
			)}
			<path d="M12.5 4H7.25A3.25 3.25 0 0 0 4 7.25v9.5A3.25 3.25 0 0 0 7.25 20h9.5A3.25 3.25 0 0 0 20 16.75V11.5" />
			<path d="M4.25 16.4c2.7-3 5.55-3 8-.55 1.85 1.85 3.9 1.6 7.45-1.35" />
			<path
				d="M18.15 2.35c.38 2.15 1.1 2.87 3.25 3.25-2.15.38-2.87 1.1-3.25 3.25-.38-2.15-1.1-2.87-3.25-3.25 2.15-.38 2.87-1.1 3.25-3.25Z"
				fill="currentColor"
				stroke="none"
			/>
		</svg>
	);
}

/** 设计画廊：方框 + 右下圆 */
export function DesignGalleryIcon({ className, active = false }: P) {
	return (
		<svg {...S} strokeWidth={1.75} className={className}>
			{active && <circle cx="15" cy="15" r="5.35" fill="currentColor" fillOpacity={0.16} stroke="none" />}
			<path d="M7.6 15H6.25A2.75 2.75 0 0 1 3.5 12.25v-6A2.75 2.75 0 0 1 6.25 3.5h6A2.75 2.75 0 0 1 15 6.25V7.6" />
			<circle cx="15" cy="15" r="5.35" />
		</svg>
	);
}

/** 扩展：2×2 模块 + 斜置右上单元 */
export function ExtensionsIcon({ className, active = false }: P) {
	return (
		<svg {...S} strokeWidth={1.8} className={className}>
			<rect x="3.5" y="4.25" width="6.75" height="6.75" rx="1.65" />
			<rect x="3.5" y="13.75" width="6.75" height="6.75" rx="1.65" />
			<rect x="13" y="13.75" width="6.75" height="6.75" rx="1.65" />
			{active && (
				<rect
					x="14.1"
					y="2.9"
					width="6.5"
					height="6.5"
					rx="1.6"
					transform="rotate(14 17.35 6.15)"
					fill="currentColor"
					fillOpacity={0.16}
					stroke="none"
				/>
			)}
			<rect x="14.1" y="2.9" width="6.5" height="6.5" rx="1.6" transform="rotate(14 17.35 6.15)" />
		</svg>
	);
}

/** 询问 CodeKiln：Enso 缺口环 + 中心星核 + 弧尾星点 */
export function AskCodeKilnIcon({ className }: P) {
	return (
		<svg {...S} strokeWidth={1.8} className={className}>
			<path d="M19.85 10.35A8.25 8.25 0 1 1 13.65 4.15" />
			<circle cx="18.35" cy="5.65" r="1.2" fill="currentColor" stroke="none" />
			<path
				d="M12 7c.52 2.9 2.1 4.48 5 5-2.9.52-4.48 2.1-5 5-.52-2.9-2.1-4.48-5-5 2.9-.52 4.48-2.1 5-5Z"
				fill="currentColor"
				stroke="none"
			/>
		</svg>
	);
}

/** 设置：对称六齿齿轮 + 内孔 */
export function SettingsGearIcon({ className }: P) {
	return (
		<svg {...S} strokeWidth={1.75} className={className}>
			<path d="M10.44 3.14 L13.56 3.14 L14.31 5.66 A6.75 6.75 0 0 1 16.34 6.83 L18.89 6.21 L20.46 8.92 L18.65 10.83 A6.75 6.75 0 0 1 18.65 13.17 L20.46 15.08 L18.89 17.79 L16.34 17.17 A6.75 6.75 0 0 1 14.31 18.34 L13.56 20.86 L10.44 20.86 L9.69 18.34 A6.75 6.75 0 0 1 7.66 17.17 L5.11 17.79 L3.54 15.08 L5.35 13.17 A6.75 6.75 0 0 1 5.35 10.83 L3.54 8.92 L5.11 6.21 L7.66 6.83 A6.75 6.75 0 0 1 9.69 5.66 Z" />
			<circle cx="12" cy="12" r="2.75" />
		</svg>
	);
}

/** 思考步骤：极简双星灵光 */
export function ThinkingSparkIcon({ className }: P) {
	return (
		<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.45} strokeLinecap="round" strokeLinejoin="round" aria-hidden className={className}>
			<path d="M7.3 2.35c.5 3.1 1.55 4.15 4.65 4.65-3.1.5-4.15 1.55-4.65 4.65-.5-3.1-1.55-4.15-4.65-4.65 3.1-.5 4.15-1.55 4.65-4.65Z" />
			<path
				d="M12.65 10.55c.23 1.32.68 1.77 2 2-1.32.23-1.77.68-2 2-.23-1.32-.68-1.77-2-2 1.32-.23 1.77-.68 2-2Z"
				fill="currentColor"
				stroke="none"
			/>
		</svg>
	);
}

/**
 * 会话状态微标 —— 几何、描边、dasharray 与颜色逐项取自
 * src/renderer/components/chat/ConversationStatusIndicator.tsx
 * 与 src/renderer/styles/shared.css 的 .codekiln-status-* 规则。
 * running = 14px 迷你 Enso 环（品牌橙轨道 + 核心脉动）；
 * attention = 破坏色脉冲环；waiting = 警告色问号徽标；
 * failed = 破坏色叹号；unread = 7px 绿点 + 2px 光晕；
 * idle(subtle-dot) = 4px 灰点，激活 5px 且更亮。
 */
export function ConversationStatus({
	tone,
	active,
}: {
	tone: "idle" | "running" | "attention" | "waiting" | "failed" | "unread";
	active?: boolean;
}) {
	if (tone === "running") {
		return (
			<span
				title="运行中"
				className="inline-flex size-[14px] shrink-0 items-center justify-center text-primary"
			>
				<svg viewBox="0 0 14 14" aria-hidden="true" className="size-full overflow-visible">
					{/* .codekiln-status-track：foreground 14%，1.5 */}
					<circle cx="7" cy="7" r="4.8" fill="none" stroke="currentColor" strokeOpacity={0.14} strokeWidth={1.5} />
					{/* .codekiln-status-orbit：brand，1.7，dasharray 11 21 */}
					<circle
						cx="7"
						cy="7"
						r="4.8"
						fill="none"
						stroke="currentColor"
						strokeWidth={1.7}
						strokeLinecap="round"
						strokeDasharray="11 21"
						className="codekiln-status-orbit"
					/>
					{/* .codekiln-status-core：brand 实心，脉动 */}
					<circle cx="7" cy="7" r="1.65" fill="currentColor" className="codekiln-status-core" />
				</svg>
			</span>
		);
	}

	if (tone === "attention") {
		return (
			<span
				title="待你确认"
				className="inline-flex size-[14px] shrink-0 items-center justify-center text-destructive"
			>
				<svg viewBox="0 0 14 14" aria-hidden="true" className="size-full overflow-visible">
					{/* .codekiln-status-attention-ring：r 4.6，1.4，脉冲 */}
					<circle
						cx="7"
						cy="7"
						r="4.6"
						fill="none"
						stroke="currentColor"
						strokeWidth={1.4}
						className="codekiln-status-attention-ring"
					/>
					<circle cx="7" cy="7" r="2.75" fill="currentColor" />
				</svg>
			</span>
		);
	}

	if (tone === "waiting") {
		return (
			<span
				title="等待你回答"
				className="inline-flex size-[14px] shrink-0 items-center justify-center text-warning"
			>
				<svg viewBox="0 0 14 14" aria-hidden="true" className="size-full overflow-visible">
					<circle cx="7" cy="7" r="5.3" fill="currentColor" fillOpacity={0.14} stroke="currentColor" strokeOpacity={0.62} strokeWidth={1.25} />
					<path
						d="M5.65 5.45a1.45 1.45 0 0 1 2.75.65c0 .9-1.4 1.1-1.4 2.05"
						fill="none"
						stroke="currentColor"
						strokeWidth={1.35}
						strokeLinecap="round"
					/>
					<circle cx="7" cy="10.05" r="0.72" fill="currentColor" />
				</svg>
			</span>
		);
	}

	if (tone === "failed") {
		return (
			<span
				title="失败"
				className="inline-flex size-[14px] shrink-0 items-center justify-center text-destructive"
			>
				<svg viewBox="0 0 14 14" aria-hidden="true" className="size-full overflow-visible">
					<circle cx="7" cy="7" r="5.3" fill="currentColor" fillOpacity={0.12} stroke="currentColor" strokeOpacity={0.72} strokeWidth={1.25} />
					<line x1="7" y1="4.35" x2="7" y2="7.55" stroke="currentColor" strokeWidth={1.45} strokeLinecap="round" />
					<circle cx="7" cy="9.65" r="0.75" fill="currentColor" />
				</svg>
			</span>
		);
	}

	if (tone === "unread") {
		/* .codekiln-status-unread：7px 绿点 + 2px 20% 光晕 */
		return (
			<span className="flex size-4 shrink-0 items-center justify-center">
				<span className="size-[7px] shrink-0 rounded-full bg-success ring-2 ring-success/20" />
			</span>
		);
	}

	/* idle / subtle-dot：4px 灰点，激活 5px 且 foreground 65% */
	return (
		<span className="flex size-4 shrink-0 items-center justify-center">
			<span
				className={
					active
						? "size-[5px] shrink-0 rounded-full bg-surface-foreground/65"
						: "size-[4px] shrink-0 rounded-full bg-muted/30"
				}
			/>
		</span>
	);
}
