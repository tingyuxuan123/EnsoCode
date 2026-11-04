import { useSessionsStore } from '@/stores/sessions';
import { useSidebarStore } from '@/stores/sidebar';
import { isSidePanelExpanded, useSidePanelStore } from '@/stores/sidePanel';

/**
 * 侧边面板头部的「展开」：面板拉满但保留会话区，同时收起项目栏腾出宽度；
 * 再点一次还原面板宽度，并恢复自动收起的项目栏。全屏中点它先退出全屏。
 */
export function toggleSidePanelExpand(): void {
  const id = useSessionsStore.getState().activeId;
  if (!id) return;
  const side = useSidePanelStore.getState();
  if (side.fullscreen) {
    side.setFullscreen(false);
    return;
  }
  if (isSidePanelExpanded(side.uiByConversation[id])) {
    side.unmaximize(id);
    useSidebarStore.getState().autoRestore();
    return;
  }
  side.maximize(id);
  useSidebarStore.getState().autoCollapse();
}
