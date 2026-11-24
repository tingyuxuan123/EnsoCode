import { describe, expect, it } from 'vitest';
import {
  extractModelOverrides,
  type ModelDirectorySnapshot,
  materializeOAuthModels,
  materializeProviders,
  parseModelDirectorySnapshot,
  referencedModelIds,
} from './modelDirectory';
import type { ModelEntry, ModelProvider } from './types/llm';

const directory: ModelDirectorySnapshot = {
  revision: 1,
  generatedAt: 1_700_000_000_000,
  providers: [
    {
      key: 'google-antigravity',
      kind: 'oauth',
      label: 'Google Antigravity',
      models: [
        { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash' },
        { id: 'gemini-3-pro', label: 'Gemini 3 Pro' },
        { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
      ],
      discoveredAt: 1_700_000_000_000,
    },
    {
      key: 'custom-uuid-1',
      kind: 'custom',
      label: '我的中转',
      models: [{ id: 'custom-model-a' }],
    },
  ],
};

const oauthProvider = (models: ModelEntry[], accountKey = 'google-antigravity'): ModelProvider => ({
  id: 'entry-1',
  name: 'Antigravity',
  api: 'openai-completions',
  apiKey: '',
  baseUrl: '',
  enabled: true,
  models,
  oauthAccountKey: accountKey,
});

const customProvider = (models: ModelEntry[]): ModelProvider => ({
  id: 'custom-uuid-1',
  name: '我的中转',
  api: 'openai-completions',
  apiKey: 'sk-test',
  baseUrl: 'https://example.com/v1',
  enabled: true,
  models,
});

describe('referencedModelIds', () => {
  it('坏设置不崩，固定 agent 和虚拟模型分类器引用按 provider 隔离', () => {
    for (const value of [null, [], 'bad', { projects: [null], virtualModels: [{}] }]) {
      expect([...referencedModelIds(value, 'oauth')]).toEqual([]);
    }
    const state = {
      agentTypes: [{ providerId: 'oauth', modelId: 'fixed', modelMode: 'fixed' }],
      virtualModels: [{ classifier: { model: { providerId: 'oauth', modelId: 'judge' } } }],
      defaultModel: { providerId: 'other', modelId: 'wrong-account' },
      providers: [{ id: 'oauth', models: [{ id: 'not-a-selection' }] }],
    };
    expect([...referencedModelIds(state, 'oauth')]).toEqual(['fixed', 'judge']);
  });
});

describe('extractModelOverrides', () => {
  it('选型引用是意图：再次稀疏化保留被引用裸 ID，但不冻结其它目录行', () => {
    const entries: ModelEntry[] = [{ id: 'selected', enabled: true }, { id: 'unselected' }];
    const selected = new Set(['selected', 'not-in-old-models']);
    const once = extractModelOverrides(entries, undefined, selected);
    expect(once).toEqual([{ id: 'selected' }]);
    expect(extractModelOverrides(once, [{ id: 'selected' }], selected)).toEqual(once);
    expect(extractModelOverrides(once, undefined, new Set())).toEqual([]);
  });
  it('丢弃无意图行（裸 id 或 enabled:true），保留用户意图行', () => {
    const entries: ModelEntry[] = [
      { id: 'a' },
      { id: 'b', enabled: true },
      { id: 'c', enabled: false },
      { id: 'd', label: '别名' },
      { id: 'e', reasoning: 'off' },
      { id: 'f', thinkingLevel: 'high' },
      { id: 'g', contextWindow: 200_000 },
      { id: 'h', maxTokens: 8_192 },
    ];
    expect(extractModelOverrides(entries).map((entry) => entry.id)).toEqual([
      'c',
      'd',
      'e',
      'f',
      'g',
      'h',
    ]);
  });

  it('全无意图时返回空数组，且保持原顺序', () => {
    expect(extractModelOverrides([{ id: 'a' }, { id: 'b', enabled: true }])).toEqual([]);
    const kept = extractModelOverrides([
      { id: 'x', enabled: false },
      { id: 'y', reasoning: 'on' },
      { id: 'z', enabled: false },
    ]);
    expect(kept.map((entry) => entry.id)).toEqual(['x', 'y', 'z']);
  });

  it('非法覆盖字段不构成用户意图（与 pickModelCapabilityOverrides 口径一致）', () => {
    const dirty: ModelEntry[] = [
      { id: 'a', reasoning: 'maybe' as never },
      { id: 'b', contextWindow: -5 },
      { id: 'c', thinkingLevel: 'ultra' as never },
    ];
    expect(extractModelOverrides(dirty)).toEqual([]);
  });

  it('基线 diff：与目录相同的 label 不算意图（防物化往返把稀疏表重新膨胀）', () => {
    const baseline = [
      { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash' },
      { id: 'gemini-3-pro', label: 'Gemini 3 Pro' },
    ];
    // 物化视图原样往返：所有行都带目录 label，全部无意图
    const roundTrip: ModelEntry[] = [
      { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash' },
      { id: 'gemini-3-pro', label: 'Gemini 3 Pro' },
    ];
    expect(extractModelOverrides(roundTrip, baseline)).toEqual([]);
    // 用户改名 ≠ 目录 label → 保留
    expect(extractModelOverrides([{ id: 'gemini-3-pro', label: '我的 Pro' }], baseline)).toEqual([
      { id: 'gemini-3-pro', label: '我的 Pro' },
    ]);
  });

  it('基线 diff：行因禁用保留时剥离目录同名 label；已下线模型的 label 保留', () => {
    const baseline = [{ id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash' }];
    const out = extractModelOverrides(
      [
        { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash', enabled: false },
        { id: 'sunset-model', label: '旧模型', enabled: false },
      ],
      baseline
    );
    expect(out).toEqual([
      { id: 'gemini-3.8-flash', enabled: false },
      { id: 'sunset-model', label: '旧模型', enabled: false },
    ]);
  });

  it('保留行上的 enabled:true 与缺省等价，剥离冗余', () => {
    expect(extractModelOverrides([{ id: 'a', enabled: true, reasoning: 'off' }])).toEqual([
      { id: 'a', reasoning: 'off' },
    ]);
  });
});

describe('materializeOAuthModels', () => {
  it('目录缺失时原样返回（旧稠密拷贝兜底，零回归）', () => {
    const dense: ModelEntry[] = [
      { id: 'old-1', enabled: true },
      { id: 'old-2', enabled: false },
    ];
    expect(materializeOAuthModels(undefined, dense)).toEqual(dense);
  });

  it('目录顺序为权威；覆盖行合入 enabled:false 与能力覆盖', () => {
    const out = materializeOAuthModels(directory.providers[0]!.models, [
      { id: 'gemini-3-pro', enabled: false },
      { id: 'claude-sonnet-4-6', reasoning: 'off', thinkingLevel: 'low' },
    ]);
    expect(out.map((m) => m.id)).toEqual(['gemini-3.8-flash', 'gemini-3-pro', 'claude-sonnet-4-6']);
    expect(out[0]).toEqual({ id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash' });
    expect(out[1]).toMatchObject({ enabled: false });
    expect(out[2]).toMatchObject({ reasoning: 'off', thinkingLevel: 'low' });
  });

  it('覆盖行里目录没有的 id 追加在末尾（已下线模型的用户选型不凭空消失）', () => {
    const out = materializeOAuthModels(directory.providers[0]!.models, [
      { id: 'sunset-model', enabled: false },
    ]);
    expect(out.map((m) => m.id)).toEqual([
      'gemini-3.8-flash',
      'gemini-3-pro',
      'claude-sonnet-4-6',
      'sunset-model',
    ]);
    expect(out[3]).toMatchObject({ id: 'sunset-model', enabled: false });
  });

  it('覆盖行的 label 优先于目录 label', () => {
    const out = materializeOAuthModels(directory.providers[0]!.models, [
      { id: 'gemini-3-pro', label: '我的 Pro' },
    ]);
    expect(out.find((m) => m.id === 'gemini-3-pro')?.label).toBe('我的 Pro');
  });

  it('旧稠密拷贝 + 目录 → 输出与目录同形（迁移前数据也正确）', () => {
    const dense: ModelEntry[] = [
      { id: 'gemini-3.8-flash', enabled: true },
      { id: 'gemini-3-pro', enabled: true },
      { id: 'claude-sonnet-4-6', enabled: false },
      { id: 'stale-id', enabled: true },
    ];
    const out = materializeOAuthModels(directory.providers[0]!.models, dense);
    expect(out.map((m) => m.id)).toEqual([
      'gemini-3.8-flash',
      'gemini-3-pro',
      'claude-sonnet-4-6',
      'stale-id',
    ]);
    expect(out.find((m) => m.id === 'claude-sonnet-4-6')?.enabled).toBe(false);
    expect(out.find((m) => m.id === 'gemini-3-pro')?.enabled).toBe(true);
  });
});

describe('materializeProviders', () => {
  it('自定义 provider 原样透传', () => {
    const custom = customProvider([{ id: 'a' }, { id: 'b', enabled: false }]);
    const out = materializeProviders([custom], directory);
    expect(out[0]).toBe(custom);
  });

  it('OAuth 条目按 accountKey 基础 id 命中目录并物化', () => {
    const entry = oauthProvider([{ id: 'gemini-3-pro', enabled: false }], 'google-antigravity#2');
    const out = materializeProviders([entry], directory);
    expect(out[0]?.models.map((m) => m.id)).toEqual([
      'gemini-3.8-flash',
      'gemini-3-pro',
      'claude-sonnet-4-6',
    ]);
    expect(out[0]?.models.find((m) => m.id === 'gemini-3-pro')?.enabled).toBe(false);
  });

  it('目录整体缺失或 provider 未命中时原样透传', () => {
    const entry = oauthProvider([{ id: 'frozen-1', enabled: true }]);
    expect(materializeProviders([entry], undefined)[0]).toBe(entry);
    const unknown = oauthProvider([{ id: 'frozen-1', enabled: true }], 'unknown-provider');
    expect(materializeProviders([unknown], directory)[0]).toBe(unknown);
  });
});

describe('parseModelDirectorySnapshot', () => {
  it('合法快照完整往返', () => {
    expect(parseModelDirectorySnapshot(directory)).toEqual(directory);
  });

  it('脏输入收窄：非对象 / 坏 revision / 坏 providers → undefined', () => {
    expect(parseModelDirectorySnapshot(null)).toBeUndefined();
    expect(parseModelDirectorySnapshot({ revision: 'x', providers: [] })).toBeUndefined();
    expect(parseModelDirectorySnapshot({ revision: 1, providers: 'x' })).toBeUndefined();
  });

  it('逐条过滤坏 provider / 坏 model，保留好的', () => {
    const parsed = parseModelDirectorySnapshot({
      revision: 7,
      generatedAt: 1,
      providers: [
        { key: 'ok', kind: 'oauth', label: 'OK', models: [{ id: 'm1' }, { id: 5 }, 'x'] },
        { key: 1 },
        { key: 'bad-kind', kind: 'weird', label: 'x', models: [] },
      ],
    });
    expect(parsed?.providers).toEqual([
      { key: 'ok', kind: 'oauth', label: 'OK', models: [{ id: 'm1' }] },
    ]);
  });
});
