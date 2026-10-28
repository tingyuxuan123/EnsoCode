export const frame = { width: 960, height: 680, title: "设置 · 预设编辑" };

import { PresetsPage } from '../components/settings/core/PresetsPage';

/** 编辑预设：名称、角色描述替换 pi 开头段落、技能 / MCP 多选、指令文件单选「不注入」、系统提示词读取失败与重试 */
export default function Screen() {
  return <PresetsPage open="edit" />;
}
