export const frame = { width: 1440, height: 900, title: "主窗口 · 工作台" };

import { AppRail } from "../components/AppRail";
import { ChatPane } from "../components/ChatPane";
import { ProjectSidebar } from "../components/ProjectSidebar";
import { SidePanel } from "../components/SidePanel";
import { PanelRightIcon } from "../components/LucideIcons";

export default function MainWindow() {
	return (
		<div className="flex h-full flex-col bg-shell font-sans text-surface-foreground antialiased">
			{/* 44px 无边框标题栏：macOS 红绿灯预留 84px，仅作拖拽区 */}
			<header className="flex h-[44px] shrink-0 items-center pl-[84px] pr-3">
				<div className="ml-auto flex items-center gap-1">
					<button
						type="button"
						aria-label="切换右侧面板"
						className="flex size-7 items-center justify-center rounded-[6px] text-surface-foreground"
					>
						<PanelRightIcon className="size-4" />
					</button>
				</div>
			</header>

			{/* 外壳：图标轨 + 三张 6px 留缝的圆角卡片 */}
			<div className="flex min-h-0 flex-1 gap-[6px] pr-[6px] pb-[6px]">
				<AppRail />
				<ProjectSidebar />
				<ChatPane />
				<SidePanel />
			</div>
		</div>
	);
}
