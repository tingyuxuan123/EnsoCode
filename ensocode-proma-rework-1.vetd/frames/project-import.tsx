export const frame = { width: 1440, height: 900, title: "项目 · 导入历史会话" };

import { useEffect } from 'react';
import { useWorkbench } from '../components/Workbench';
import WorkbenchScreen from './index';

/** 从本地 AI 应用导入：会话列表（消息数、时间）、选中预览、没有找到会话的空态 */
export default function ProjectImportFrame() {
  const { setProjectDialog, setDialogProject } = useWorkbench();
  useEffect(() => { setDialogProject('enso'); setProjectDialog('import'); }, []);
  return <WorkbenchScreen running={false} />;
}
