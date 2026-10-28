export const frame = { width: 960, height: 680, title: "设置 · 资源" };

import { ResourcesPage } from '../components/settings/extra/Usage';

/** 内存（应用进程 / Agent 与工具 / 其他子进程）、存储扫描与分类占用、会话清理（筛选、跳过运行中）、清理确认 */
export default function Screen() {
  return <ResourcesPage />;
}
