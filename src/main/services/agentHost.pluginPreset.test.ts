import { describe, expect, it, vi } from 'vitest';

vi.mock('../../agent/index?modulePath', () => ({ default: '/tmp/agent.js' }));
vi.mock('./extensionPlugins', () => ({
  getExtensionPlugins: () => null,
  setPluginSessionBridge: vi.fn(),
}));

import {
  applyPluginPresetOverrides,
  mergePresetPromptKit,
  pluginPresetInstruction,
  pluginSkillPathsForMenu,
} from './agentHost';

const resolveModel = (model: { providerId: string; modelId: string }) =>
  model.modelId === 'missing'
    ? { ok: false as const, error: 'unavailable' }
    : { ok: true as const, model: { modelId: model.modelId } };

describe('plugin preset spawn overlays', () => {
  it('preserves unconfigured requests and rejects unavailable preset models', () => {
    const request = {
      model: { modelId: 'base' },
      thinkingLevel: 'low' as const,
      approvalMode: 'full' as const,
      disabledTools: ['bash'],
      resolveModel,
    };
    expect(applyPluginPresetOverrides(request)).toEqual({
      ok: true,
      model: request.model,
      thinkingLevel: 'low',
      approvalMode: 'full',
      disabledTools: ['bash'],
    });
    expect(
      applyPluginPresetOverrides({
        ...request,
        preset: { model: { providerId: 'p', modelId: 'missing' } },
      })
    ).toEqual({ ok: false, error: 'unavailable' });
  });
  it('overrides model and thinking, only tightens approval, unions disabled tools without mutating input', () => {
    const disabledTools = ['bash'];
    const input = {
      model: { modelId: 'base' },
      thinkingLevel: 'low' as const,
      approvalMode: 'assistant' as const,
      disabledTools,
      resolveModel,
      preset: {
        model: { providerId: 'p', modelId: 'preset' },
        thinkingLevel: 'high' as const,
        approvalMode: 'auto-edits' as const,
        disabledTools: ['bash', 'web'],
      },
    };
    expect(applyPluginPresetOverrides(input)).toEqual({
      ok: true,
      model: { modelId: 'preset' },
      thinkingLevel: 'high',
      approvalMode: 'auto-edits',
      disabledTools: ['bash', 'web'],
    });
    expect(disabledTools).toEqual(['bash']);
    expect(applyPluginPresetOverrides({ ...input, approvalMode: 'supervised' })).toMatchObject({
      approvalMode: 'supervised',
    });
    expect(applyPluginPresetOverrides({ ...input, approvalMode: undefined })).toMatchObject({
      approvalMode: 'auto-edits',
    });
  });
  it('replaces the global instruction lazily only when a plugin instruction exists', () => {
    const fallback = vi.fn(() => ({ path: '/g', content: 'global' }));
    expect(pluginPresetInstruction({ path: '/p', content: 'plugin' }, fallback)).toEqual({
      path: '/p',
      content: 'plugin',
    });
    expect(fallback).not.toHaveBeenCalled();
    expect(pluginPresetInstruction(undefined, fallback)).toEqual({ path: '/g', content: 'global' });
  });
  it('concatenates own/plugin tails while plugin role, boost and retry take precedence', () => {
    const own = {
      systemPrompt: 'own role',
      systemPromptAppend: 'own tail',
      systemPromptBoost: 'own boost',
      refusalRetryPrompt: 'own retry',
    };
    expect(mergePresetPromptKit(own)).toEqual(own);
    expect(
      mergePresetPromptKit(own, {
        systemPromptAppend: 'plugin tail',
        systemPromptBoost: 'plugin boost',
      })
    ).toEqual({
      ...own,
      systemPromptAppend: 'own tail\n\nplugin tail',
      systemPromptBoost: 'plugin boost',
    });
  });
  it('previews exactly the active plugin preset scope, falling back on disabled optional overlays', () => {
    const user = {
      id: 'u',
      name: 'U',
      skillIds: [],
      mcpServerIds: [],
      pluginPresetId: 'plugin:enso.example:review',
    };
    for (const presetId of ['u', 'plugin:enso.example:review']) {
      for (const ok of [true, false]) {
        expect(
          pluginSkillPathsForMenu(presetId, {
            resolve: () => user,
            claude: ['/c'],
            extension: {
              presetForSpawn: () => ({ ok }),
              skillPathsForSpawn: (active) => (active ? ['/always', '/scoped'] : ['/always']),
            },
          })
        ).toEqual(ok ? ['/c', '/always', '/scoped'] : ['/c', '/always']);
      }
    }
  });
});
