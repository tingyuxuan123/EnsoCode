import { beforeAll, describe, expect, it, vi } from 'vitest';
import type * as SettingsModule from './index';
import { SETTINGS_VERSION } from './migrate';

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

describe('Wiki 记忆默认设置', () => {
  it('默认开启自动编译会话到 Wiki 并默认使用简体中文，同时保留显式关闭与自定义语言', () => {
    const store = settings.useSettingsStore;
    expect(store.getState().memoryDistillEnabled).toBe(true);
    expect(store.getState().memoryLanguage).toBe('zh');

    store.getState().setMemoryDistillEnabled(false);
    expect(store.getState().memoryDistillEnabled).toBe(false);
    expect(writeKey).toHaveBeenLastCalledWith(
      'enso-settings',
      expect.objectContaining({
        state: expect.objectContaining({ memoryDistillEnabled: false }),
      })
    );

    store.getState().setMemoryDistillEnabled('false' as unknown as boolean);
    expect(store.getState().memoryDistillEnabled).toBe(true);

    store.getState().setMemoryLanguage('en');
    expect(store.getState().memoryLanguage).toBe('en');
    store.getState().setMemoryLanguage('auto');
    expect(store.getState().memoryLanguage).toBe('auto');
    store.getState().setMemoryLanguage('invalid');
    expect(store.getState().memoryLanguage).toBe('zh');
  });

  it('水合脏持久化值时仅显式 false 关闭自动编译，非法语言回退简体中文', async () => {
    for (const memoryDistillEnabled of [true, false, null, undefined, 0, 'false']) {
      disk.value = {
        'enso-settings': {
          state: { memoryDistillEnabled, memoryLanguage: 'unknown' },
          version: SETTINGS_VERSION,
        },
      };
      await settings.useSettingsStore.persist.rehydrate();
      expect(settings.useSettingsStore.getState().memoryDistillEnabled).toBe(
        memoryDistillEnabled !== false
      );
      expect(settings.useSettingsStore.getState().memoryLanguage).toBe('zh');
    }
  });
});
