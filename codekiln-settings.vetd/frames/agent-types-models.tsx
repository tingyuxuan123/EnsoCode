export const frame = { width: 1440, height: 900, title: "子代理类型 · 候选模型（下滚）" };

import { AgentTypesPage } from "../components/AgentTypesPage";

/** 同一页向下滚动的状态：候选项在类型清单之后，只有这样才看得全。 */
export default function AgentTypesModels() {
	return <AgentTypesPage scroll={436} />;
}
