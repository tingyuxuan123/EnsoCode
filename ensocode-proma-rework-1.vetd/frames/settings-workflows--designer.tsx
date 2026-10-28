export const frame = { width: 960, height: 680, title: "设置 · 工作流 · 编辑预设（设计器）" };

import { WorkflowsPage } from "../components/settings/extra/Workflows";

export default function Screen() {
  return <WorkflowsPage openDialog />;
}
