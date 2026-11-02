import { beforeAll, describe, expect, it, vi } from 'vitest';
import type * as SettingsModule from './index';
import { mergeSettingsState } from './migrate';

vi.stubGlobal('navigator', { language: 'en-US' });
vi.stubGlobal('document', {
  documentElement: {
    dataset: {},
    lang: 'en',
    classList: { toggle: vi.fn() },
    style: { setProperty: vi.fn(), removeProperty: vi.fn() },
  },
});
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

describe('RTK setting', () => {
  beforeAll(async () => {
    settings = await import('./index');
  });

  it('默认开启，并可显式关闭', () => {
    expect(settings.useSettingsStore.getState().rtkEnabled).toBe(true);
    settings.useSettingsStore.getState().setRtkEnabled(false);
    expect(settings.useSettingsStore.getState().rtkEnabled).toBe(false);
  });
  it('design defaults on and bad persisted values normalize to default', () => {
    const state = settings.useSettingsStore.getState();
    expect(state.designEnabled).toBe(true);
    state.setDesignEnabled(false);
    expect(settings.useSettingsStore.getState().designEnabled).toBe(false);
    for (const value of [true, false, null, undefined, 'false', 0, {}]) {
      expect(
        mergeSettingsState({ designEnabled: value }, { ...state, designEnabled: false })
          .designEnabled
      ).toBe(value !== false);
    }
  });
});
