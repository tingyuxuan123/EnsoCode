export const frame = { width: 1440, height: 900, title: "右侧面板 · 终端（多标签）" };

import { PanelFrame } from '../components/panel/PanelFrame';

/** 终端：同一会话多开（终端 / 终端 2），搜索条、复制、发送到对话、结束与重启 */
export default function PanelTerminal() {
  return <PanelFrame kind="terminal" title="终端" preset={{ state: 'ready' }} />;
}
