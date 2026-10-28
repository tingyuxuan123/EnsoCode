export const frame = { width: 1440, height: 900, title: "改动审查 · 全屏并排 Diff" };

import { PanelFrame } from '../components/panel/PanelFrame';

/**
 * 真实应用没有独立的「改动审查」页：审查就是右侧「改动」面板的全屏态（dockview 全屏标签）。
 * 宽屏下 diff 并排；逐文件折叠、全部折叠/展开；快照被截断的文件单独提示。
 */
export default function ReviewScreen() {
  return <PanelFrame kind="changes" title="改动" preset={{ mode: 'all', sessionState: 'truncated' }} fullscreen />;
}
