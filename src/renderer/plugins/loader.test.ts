import { beforeEach, expect, it, vi } from 'vitest';
import { loadPluginRenderer, type PluginRendererDeps } from './loader';
import { pluginComposerSlots, resetPluginSlots } from './registry';

beforeEach(resetPluginSlots);
type Enso = {
  slots: { register(entry: object): () => void };
  dispatch(action: string, payload: Record<string, unknown>): Promise<unknown>;
  composer?: { readDraft(): Promise<unknown>; replaceDraft(input: object): Promise<unknown> };
};
function deps(onLoad: (enso: unknown) => unknown): PluginRendererDeps {
  return {
    react: {},
    importModule: async () => ({ onLoad }),
    sessionId: () => 's1',
    call: vi.fn(async () => 'pong'),
    draft: vi.fn(() => ({ ok: true as const, value: 'draft' })),
  };
}
it('loads the local module, registers slots and disposes listeners exactly once', async () => {
  let api!: Enso;
  const cleanup = vi.fn();
  const d = deps((enso) => {
    api = enso as Enso;
    api.slots.register({ slot: 'composer.right', component: () => null });
    return cleanup;
  });
  const handle = await loadPluginRenderer('a.b', 'ui.js', d, { draft: true });
  expect(pluginComposerSlots('right')).toHaveLength(1);
  expect(await api.dispatch('plugin.call', { method: 'ping', args: {} })).toBe('pong');
  expect(d.call).toHaveBeenCalledWith('a.b', 'ping', {}, 's1');
  handle.dispose();
  handle.dispose();
  expect(pluginComposerSlots('right')).toHaveLength(0);
  expect(cleanup).toHaveBeenCalledTimes(1);
  await expect(api.composer?.readDraft()).rejects.toMatchObject({ code: 'PLUGIN_DISABLED' });
  expect(() => api.slots.register({ slot: 'composer.right', component: () => null })).toThrow();
});
it('rejects undeclared and cross-plugin tool slots and cleans partial failure', async () => {
  await expect(
    loadPluginRenderer(
      'a.b',
      'ui.js',
      deps((enso) => {
        const api = enso as Enso;
        api.slots.register({ slot: 'composer.right', component: () => null });
        api.slots.register({
          pluginId: 'c.d',
          slot: 'tool.card',
          toolName: 'foreign',
          component: () => null,
        });
      }),
      { tools: ['own'] }
    )
  ).rejects.toThrow();
  expect(pluginComposerSlots('right')).toHaveLength(0);
});
it('does not activate a module that was disabled while import was pending', async () => {
  const onLoad = vi.fn();
  let enabled = false;
  await expect(
    loadPluginRenderer('a.b', 'ui.js', deps(onLoad), { active: () => enabled })
  ).rejects.toMatchObject({ code: 'PLUGIN_DISABLED' });
  expect(onLoad).not.toHaveBeenCalled();
  enabled = true;
});
it('revokes slots immediately when disabled during an async onLoad', async () => {
  const controller = new AbortController();
  let finish!: () => void;
  const initialized = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const promise = loadPluginRenderer(
    'a.b',
    'ui.js',
    deps(async (enso) => {
      (enso as Enso).slots.register({ slot: 'composer.right', component: () => null });
      await initialized;
    }),
    { signal: controller.signal }
  );
  await Promise.resolve();
  expect(pluginComposerSlots('right')).toHaveLength(1);
  controller.abort();
  expect(pluginComposerSlots('right')).toHaveLength(0);
  finish();
  await expect(promise).rejects.toMatchObject({ code: 'PLUGIN_DISABLED' });
});
