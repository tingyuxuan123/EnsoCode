import { beforeAll, describe, expect, it, vi } from 'vitest';
import type * as SettingsModule from './index';

const setProperty = vi.fn();
const read = vi.fn(async (): Promise<Record<string, unknown> | null> => null);
const writeKey = vi.fn(async () => true);
vi.stubGlobal('navigator', { language: 'en-US' });
vi.stubGlobal('document', {
  documentElement: {
    dataset: {},
    classList: { toggle: vi.fn() },
    style: { setProperty, removeProperty: vi.fn() },
  },
});
vi.stubGlobal('window', {
  matchMedia: () => ({ matches: false, addEventListener: vi.fn() }),
  electronAPI: {
    settings: { read, writeKey, onChanged: vi.fn() },
    sourceAuthority: {
      read: vi.fn(async () => ({ projects: [], conversations: [] })),
      onChanged: vi.fn(),
    },
  },
});
let settings: typeof SettingsModule;
beforeAll(async () => {
  settings = await import('./index');
});

describe('聊天排版持久化', () => {
  it('默认不改变渲染比例，偏好只写聊天变量', () => {
    const store = settings.useSettingsStore.getState();
    expect(store).toHaveProperty('chatTypography.body.fontSize', 15);
    setProperty.mockClear();
    store.setChatTypography({ ...store.chatTypography, body: { fontSize: 20, fontWeight: 500 } });
    expect(settings.useSettingsStore.getState().chatTypography.body.fontSize).toBe(20);
    expect(setProperty.mock.calls.every(([key]) => key.startsWith('--chat-'))).toBe(true);
    expect(writeKey).toHaveBeenCalledWith(
      'enso-settings',
      expect.objectContaining({
        state: expect.objectContaining({
          chatTypography: expect.objectContaining({ body: { fontSize: 20, fontWeight: 500 } }),
        }),
      })
    );
  });

  it('rehydrate规范化坏值，旧配置重置默认，不沿用上一个窗口状态', async () => {
    const store = settings.useSettingsStore;
    read.mockResolvedValueOnce({
      'enso-settings': {
        version: 18,
        state: { chatTypography: { body: { fontSize: 24, fontWeight: 450 } } },
      },
    });
    await store.persist.rehydrate();
    expect(store.getState()).toHaveProperty('chatTypography.body', {
      fontSize: 24,
      fontWeight: 400,
    });
    expect(setProperty).toHaveBeenCalledWith('--chat-body-scale', '1.6');
    read.mockResolvedValueOnce({ 'enso-settings': { version: 18, state: {} } });
    await store.persist.rehydrate();
    expect(store.getState()).toHaveProperty('chatTypography.body.fontSize', 15);
    expect(setProperty).toHaveBeenCalledWith('--chat-body-scale', '1');
  });
});
