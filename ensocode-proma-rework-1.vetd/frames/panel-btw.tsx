export const frame = { width: 1440, height: 900, title: "右侧面板 · 旁路提问" };

import { PanelFrame } from '../components/panel/PanelFrame';

/** 旁路：带上下文 / 独立旁路，流式回答与停止，填入主输入框，开新旁路标签 */
export default function PanelBtw() {
  return <PanelFrame kind="btw" title="旁路" preset={{ state: 'ready' }} />;
}
