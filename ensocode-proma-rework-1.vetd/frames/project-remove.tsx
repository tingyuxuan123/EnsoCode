export const frame = { width: 1440, height: 900, title: "项目 · 移除确认" };

import { useEffect } from 'react';
import { useWorkbench } from '../components/Workbench';
import WorkbenchScreen from './index';

/** 移除项目：「名称」和它的 N 个对话将从列表移除；不删除磁盘目录 */
export default function ProjectRemoveFrame() {
  const { setProjectDialog, setDialogProject } = useWorkbench();
  useEffect(() => { setDialogProject('relay'); setProjectDialog('remove'); }, []);
  return <WorkbenchScreen running={false} />;
}
