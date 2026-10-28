import { useEffect } from 'react';
import WorkbenchScreen from '../../frames/index';
import { useWorkbench } from '../Workbench';
import { usePanelPreset } from './preset';

/**
 * 面板类帧的挂载器：先向视图注入状态（usePanelPreset），再打开对应标签（全屏可选），
 * 内容区仍渲染完整的工作台（对话 + 侧栏 + 状态栏），这样每张图都能看到面板在真实外壳里的位置。
 */
export function PanelFrame({ kind, title, preset, fullscreen = false, chat }: { kind: string; title?: string; preset?: Record<string, unknown>; fullscreen?: boolean; chat?: { running?: boolean; locked?: boolean } }) {
  const { openSideTab, setSideFullscreen, setPanelPreset } = useWorkbench();
  usePanelPreset(kind, preset ?? {});
  useEffect(() => {
    // 先注入状态并让面板视图重挂载，再打开对应标签（视图是 _layout 的兄弟节点，早于帧挂载）
    setPanelPreset({ kind, value: (preset ?? {}) as Record<string, unknown>, rev: Date.now() });
    openSideTab(kind, title);
    if (fullscreen) setSideFullscreen(true);
    // 只在挂载时应用一次，之后允许用户在预览里自由切换标签
  }, []);
  return <WorkbenchScreen running={chat?.running ?? false} locked={chat?.locked ?? false} />;
}
