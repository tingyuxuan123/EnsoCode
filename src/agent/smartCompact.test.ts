import { describe, expect, it } from 'vitest';
import {
  assignCompactRoute,
  formatSmartCompactSummaryModel,
  smartCompactInlineExtension,
} from './smartCompact';

describe('smartCompactInlineExtension', () => {
  it('挂 Enso compact 工厂，开关开时由 loader 内嵌加载', () => {
    const ext = smartCompactInlineExtension();
    expect(ext.name).toBe('enso-compact');
    expect(ext.hidden).toBe(true);
    expect(typeof ext.factory).toBe('function');
  });
});

describe('formatSmartCompactSummaryModel', () => {
  it('订阅走 oauthAccountKey/modelId', () => {
    expect(
      formatSmartCompactSummaryModel({
        api: 'anthropic-messages',
        baseUrl: 'https://api.anthropic.com',
        apiKey: 'k',
        modelId: 'claude-sonnet-4',
        settingsProviderId: 'anthropic-1',
        oauthAccountKey: 'anthropic',
      })
    ).toBe('anthropic/claude-sonnet-4');
  });

  it('自定义 API 走 worker 注册 id', () => {
    expect(
      formatSmartCompactSummaryModel({
        api: 'openai-completions',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-test',
        modelId: 'gpt-4.1',
        settingsProviderId: 'openai-entry',
      })
    ).toMatch(/^enso-[0-9a-f]+-[0-9a-f]+\/gpt-4\.1$/);
  });
});

describe('assignCompactRoute', () => {
  const model = {
    api: 'openai-completions' as const,
    baseUrl: 'https://api.openai.com/v1',
    apiKey: 'sk-test',
    modelId: 'gpt-4.1',
    settingsProviderId: 'openai-entry',
  };

  it('后一次写入覆盖摘要模型；不传模型则清空，压缩时改跟会话模型', () => {
    const route: { summaryModel?: { provider: string; id: string }; mode?: 'fast' } = {};
    assignCompactRoute(route, model, 'fast');
    expect(route.mode).toBe('fast');
    expect(route.summaryModel?.id).toBe('gpt-4.1');
    assignCompactRoute(route, { ...model, modelId: 'gpt-4.1-mini' }, 'thorough');
    expect(route.summaryModel?.id).toBe('gpt-4.1-mini');
    expect(route.mode).toBe('thorough');
    assignCompactRoute(route, undefined, undefined);
    expect(route.summaryModel).toBeUndefined();
    expect(route.mode).toBeUndefined();
  });
});
