export const frame = { width: 1440, height: 900, title: "右侧面板 · 工作流运行" };

import { PanelFrame } from '../components/panel/PanelFrame';

/** 工作流：预设与参数、阶段与并行步骤、每步子代理日志、失败原因与重试 */
export default function PanelWorkflow() {
  return <PanelFrame kind="workflow" title="工作流" preset={{ state: 'running' }} />;
}
