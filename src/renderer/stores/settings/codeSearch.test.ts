import { beforeAll, describe, expect, it, vi } from 'vitest';
import type * as SettingsModule from './index';

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
describe('代码搜索本机账号设置', () => {
  beforeAll(async () => {
    settings = await import('./index');
  });
  it('新安装未选账号且默认关闭代码搜索', () => {
    expect(settings.useSettingsStore.getState().codeSearchAccountKey).toBeNull();
    expect(settings.useSettingsStore.getState().disabledBuiltinTools).toContain('code_search');
  });
  it('显式选择 devin 账号并清除，不接受其它厂商及脏值', () => {
    expect(settings.useSettingsStore.getState().setCodeSearchAccountKey).toBeTypeOf('function');
    const set = settings.useSettingsStore.getState().setCodeSearchAccountKey;
    set('devin#2');
    expect(settings.useSettingsStore.getState().codeSearchAccountKey).toBe('devin#2');
    set('anthropic');
    expect(settings.useSettingsStore.getState().codeSearchAccountKey).toBeNull();
    set('devin');
    set(null);
    expect(settings.useSettingsStore.getState().codeSearchAccountKey).toBeNull();
  });
});
