import { expect, it, vi } from 'vitest';
import { loadPluginRenderer } from './loader';
import { pluginComposerSlots, resetPluginSlots } from './registry';

it('contains a throwing plugin disposer and still revokes every slot', async () => {
  resetPluginSlots();
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    const handle = await loadPluginRenderer('local.test', 'ui.js', {
      importModule: async () => ({
        onLoad: (value) => {
          const enso = value as { slots: { register(value: unknown): void } };
          enso.slots.register({ slot: 'composer.left', component: () => null });
          return () => {
            throw new Error('broken disposer');
          };
        },
      }),
      react: {},
      sessionId: () => 'session',
      call: async () => null,
      draft: () => ({ ok: true, value: null }),
    });
    expect(pluginComposerSlots('left')).toHaveLength(1);
    expect(() => handle.dispose()).not.toThrow();
    expect(pluginComposerSlots('left')).toHaveLength(0);
  } finally {
    resetPluginSlots();
    warn.mockRestore();
  }
});
