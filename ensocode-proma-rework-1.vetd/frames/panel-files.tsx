export const frame = { width: 1440, height: 900, title: "右侧面板 · 文件（树 + 编辑器）" };

import { PanelFrame } from '../components/panel/PanelFrame';

/** 文件视图：w-56 文件树 + 多标签编辑器；打开 Sidebar.tsx 与 globals.css，其中一个有未保存改动 */
export default function PanelFiles() {
  return <PanelFrame kind="files" title="文件" preset={{ open: ['src/renderer/components/chat/Sidebar.tsx', 'src/renderer/styles/globals.css'], active: 'src/renderer/components/chat/Sidebar.tsx', dirty: ['src/renderer/styles/globals.css'], expanded: ['src', 'src/renderer', 'src/renderer/components', 'src/renderer/components/chat', 'src/renderer/styles'] }} />;
}
