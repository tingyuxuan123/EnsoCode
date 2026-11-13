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

describe('Microcompaction 设置', () => {
  it('默认开启，可显式关闭并落盘，且只接受布尔 false 关闭', () => {
    expect(settings.useSettingsStore.getState().microcompactEnabled).toBe(true);
    settings.useSettingsStore.getState().setMicrocompactEnabled(false);
    expect(settings.useSettingsStore.getState().microcompactEnabled).toBe(false);
    expect(writeKey).toHaveBeenLastCalledWith(
      'enso-settings',
      expect.objectContaining({
        state: expect.objectContaining({ microcompactEnabled: false }),
      })
    );
    settings.useSettingsStore.getState().setMicrocompactEnabled(true);
    expect(settings.useSettingsStore.getState().microcompactEnabled).toBe(true);
    // 脏输入（字符串 'false' 等）不能当作关闭
    settings.useSettingsStore.getState().setMicrocompactEnabled('false' as unknown as boolean);
    expect(settings.useSettingsStore.getState().microcompactEnabled).toBe(true);
  });

  it('水合脏持久化值回落 true，只有显式 false 才关闭', async () => {
    for (const microcompactEnabled of [true, false, null, undefined, 0, 1, 'false', [], {}]) {
      const expected = microcompactEnabled !== false;
      disk.value = {
        'enso-settings': { state: { microcompactEnabled }, version: SETTINGS_VERSION },
      };
      await settings.useSettingsStore.persist.rehydrate();
      expect(settings.useSettingsStore.getState().microcompactEnabled).toBe(expected);
    }
  });
});
