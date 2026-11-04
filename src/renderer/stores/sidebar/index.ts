import { create } from 'zustand';

const COLLAPSED_KEY = 'enso-sidebar-collapsed';

/** 用户上次的选择；读不到 localStorage（测试 / 隐私模式）按展开处理 */
export function readSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

function rememberCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0');
  } catch {
    // 持久化失败只影响下次启动的初始状态
  }
}

interface SidebarState {
  collapsed: boolean;
  /** 由侧边面板展开 / 拖拽临时收起：可自动恢复，不写入用户偏好 */
  auto: boolean;
  /** 用户操作（图标轨按钮、快捷键）：状态归用户所有 */
  toggle: () => void;
  /** 只在项目栏开着时收起，并标记为自动 */
  autoCollapse: () => void;
  /** 只恢复自动收起的；用户自己收起的保持不动 */
  autoRestore: () => void;
}

export const useSidebarStore = create<SidebarState>()((set, get) => ({
  collapsed: readSidebarCollapsed(),
  auto: false,
  toggle: () => {
    const collapsed = !get().collapsed;
    set({ collapsed, auto: false });
    rememberCollapsed(collapsed);
  },
  autoCollapse: () => {
    if (get().collapsed) return;
    set({ collapsed: true, auto: true });
  },
  autoRestore: () => {
    if (!get().auto) return;
    set({ collapsed: false, auto: false });
  },
}));

/** 拖拽判断用的三态 */
export function sidebarDragState(state: Pick<SidebarState, 'collapsed' | 'auto'>) {
  return state.collapsed ? (state.auto ? 'auto' : 'user') : 'open';
}
