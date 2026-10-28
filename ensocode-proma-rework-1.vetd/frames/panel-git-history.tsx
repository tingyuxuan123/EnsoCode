export const frame = { width: 1440, height: 900, title: "右侧面板 · Git 历史与提交 Diff" };

import { PanelFrame } from '../components/panel/PanelFrame';

/** Git 历史：提交列表、选中提交的文件与 Diff、加载更多、暂无提交 */
export default function PanelGitHistory() {
  return <PanelFrame kind="changes" title="改动" preset={{ mode: 'git', gitView: 'history', gitState: 'ready' }} />;
}
