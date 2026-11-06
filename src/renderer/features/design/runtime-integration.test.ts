import { DESIGN_TOOL_SCHEMAS } from '@shared/design/toolSchemas';
import { afterEach, expect, it, vi } from 'vitest';

vi.mock('@/stores/sessions', () => ({
  useSessionsStore: { getState: () => ({ conversations: {} }) },
}));
vi.mock('@/stores/settings', () => ({
  useSettingsStore: { getState: () => ({ projects: [], language: 'en' }) },
}));

import { listRegisteredDesignTools, setDesignViewingSession, startDesignRuntime } from './runtime';

afterEach(() => vi.unstubAllGlobals());

function stubDesignApi(registerRuntime: (registration: unknown) => Promise<unknown>) {
  const subscriptions = { tool: 0 };
  vi.stubGlobal('electronAPI', {
    design: {
      storage: async () => ({ ok: true, data: null }),
      network: async () => ({ ok: false, error: 'offline', code: 'FAILED' }),
      resolveRoot: async (ref: unknown) => ({ ok: true, root: { ref, path: '/work' } }),
      onToolRequest: () => {
        subscriptions.tool += 1;
        return () => {};
      },
      onToolCancel: () => () => {},
      onHook: () => () => {},
      registerRuntime,
      respondTool: async () => ({ ok: true }),
    },
  });
  return subscriptions;
}

it('a failed runtime registration is retried on the next session change without re-activating', async () => {
  const registerRuntime = vi
    .fn<(registration: unknown) => Promise<unknown>>()
    .mockResolvedValueOnce({ ok: false, error: 'not ready', code: 'FAILED' })
    .mockResolvedValue({ ok: true });
  const subscriptions = stubDesignApi(registerRuntime);
  await expect(setDesignViewingSession('s1', {}, false)).rejects.toThrow('not ready');
  await expect(setDesignViewingSession('s2', {}, false)).resolves.toBeUndefined();
  expect(registerRuntime).toHaveBeenLastCalledWith({ viewingSessionId: 's2' });
  await startDesignRuntime({});
  expect(subscriptions.tool).toBe(1);
});

it('worker-side vetd_* schemas match what the upstream runtime registers (drift guard)', async () => {
  stubDesignApi(async () => ({ ok: true }));
  await startDesignRuntime({});
  const registered = new Map(
    listRegisteredDesignTools().map((tool) => [tool.name, JSON.parse(JSON.stringify(tool))])
  );
  expect([...registered.keys()].sort()).toEqual(DESIGN_TOOL_SCHEMAS.map((t) => t.name).sort());
  for (const schema of DESIGN_TOOL_SCHEMAS) {
    const upstream = registered.get(schema.name);
    expect(upstream?.description, schema.name).toBe(schema.description);
    expect(upstream?.parameters, schema.name).toEqual(
      JSON.parse(JSON.stringify(schema.parameters))
    );
  }
});
