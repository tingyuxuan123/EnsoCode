import { beforeAll, describe, expect, it, vi } from 'vitest';
import type * as SettingsModule from './index';
import { mergeSettingsState } from './migrate';

const documentElement = {
  lang: 'en',
  dataset: {} as Record<string, string>,
  classList: { toggle: vi.fn() },
  style: { setProperty: vi.fn(), removeProperty: vi.fn() },
};

vi.stubGlobal('navigator', { language: 'en-US' });
vi.stubGlobal('document', { documentElement });
vi.stubGlobal('window', {
  matchMedia: () => ({ matches: false, addEventListener: vi.fn() }),
  electronAPI: {
    settings: {
      read: vi.fn(async () => null),
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

describe('accent color setting', () => {
  beforeAll(async () => {
    settings = await import('./index');
  });

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
