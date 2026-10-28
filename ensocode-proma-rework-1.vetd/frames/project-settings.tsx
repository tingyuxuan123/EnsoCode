export const frame = { width: 1440, height: 900, title: "项目 · 项目设置" };

import { useEffect } from 'react';
import { useWorkbench } from '../components/Workbench';
import WorkbenchScreen from './index';

/** 别名、路径、项目组、默认模型与思考、跟随全局内置工具、统一 Agent 模式、撤销项目扩展信任 */
export default function ProjectSettingsFrame() {
  const { setProjectDialog, setDialogProject } = useWorkbench();
  useEffect(() => { setDialogProject('enso'); setProjectDialog('settings'); }, []);
  return <WorkbenchScreen running={false} />;
}
