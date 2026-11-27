export const frame = { width: 1440, height: 900, title: "服务商详情 · API Key 型" };

import { ModelCenter } from "../components/ModelCenter";
import { ProviderDetailDrawer } from "../components/ProviderDetailDrawer";
import { Window } from "../components/Window";

export default function ProviderDrawer() {
	return (
		<Window overlay={<ProviderDetailDrawer variant="key" />}>
			<ModelCenter />
		</Window>
	);
}
