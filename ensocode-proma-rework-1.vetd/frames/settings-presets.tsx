export const frame = { width: 960, height: 680, title: "设置 · 预设" };

import { PresetsPage } from '../components/settings/core/PresetsPage';

/** 全局（只读默认）、自定义预设（技能 / MCP / 指令文件组合）、设为默认、编辑与保存失败 */
export default function Screen() {
  return <PresetsPage />;
}
