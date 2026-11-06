// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { useDesignRegistry } from '../host/registry';
import { useActivityTab } from '../vetta/sdk/activity-tab';
import { CANVAS_TAB_ID } from '../vetta/src/tab-ids';
import { BotDesignPanel } from './DesignPanel';

const h = vi.hoisted(() => ({
  report: vi.fn(async () => ({ ok: true })),
  controller: {},
  listener: null as ((controller: object | null) => void) | null,
}));
vi.mock('./DesignRoot', () => ({
  DesignRoot: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('@/stores/settings', () => ({
  useSettingsStore: { getState: () => ({ keybindings: {} }) },
}));
vi.mock('./useDesignCwd', () => ({ useDesignCwd: () => null }));
vi.mock('@/lib/keybindings', () => ({ effectiveKeybindings: () => ({}) }));
vi.mock('../vetta/src/canvas/design-runtime', () => ({
  getCanvasController: () => h.controller,
  onCanvasController: (listener: typeof h.listener) => {
    h.listener = listener;
    return () => {};
  },
}));
vi.mock('../host/shortcuts', () => ({ dispatchDesignShortcut: vi.fn() }));

afterEach(() => {
  useDesignRegistry.setState({ contributions: [], canvasSessionId: null });
  vi.unstubAllGlobals();
});

it('mounts a project-only Bot canvas and reports null rather than inventing a worker session', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('electronAPI', { design: { reportCanvas: h.report } });
  let scope: ReturnType<typeof useActivityTab> | undefined;
  const Canvas = () => {
    scope = useActivityTab();
    return null;
  };
  useDesignRegistry.setState({
    contributions: [{ kind: 'activity-tab', value: { id: CANVAS_TAB_ID, component: Canvas } }],
  });
  const container = document.createElement('div');
  const root = createRoot(container);
  const target = {
    chatId: 'empty-chat',
    projectId: 'project',
    cwd: '/work',
    path: '/work/draft.vetd',
  };
  await act(async () => root.render(createElement(BotDesignPanel, { target })));
  expect(scope).toEqual({ cwd: '/work', active: true, sessionId: undefined, bot: target });
  await act(async () => h.listener?.(h.controller));
  expect(h.report).toHaveBeenLastCalledWith({ sessionId: null, open: true });
  expect(useDesignRegistry.getState().canvasSessionId).toBeNull();
  await act(async () => root.unmount());
  expect(h.report).toHaveBeenLastCalledWith({ sessionId: null, open: false });
});
