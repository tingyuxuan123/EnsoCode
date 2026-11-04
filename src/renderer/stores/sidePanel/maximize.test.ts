import { beforeEach, expect, it, vi } from 'vitest';

vi.mock('@/stores/sessions', () => ({
  useSessionsStore: { getState: () => ({ activeId: 's', conversations: {} }) },
}));

import { useSidePanelStore } from '@/stores/sidePanel';
import { CHAT_MIN_WIDTH, resolveSidePanelWidth, SIDE_PANEL_HANDLE_WIDTH } from './width';

beforeEach(() => {
  useSidePanelStore.setState({ fullscreen: false, uiByConversation: {} });
});

it('拉满面板时保留会话区：不进入全屏，显示宽度截到工作区减去会话区最小宽度', () => {
  useSidePanelStore.getState().maximize('s');
  const state = useSidePanelStore.getState();
  expect(state.fullscreen).toBe(false);
  expect(state.uiByConversation.s.open).toBe(true);
  const width = state.uiByConversation.s.width;
  expect(resolveSidePanelWidth(width, 1600)).toBe(1600 - CHAT_MIN_WIDTH - SIDE_PANEL_HANDLE_WIDTH);
});

it('用户已全屏时不打断', () => {
  useSidePanelStore.setState({ fullscreen: true });
  useSidePanelStore.getState().maximize('s');
  expect(useSidePanelStore.getState().fullscreen).toBe(true);
});
