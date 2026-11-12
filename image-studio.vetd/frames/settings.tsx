export const frame = { width: 1440, height: 900, title: "画图设置弹窗" };

import { SettingsSheet } from "../components/SettingsSheet";
import { ThreadBody } from "../components/ThreadBody";
import { Workbench } from "../components/Workbench";

export default function Settings() {
	return (
		<div className="relative h-full">
			<Workbench>
				<ThreadBody />
			</Workbench>
			<div className="absolute inset-0 bg-foreground/30" />
			<div className="absolute inset-0 flex items-center justify-center">
				<SettingsSheet />
			</div>
		</div>
	);
}
