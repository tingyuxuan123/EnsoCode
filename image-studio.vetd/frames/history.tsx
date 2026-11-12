export const frame = { width: 1440, height: 900, title: "右侧生成历史" };

import { HistoryPanel } from "../components/HistoryPanel";
import { ThreadBody } from "../components/ThreadBody";
import { Workbench } from "../components/Workbench";

export default function History() {
	return (
		<Workbench panelOpen panel={<HistoryPanel />}>
			<ThreadBody />
		</Workbench>
	);
}
