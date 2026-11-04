export const SIDE_PANEL_DEFAULT_WIDTH = 360;
export const SIDE_PANEL_MIN_WIDTH = 280;
export const CHAT_MIN_WIDTH = 360;
export const SIDE_PANEL_HANDLE_WIDTH = 1;
/** 「拉满」的偏好宽度：大于任何工作区，显示时由 resolveSidePanelWidth 截到会话区最小宽度之外 */
export const SIDE_PANEL_MAX_PREFERENCE = 100_000;

/**
 * 只限制显示宽度，不覆盖会话偏好；窄窗口优先保留聊天区，允许面板小于通常的最小宽度。
 */
export function resolveSidePanelWidth(width: number, workspaceWidth: number): number {
  const preferred = Math.max(SIDE_PANEL_MIN_WIDTH, width);
  if (workspaceWidth <= 0) return preferred;
  const max = Math.max(0, workspaceWidth - CHAT_MIN_WIDTH - SIDE_PANEL_HANDLE_WIDTH);
  return Math.min(max, preferred);
}

/**
 * 从可见宽度开始拖动，避免窗口变窄后反向拖动时出现隐藏的超限距离。
 */
export function resizeSidePanelWidth(width: number, delta: number, workspaceWidth: number): number {
  const visible = resolveSidePanelWidth(width, workspaceWidth);
  const next = resolveSidePanelWidth(visible + delta, workspaceWidth);
  return next === visible ? width : next;
}

/** 拉到最宽后再往左拖多少才收起项目栏；恢复项目栏时会话区也要多留这么多余量，避免来回抖 */
export const SIDEBAR_SNAP_DISTANCE = 48;

/** open：项目栏开着；auto：拖动 / 展开时自动收起的；user：用户自己收起的（拖动不碰） */
export type SidebarDragState = 'open' | 'auto' | 'user';

/**
 * 拖动侧边面板手柄时，项目栏是否跟着收起 / 恢复。delta > 0 表示面板加宽（往左拖）。
 * - 面板已到上限还继续往左拖：累计越界距离，过阈值收起项目栏，面板就能接着变宽；
 *   catchUp 是越界总距离，收起后面板据此补宽，手柄回到鼠标位置而不是落后一截。
 * - 自动收起后往右拖：会话区放得下项目栏（再留余量）时恢复。
 */
export function sidePanelDragSidebar(input: {
  visible: number;
  delta: number;
  workspaceWidth: number;
  overflow: number;
  sidebar: SidebarDragState;
  sidebarWidth: number;
}): { overflow: number; action: 'collapse' | 'restore' | null; catchUp?: number } {
  const { visible, delta, workspaceWidth, overflow, sidebar, sidebarWidth } = input;
  if (sidebar === 'open' && delta > 0) {
    const max = workspaceWidth - CHAT_MIN_WIDTH - SIDE_PANEL_HANDLE_WIDTH;
    const desired = visible + delta;
    if (desired <= max) return { overflow: 0, action: null };
    const next = overflow + desired - max;
    return next >= SIDEBAR_SNAP_DISTANCE
      ? { overflow: 0, action: 'collapse', catchUp: next }
      : { overflow: next, action: null };
  }
  if (sidebar === 'auto' && delta < 0) {
    const panel = resolveSidePanelWidth(visible + delta, workspaceWidth);
    // 恢复后会话区 = 工作区 - 面板 - 面板手柄 - 项目栏 - 项目栏手柄
    const chat = workspaceWidth - panel - sidebarWidth - 2 * SIDE_PANEL_HANDLE_WIDTH;
    if (chat >= CHAT_MIN_WIDTH + SIDEBAR_SNAP_DISTANCE) return { overflow: 0, action: 'restore' };
  }
  return { overflow: 0, action: null };
}
