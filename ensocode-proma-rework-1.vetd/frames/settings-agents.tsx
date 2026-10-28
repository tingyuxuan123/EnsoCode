export const frame = { width: 960, height: 680, title: "设置 · 子代理类型" };

import { AgentTypesPage } from '../components/settings/core/AgentTypesPage';

/** 内置启停 / 同名覆盖 / 自定义、coworker 上限、选模模式（主 Agent 选择 / 跟随会话 / 固定模型） */
export default function Screen() {
  return <AgentTypesPage />;
}
