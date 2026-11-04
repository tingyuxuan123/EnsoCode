import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.stubGlobal('localStorage', { getItem: () => null, setItem() {}, removeItem() {} });
vi.mock('@/stores/sessions', () => ({
  useSessionsStore: { getState: () => ({ activeId: 's', conversations: {} }) },
}));

const { useSidePanelStore, isSidePanelExpanded } = await import('@/stores/sidePanel');
const { useSidebarStore } = await import('@/stores/sidebar');
const { toggleSidePanelExpand } = await import('./sidePanelExpand');

const ui = () => useSidePanelStore.getState().uiByConversation.s;

beforeEach(() => {
  useSidePanelStore.setState({
    fullscreen: false,
    uiByConversation: { s: { open: true, width: 420 } },
  });
  useSidebarStore.setState({ collapsed: false, auto: false });
});

describe('侧边面板「展开」', () => {
  it('展开：拉满面板（不全屏）并自动收起项目栏；再点还原宽度并恢复项目栏', () => {
    toggleSidePanelExpand();
    expect(isSidePanelExpanded(ui())).toBe(true);
    expect(useSidePanelStore.getState().fullscreen).toBe(false);
    expect(useSidebarStore.getState()).toMatchObject({ collapsed: true, auto: true });

    toggleSidePanelExpand();
    expect(ui()).toMatchObject({ open: true, width: 420 });
    expect(isSidePanelExpanded(ui())).toBe(false);
    expect(useSidebarStore.getState()).toMatchObject({ collapsed: false, auto: false });
  });

  it('项目栏本来就是用户收起的：还原时保持收起', () => {
    useSidebarStore.getState().toggle();
    toggleSidePanelExpand();
    toggleSidePanelExpand();
    expect(useSidebarStore.getState().collapsed).toBe(true);
  });

  it('处于全屏时，按钮先退出全屏', () => {
    useSidePanelStore.setState({ fullscreen: true });
    toggleSidePanelExpand();
    expect(useSidePanelStore.getState().fullscreen).toBe(false);
    expect(isSidePanelExpanded(ui())).toBe(false);
  });

  it('设计画布拉满过的面板，点按钮是还原到之前的宽度', () => {
    useSidePanelStore.getState().maximize('s');
    expect(isSidePanelExpanded(ui())).toBe(true);
    toggleSidePanelExpand();
    expect(ui().width).toBe(420);
  });
});
