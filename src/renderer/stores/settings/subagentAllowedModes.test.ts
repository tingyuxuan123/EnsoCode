import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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

describe('subagent allowed modes settings', () => {
  beforeAll(async () => {
    settings = await import('./index');
  });

  beforeEach(() => {
    settings.useSettingsStore.setState({
      disabledBuiltinTools: [],
      subagentAllowedModes: ['task', 'coworker'],
      projects: [{ id: 'project-1', name: 'one', path: '/tmp/one' }],
    });
  });

  it('does not widen the mode mask when the unified tool is disabled and re-enabled', () => {
    const store = settings.useSettingsStore.getState();
    store.setSubagentAllowedModes(['task']);
    store.toggleBuiltinTool('subagent', false);
    store.toggleBuiltinTool('subagent', true);

    expect(settings.useSettingsStore.getState().subagentAllowedModes).toEqual(['task']);
  });

  it('stores and clears a project mode override explicitly', () => {
    settings.useSettingsStore.getState().setProjectSubagentAllowedModes('project-1', ['coworker']);
    expect(settings.useSettingsStore.getState().projects[0]?.subagentAllowedModes).toEqual([
      'coworker',
    ]);

    settings.useSettingsStore.getState().setProjectDisabledBuiltinTools('project-1', ['subagent']);
    settings.useSettingsStore.getState().setProjectDisabledBuiltinTools('project-1', []);
    expect(settings.useSettingsStore.getState().projects[0]?.subagentAllowedModes).toEqual([
      'coworker',
    ]);

    settings.useSettingsStore.getState().setProjectSubagentAllowedModes('project-1', null);
    expect(settings.useSettingsStore.getState().projects[0]?.subagentAllowedModes).toBeUndefined();
  });

  it('stores and revokes trusted project code sources', () => {
    const store = settings.useSettingsStore.getState();
    store.setProjectTrustedCode('project-1', ['b', 'a', 'a']);
    expect(settings.useSettingsStore.getState().projects[0]?.trustedProjectCode).toEqual([
      'a',
      'b',
    ]);
    store.setProjectTrustedCode('project-1', null);
    expect(settings.useSettingsStore.getState().projects[0]?.trustedProjectCode).toBeUndefined();
  });

  it('scratch 只跟随全局默认和工具，不允许项目级配置或信任提权', () => {
    const scratch = {
      id: 'scratch',
      name: 'Temporary chats',
      path: '/data/scratch',
      kind: 'scratch' as const,
    };
    settings.useSettingsStore.setState({ projects: [scratch] });
    const store = settings.useSettingsStore.getState();
    store.setProjectDefaultModel('scratch', { providerId: 'wrong', modelId: 'wrong' });
    store.setProjectDisabledBuiltinTools('scratch', []);
    store.setProjectSubagentAllowedModes('scratch', ['task', 'coworker']);
    store.setProjectTrustedCode('scratch', ['.pi/extensions']);
    expect(settings.useSettingsStore.getState().projects).toEqual([scratch]);
  });
});
