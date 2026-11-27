export const frame = { width: 1440, height: 900, title: "服务商详情 · 预设型（端口与快照）" };

import { ModelCenter } from "../components/ModelCenter";
import { ProviderDetailDrawer } from "../components/ProviderDetailDrawer";
import { Window } from "../components/Window";

export default function ProviderDrawerPreset() {
	return (
		<Window overlay={<ProviderDetailDrawer variant="preset" />}>
			<ModelCenter />
		</Window>
	);
}
