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

describe('聊天链接内置浏览器偏好', () => {
  it('默认开启，可单独关闭、落盘并重新水合，不更改工具开关', async () => {
    const state = settings.useSettingsStore.getState();
    expect(state.openLinksInBuiltinBrowser).toBe(true);
    state.setOpenLinksInBuiltinBrowser(false);
    expect(settings.useSettingsStore.getState().openLinksInBuiltinBrowser).toBe(false);
    expect(settings.useSettingsStore.getState().disabledBuiltinTools).toEqual(
      state.disabledBuiltinTools
    );
    expect(writeKey).toHaveBeenLastCalledWith(
      'enso-settings',
      expect.objectContaining({
        state: expect.objectContaining({ openLinksInBuiltinBrowser: false }),
      })
    );
    await settings.useSettingsStore.persist.rehydrate();
    expect(settings.useSettingsStore.getState().openLinksInBuiltinBrowser).toBe(false);
  });

  it('旧配置或坏类型回落 true，显式 false 保留', async () => {
    const current = {
      editMode: 'apply_patch' as const,
      accentColor: 'ocean' as const,
      openLinksInBuiltinBrowser: false,
    };
    for (const value of [true, false, undefined, null, 'false', 0, [], {}]) {
      expect(
        mergeSettingsState({ openLinksInBuiltinBrowser: value }, current).openLinksInBuiltinBrowser
      ).toBe(value !== false);
      disk.value = {
        'enso-settings': { state: { openLinksInBuiltinBrowser: value }, version: SETTINGS_VERSION },
      };
      await settings.useSettingsStore.persist.rehydrate();
      expect(settings.useSettingsStore.getState().openLinksInBuiltinBrowser).toBe(value !== false);
    }
    expect(mergeSettingsState({}, current).openLinksInBuiltinBrowser).toBe(true);
  });
});
