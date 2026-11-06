import { beforeAll, describe, expect, it, vi } from 'vitest';
import type * as SettingsModule from './index';
import { mergeSettingsState } from './migrate';

const documentElement = {
  lang: 'en',
  dataset: {} as Record<string, string>,
  classList: { toggle: vi.fn() },
  style: { setProperty: vi.fn(), removeProperty: vi.fn() },
};
let systemDark = false;
const mediaChange = vi.fn();
const settingsRead = vi.fn<() => Promise<Record<string, unknown> | null>>(async () => null);

vi.stubGlobal('navigator', { language: 'en-US' });
vi.stubGlobal('document', { documentElement });
vi.stubGlobal('window', {
  matchMedia: () => ({ matches: systemDark, addEventListener: mediaChange }),
  electronAPI: {
    settings: {
      read: settingsRead,
      writeKey: vi.fn(async () => true),
      onChanged: vi.fn(),
    },
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
});

describe('desktop light palette', () => {
  it('is opt-in and restores the selected palette only for non-terminal light appearance', () => {
    const store = settings.useSettingsStore.getState();
    expect(store.lightPalette).toBe('ocean');
    store.setTheme('light');
    expect(documentElement.dataset.lightPalette).toBeUndefined();
    store.setLightPalette('mint-light');
    expect(documentElement.dataset.lightPalette).toBe('mint-light');
    store.setTheme('dark');
    expect(documentElement.dataset.lightPalette).toBeUndefined();
    expect(settings.useSettingsStore.getState().lightPalette).toBe('mint-light');
    store.setTerminalTheme('GitHub Light Default');
    store.setTheme('sync-terminal');
    expect(documentElement.dataset.lightPalette).toBeUndefined();
    store.setTheme('system');
    expect(documentElement.dataset.lightPalette).toBe('mint-light');
    const notifySystemChange = mediaChange.mock.calls.find(([event]) => event === 'change')?.[1];
    expect(notifySystemChange).toBeTypeOf('function');
    systemDark = true;
    notifySystemChange?.();
    expect(documentElement.dataset.lightPalette).toBeUndefined();
    systemDark = false;
    notifySystemChange?.();
    expect(documentElement.dataset.lightPalette).toBe('mint-light');
    store.setLightPalette('ocean');
    expect(documentElement.dataset.lightPalette).toBeUndefined();
  });

  it('applies Cloud Light with the same light-only rule', () => {
    const store = settings.useSettingsStore.getState();
    store.setTheme('light');
    store.setLightPalette('cloud-light');
    expect(settings.useSettingsStore.getState().lightPalette).toBe('cloud-light');
    expect(documentElement.dataset.lightPalette).toBe('cloud-light');
    store.setTheme('dark');
    expect(documentElement.dataset.lightPalette).toBeUndefined();
    store.setTheme('light');
    expect(documentElement.dataset.lightPalette).toBe('cloud-light');
    store.setLightPalette('ocean');
    expect(documentElement.dataset.lightPalette).toBeUndefined();
  });

  it('hydrates saved preferences and rejects an unknown or missing palette', async () => {
    const store = settings.useSettingsStore;
    for (const [saved, expected] of [
      [{ lightPalette: 'mint-light' }, 'mint-light'],
      [{ lightPalette: { palette: 'mint-light' } }, 'ocean'],
      [{ lightPalette: 'cloud-light' }, 'cloud-light'],
      [{ lightPalette: 'cloud' }, 'ocean'],
      [{ lightPalette: 'mint-light' }, 'mint-light'],
      [{}, 'ocean'],
    ] as const) {
      settingsRead.mockResolvedValueOnce({
        'enso-settings': { version: 18, state: { theme: 'light', ...saved } },
      });
      await store.persist.rehydrate();
      expect(store.getState().lightPalette).toBe(expected);
      expect(documentElement.dataset.lightPalette).toBe(
        expected === 'ocean' ? undefined : expected
      );
    }
  });
});

describe('accent color setting', () => {
  it('缺省晴空蓝，切换时写入 html[data-accent]', () => {
    expect(settings.useSettingsStore.getState().accentColor).toBe('ocean');
    settings.useSettingsStore.getState().setAccentColor('teal');
    expect(settings.useSettingsStore.getState().accentColor).toBe('teal');
    expect(documentElement.dataset.accent).toBe('teal');
    settings.useSettingsStore.getState().setAccentColor('violet');
    expect(documentElement.dataset.accent).toBe('violet');
  });

  it('持久化里的非法强调色合并时落回默认值', () => {
    const current = { editMode: 'apply_patch' as const, accentColor: 'violet' as const };
    expect(mergeSettingsState({ accentColor: 'neon' }, current).accentColor).toBe('ocean');
    expect(mergeSettingsState({ accentColor: 'amber' }, current).accentColor).toBe('amber');
    expect(mergeSettingsState({}, current).accentColor).toBe('violet');
  });
});
