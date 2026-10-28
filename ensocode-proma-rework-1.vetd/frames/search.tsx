export const frame = { width: 1440, height: 900, title: "全局搜索（⌘K）" };

import { useEffect } from 'react';
import { useWorkbench } from '../components/Workbench';
import WorkbenchScreen from './index';

/** 范围 当前 / 全部 / 已归档；分组命中：对话正文、浏览器标签、设置项、动作；↑↓ 选择、Enter 打开 */
export default function SearchFrame() {
  const { setSearchOpen } = useWorkbench();
  useEffect(() => setSearchOpen(true), []);
  return <WorkbenchScreen running={false} />;
}
