export const frame = { width: 1440, height: 900, title: "右侧面板 · 改动（Git 暂存与提交）" };

import { PanelFrame } from '../components/panel/PanelFrame';

/** 改动面板 → Git：已暂存 / 未暂存 / 未跟踪，暂存、丢弃确认、提交信息 */
export default function PanelChangesGit() {
  return <PanelFrame kind="changes" title="改动" preset={{ mode: 'git', gitView: 'changes', gitState: 'ready' }} />;
}
