export const frame = { width: 1440, height: 900, title: "模型中心 · 刷新全部模型的结果" };

import { ModelCenter } from "../components/ModelCenter";

export default function RefreshingModels() {
	return <ModelCenter variant="refreshing" />;
}
