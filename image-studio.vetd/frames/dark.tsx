export const frame = { width: 1440, height: 900, title: "深色主题" };

import { HistoryPanel } from "../components/HistoryPanel";
import { ThreadBody } from "../components/ThreadBody";
import { Workbench } from "../components/Workbench";

export default function DarkTheme() {
	return (
		<div className="dark h-full bg-background text-foreground">
			<Workbench panelOpen panel={<HistoryPanel />}>
				<ThreadBody />
			</Workbench>
		</div>
	);
}
