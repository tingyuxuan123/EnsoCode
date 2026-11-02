import { beforeAll, describe, expect, it, vi } from 'vitest';
import type * as SettingsModule from './index';
import { mergeSettingsState, SETTINGS_VERSION } from './migrate';

const disk = vi.hoisted(() => ({ value: null as unknown }));
vi.stubGlobal('navigator', { language: 'en-US' });
vi.stubGlobal('document', {
  documentElement: {
    dataset: {},
    lang: 'en',
    classList: { toggle: vi.fn() },
    style: { setProperty: vi.fn(), removeProperty: vi.fn() },
  },
});
const writeKey = vi.fn(async (_key: string, value: unknown) => {
  disk.value = { 'enso-settings': value };
  return true;
});
vi.stubGlobal('window', {
  matchMedia: () => ({ matches: false, addEventListener: vi.fn() }),
  electronAPI: {
    settings: { read: vi.fn(async () => disk.value), writeKey, onChanged: vi.fn() },
    sourceAuthority: {
      read: vi.fn(async () => ({ projects: [], conversations: [] })),
      onChanged: vi.fn(() => vi.fn()),
    },
    instructions: { delete: vi.fn(async () => ({ ok: true })) },
  },
});

let settings: typeof SettingsModule;
beforeAll(async () => {
  settings = await import('./index');
  await settings.useSettingsStore.persist.rehydrate();
});

describe('LCU 本机设置', () => {
  it('默认开启，单独关闭并落盘，不改变内置 Computer 开关', async () => {
    const state = settings.useSettingsStore.getState();
    expect(state.lcuEnabled).toBe(true);
    state.setLcuEnabled(false);
    expect(settings.useSettingsStore.getState().lcuEnabled).toBe(false);
    expect(settings.useSettingsStore.getState().disabledBuiltinTools).toEqual(
      state.disabledBuiltinTools
    );
    expect(writeKey).toHaveBeenLastCalledWith(
      'enso-settings',
      expect.objectContaining({ state: expect.objectContaining({ lcuEnabled: false }) })
    );
    await settings.useSettingsStore.persist.rehydrate();
    expect(settings.useSettingsStore.getState().lcuEnabled).toBe(false);
    settings.useSettingsStore.getState().toggleBuiltinTool('computer', true);
    expect(settings.useSettingsStore.getState().lcuEnabled).toBe(false);
    settings.useSettingsStore.getState().setLcuEnabled(true);
    expect(settings.useSettingsStore.getState().disabledBuiltinTools).not.toContain('computer');
  });

  it('水合旧配置及坏类型回落 true，显式 false 保留', async () => {
    const current = {
      editMode: 'apply_patch' as const,
      accentColor: 'ocean' as const,
      lcuEnabled: false,
    };
    for (const lcuEnabled of [true, false, null, undefined, 0, 1, 'false', [], {}]) {
      const expected = lcuEnabled !== false;
      expect(mergeSettingsState({ lcuEnabled }, current).lcuEnabled).toBe(expected);
      disk.value = { 'enso-settings': { state: { lcuEnabled }, version: SETTINGS_VERSION } };
      await settings.useSettingsStore.persist.rehydrate();
      expect(settings.useSettingsStore.getState().lcuEnabled).toBe(expected);
    }
    expect(mergeSettingsState({}, current).lcuEnabled).toBe(true);
  });
});
