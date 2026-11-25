import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  bind: vi.fn(),
  emit: vi.fn(),
  canvasListeners: new Set<(controller: unknown) => void>(),
}));
vi.mock('@/stores/sessions', async () => {
  const { create } = await import('zustand');
  return {
    useSessionsStore: create(() => ({
      activeId: 's1',
      conversations: {
        s1: {
          status: 'running',
          messages: [],
          designToolActivity: {
            'code/1': { id: 'code/1', toolName: 'edit', path: 'd.vetd/frames/a.tsx' },
          },
        },
      },
    })),
  };
});
vi.mock('@/stores/settings', () => ({
  useSettingsStore: (select: (s: unknown) => unknown) => select({ language: 'en' }),
}));
vi.mock('./host/main-host', () => ({ createMainDesignHost: () => ({}) }));
vi.mock('./runtime', () => ({ setDesignViewingSession: mocks.bind }));
vi.mock('./host/context', () => ({
  emitDesignConversation: mocks.emit,
  syncDesignConversationActivity: vi.fn(),
}));
vi.mock('./vetta/src/canvas/design-runtime', () => ({
  onCanvasController: (listener: (c: unknown) => void) => {
    mocks.canvasListeners.add(listener);
    listener(null);
    return () => mocks.canvasListeners.delete(listener);
  },
}));

import { DesignRuntimeHost } from './DesignRuntimeHost';

afterEach(() => {
  mocks.bind.mockReset();
  mocks.emit.mockClear();
  mocks.canvasListeners.clear();
});

it('waits for the conversation binding, then replays unfinished calls when a controller mounts', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const binding = Promise.withResolvers<void>();
  mocks.bind.mockReturnValue(binding.promise);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<DesignRuntimeHost />));
    expect(mocks.canvasListeners.size).toBe(0);
    expect(mocks.emit).not.toHaveBeenCalled();
    await act(async () => {
      binding.resolve();
      await binding.promise;
    });
    expect(mocks.canvasListeners.size).toBe(1);
    expect(mocks.emit).not.toHaveBeenCalled();
    act(() => {
      for (const listener of mocks.canvasListeners) listener({});
    });
    expect(mocks.emit).toHaveBeenCalledWith({
      type: 'tool-call-args',
      toolCallId: 'code/1',
      toolName: 'edit',
      args: { path: 'd.vetd/frames/a.tsx' },
    });
    mocks.emit.mockClear();
    act(() => {
      for (const listener of mocks.canvasListeners) listener(null);
    });
    act(() => {
      for (const listener of mocks.canvasListeners) listener({});
    });
    expect(mocks.emit).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
    expect(mocks.canvasListeners.size).toBe(0);
  }
});
