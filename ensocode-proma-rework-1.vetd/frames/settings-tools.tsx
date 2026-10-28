export const frame = { width: 960, height: 680, title: "设置 · 内置工具" };

import { ToolsPage } from '../components/settings/core/ToolsPage';

/** 12 个工具开关（记忆 / 电脑操控 / 代码搜索默认关）、联网搜索候选链、代码搜索授权、电脑操控权限引导、文件编辑模式与受保护操作 */
export default function Screen() {
  return <ToolsPage />;
}
