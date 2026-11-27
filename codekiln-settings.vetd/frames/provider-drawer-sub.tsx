export const frame = {
	width: 1440,
	height: 900,
	title: "服务商详情 · 订阅型（额度 / 账号池 / 退登失败）",
};

import { ModelCenter } from "../components/ModelCenter";
import { ProviderDetailDrawer } from "../components/ProviderDetailDrawer";
import { Window } from "../components/Window";

export default function ProviderDrawerSubscription() {
	return (
		<Window overlay={<ProviderDetailDrawer variant="subscription" />}>
			<ModelCenter />
		</Window>
	);
}
