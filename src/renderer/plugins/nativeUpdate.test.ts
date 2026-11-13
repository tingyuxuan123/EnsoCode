import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  mergePluginCommands,
  pluginCommandFor,
  pluginSlashCommands,
  runPluginCommand,
  setPluginCommands,
} from './commands';
import { pluginFileViewersFor } from './fileViewers';
import { resolvePluginKeybindings } from './keybindings';
import {
  pluginMessageLeaf,
  pluginThinkingBody,
  registerPluginSlot,
  resetPluginSlots,
} from './registry';
import { rendererPluginKey, syncPluginRenderers } from './rendererReload';

afterEach(() => {
  resetPluginSlots();
  setPluginCommands([]);
  vi.unstubAllGlobals();
});

describe('native plugin update', () => {
  it('merges declared and dynamic commands without shadowing or duplicate dynamic ids', () => {
    expect(
      mergePluginCommands(
        [{ id: 'one', title: 'declared' }],
        [
          { id: 'one', title: 'shadow' },
          { id: 'two', title: 'dynamic' },
          { id: 'two', title: 'duplicate' },
        ]
      )
    ).toEqual([
      { id: 'one', title: 'declared' },
      { id: 'two', title: 'dynamic' },
    ]);
  });
  it('only runs an enabled command from the current registry and forwards actual activation', async () => {
    const call = vi.fn().mockResolvedValue({ ok: true, value: null });
    vi.stubGlobal('window', { electronAPI: { extensionPlugins: { call } } });
    const command = { pluginId: 'local.test', pluginName: 'Test', id: 'go', title: 'Go' };
    setPluginCommands([command]);
    expect(pluginSlashCommands()[0].name).toBe('/local.test:go');
    expect(pluginCommandFor('/local.test:go')).toEqual(command);
    expect(await runPluginCommand(command, 'session')).toBeNull();
    expect(call).toHaveBeenCalledWith(
      expect.objectContaining({ gesture: false, sessionId: 'session' })
    );
    setPluginCommands([]);
    expect(await runPluginCommand(command, 'session')).toBeTruthy();
    expect(call).toHaveBeenCalledTimes(1);
  });
  it('resolves longest file extension first and excludes files named only as the extension', () => {
    const base = {
      pluginId: 'local.test',
      pluginName: 'Test',
      title: 'View',
      entry: 'view.html',
      default: false,
    };
    const viewers = [
      { ...base, id: 'short', extensions: ['.json'] },
      { ...base, id: 'long', extensions: ['.geo.json'] },
    ];
    expect(pluginFileViewersFor('map.GEO.JSON', viewers).map((v) => v.id)).toEqual([
      'long',
      'short',
    ]);
    expect(pluginFileViewersFor('.json', viewers)).toEqual([]);
  });
  it('keeps builtin bindings ahead of plugins and supports disabling defaults', () => {
    const command = {
      pluginId: 'local.test',
      pluginName: 'Test',
      id: 'go',
      title: 'Go',
      key: 'Mod+K',
    };
    const conflict = resolvePluginKeybindings([command], {}, { search: 'Mod+K' });
    expect(conflict.rows[0].conflict).toBe('search');
    expect(conflict.byBinding.size).toBe(0);
    expect(
      resolvePluginKeybindings([command], { 'plugin:local.test:go': '' }, {}).byBinding.size
    ).toBe(0);
  });
  it('adds thinking and leaf hooks without weakening plugin identity validation', () => {
    expect(() =>
      registerPluginSlot({ pluginId: '../bad', slot: 'thinking.body', component: () => null })
    ).toThrow();
    const dispose = registerPluginSlot({
      pluginId: 'local.test',
      slot: 'thinking.body',
      component: () => null,
    });
    registerPluginSlot({ pluginId: 'local.test', slot: 'message.leaf', component: () => null });
    expect(pluginThinkingBody()?.pluginId).toBe('local.test');
    expect(pluginMessageLeaf()?.pluginId).toBe('local.test');
    dispose();
    expect(pluginThinkingBody()).toBeUndefined();
  });
  it('preserves renderers across status-only changes and reloads on a new build', async () => {
    const plugin = {
      id: 'local.test',
      version: '1.0.0',
      build: 'a',
      state: 'enabled',
      renderer: 'ui.js',
      permissions: [],
    };
    const dispose = vi.fn();
    const loaded = new Map([[plugin.id, { key: rendererPluginKey(plugin), dispose }]]);
    const load = vi.fn().mockResolvedValue({ dispose: vi.fn() });
    await syncPluginRenderers(loaded, [plugin], load, () => true);
    expect(load).not.toHaveBeenCalled();
    await syncPluginRenderers(loaded, [{ ...plugin, build: 'b' }], load, () => true);
    expect(dispose).toHaveBeenCalledOnce();
    expect(load).toHaveBeenCalledOnce();
  });
});
