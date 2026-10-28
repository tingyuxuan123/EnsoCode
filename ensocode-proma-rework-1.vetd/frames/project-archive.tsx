export const frame = { width: 1440, height: 900, title: "项目 · 已归档与清理" };

import { useEffect } from 'react';
import { useWorkbench } from '../components/Workbench';
import WorkbenchScreen from './index';

/** 已归档：按项目分组、搜索、取消归档、删除、清理已归档（超过 N 天 / 删除全部） */
export default function ProjectArchiveFrame() {
  const { setProjectDialog } = useWorkbench();
  useEffect(() => setProjectDialog('archive'), []);
  return <WorkbenchScreen running={false} />;
}
