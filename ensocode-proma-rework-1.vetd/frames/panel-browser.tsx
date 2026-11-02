export const frame = { width: 1440, height: 900, title: "右侧面板 · 内嵌浏览器（协作浏览）" };

import { PanelFrame } from '../components/panel/PanelFrame';

/** 人与 Agent 可共同操作，不再切换独占控制权；保留设备预览、开发者工具、历史与下载。 */
export default function PanelBrowser() {
  return <PanelFrame kind="browser" title="浏览器" preset={{ state: 'agent' }} />;
}
