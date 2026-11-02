import type {
  DesignHookEvent,
  DesignToolCancelEvent,
  DesignToolRequestEvent,
} from '@shared/types/design';
import { afterEach, expect, it, vi } from 'vitest';

vi.mock('@/stores/sessions', () => ({
  useSessionsStore: { getState: () => ({ conversations: {} }) },
}));
vi.mock('@/stores/settings', () => ({
  useSettingsStore: { getState: () => ({ projects: [], language: 'en' }) },
}));

import { designHooks, designPromptProviders, useDesignRegistry } from './host/registry';
import { listRegisteredDesignTools, startDesignRuntime } from './runtime';

afterEach(() => vi.unstubAllGlobals());
it('activates upstream headlessly, registers all tools and replies through design IPC', async () => {
  let invoke: ((event: DesignToolRequestEvent) => void) | undefined;
  const respondTool = vi.fn(async (_response: unknown) => ({ ok: true }));
  const registerRuntime = vi.fn(async (_registration: unknown) => ({ ok: true }));
  vi.stubGlobal('electronAPI', {
    design: {
      storage: async () => ({ ok: true, data: null }),
      network: async () => ({ ok: false, error: 'offline', code: 'FAILED' }),
      resolveRoot: async (ref: unknown) => ({ ok: true, root: { ref, path: '/work' } }),
      onToolRequest: (listener: typeof invoke) => {
        invoke = listener;
        return () => {};
      },
      onToolCancel: (_listener: (event: DesignToolCancelEvent) => void) => () => {},
      onHook: (_listener: (event: DesignHookEvent) => void) => () => {},
      registerRuntime,
      respondTool,
    },
  });
  await startDesignRuntime();
  expect(
    listRegisteredDesignTools()
      .map((tool) => tool.name)
      .sort()
  ).toEqual([
    'vetd_assets',
    'vetd_create',
    'vetd_direction',
    'vetd_export',
    'vetd_history',
    'vetd_install',
    'vetd_notes',
    'vetd_restore',
    'vetd_screenshot',
    'vetd_sizes',
    'vetd_status',
  ]);
  expect(designHooks.size).toBe(3);
  expect(designPromptProviders.size).toBe(2);
  expect(
    useDesignRegistry.getState().contributions.some((item) => item.kind === 'activity-tab')
  ).toBe(true);
  expect(registerRuntime).toHaveBeenCalledWith({ viewingSessionId: null });
  invoke?.({
    requestId: 'sizes',
    tool: 'vetd_sizes',
    params: {},
    session: { sessionId: 's', cwd: '/work' },
  });
  await vi.waitFor(() => expect(respondTool).toHaveBeenCalled());
  expect(respondTool.mock.calls[0]?.[0]).toMatchObject({
    requestId: 'sizes',
    ok: true,
    result: { content: [{ type: 'text' }] },
  });
});
