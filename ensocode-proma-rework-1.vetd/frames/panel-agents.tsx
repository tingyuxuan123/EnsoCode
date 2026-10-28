export const frame = { width: 1440, height: 900, title: "右侧面板 · 代理目录与过程观察" };

import { PanelFrame } from '../components/panel/PanelFrame';

/** 目录：一次性任务 / 持久协作者、运行中 / 等待输入 / 失败 / 排队；点进只观察过程，不能发消息 */
export default function PanelAgents() {
  return <PanelFrame kind="agents" title="代理" preset={{ state: 'list' }} />;
}
