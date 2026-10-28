export const frame = { width: 1440, height: 900, title: "项目管理 · 添加项目弹窗" };

import { useEffect } from 'react';
import { useWorkbench } from '../components/Workbench';
import WorkbenchScreen from './index';

/**
 * 真实应用没有「项目管理」页：项目在侧栏里管理，添加/设置/分组/导入/归档都是主窗口上的弹窗。
 * 这一帧展示「添加项目」（本地 / SSH + 远程目录浏览 + 主机指纹）；其余弹窗见 project-* 帧。
 */
export default function ProjectsScreen() {
  const { setProjectDialog, setDialogProject } = useWorkbench();
  useEffect(() => { setDialogProject('enso'); setProjectDialog('add'); }, []);
  return <WorkbenchScreen running={false} />;
}
