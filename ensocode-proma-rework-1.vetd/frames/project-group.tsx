export const frame = { width: 1440, height: 900, title: "项目 · 分组编辑" };

import { useEffect } from 'react';
import { useWorkbench } from '../components/Workbench';
import WorkbenchScreen from './index';

/** 名称、颜色、分组默认模型、移入项目（可筛选）、删除分组 */
export default function ProjectGroupFrame() {
  const { setProjectDialog, setDialogProject } = useWorkbench();
  useEffect(() => { setDialogProject('daily'); setProjectDialog('group-edit'); }, []);
  return <WorkbenchScreen running={false} />;
}
