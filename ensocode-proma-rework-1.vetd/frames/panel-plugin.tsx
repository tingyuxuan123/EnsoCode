export const frame = { width: 1440, height: 900, title: "右侧面板 · 插件视图（本地便签）" };

import { PanelFrame } from '../components/panel/PanelFrame';

/** 对照仓库 Notes 示例；仅设计预览，不执行第三方插件。 */
export default function Screen() {
  return <PanelFrame kind="plugin" title="本地便签" />;
}
