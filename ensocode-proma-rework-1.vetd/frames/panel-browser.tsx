export const frame = { width: 1440, height: 900, title: "右侧面板 · 内嵌浏览器（Agent 操作中）" };

import { PanelFrame } from '../components/panel/PanelFrame';

/** 浏览器：Agent 正在操作 → 我来接管 → 允许 Agent 继续；圈选、设备预览、开发者工具、历史、下载 */
export default function PanelBrowser() {
  return <PanelFrame kind="browser" title="浏览器" preset={{ state: 'agent' }} />;
}
