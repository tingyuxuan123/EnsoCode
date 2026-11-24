import { beforeAll, expect, it, vi } from 'vitest';
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

it('does not hydrate obsolete Wiki preferences, but keeps the local model idle policy', async () => {
  const obsolete = {
    memoryDistillEnabled: true,
    memoryDistillModel: { providerId: 'p', modelId: 'm' },
    memoryChatModel: 'remote',
    memoryLanguage: 'auto',
  };
  disk.value = {
    'enso-settings': {
      state: {
        ...obsolete,
        memoryModelIdleMinutes: 30,
        disabledBuiltinTools: ['memory', 'browser'],
      },
      version: SETTINGS_VERSION,
    },
  };
  const store = settings.useSettingsStore;
  await store.persist.rehydrate();
  for (const key of Object.keys(obsolete)) expect(store.getState()).not.toHaveProperty(key);
  expect(store.getState().disabledBuiltinTools).toEqual(['browser']);
  expect(store.getState().memoryModelIdleMinutes).toBe(30);
});
