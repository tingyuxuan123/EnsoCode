import { describe, expect, it } from 'vitest';
import { commitPendingModel, mergeFetchedModels } from './modelEntry';
import type { FetchedModel, ModelEntry } from './types';

describe('commitPendingModel', () => {
  it('把未点 + 的输入框模型并进清单', () => {
    expect(commitPendingModel([], 'grok-4.6')).toEqual([{ id: 'grok-4.6', enabled: true }]);
  });

  it('空白或已有 id 不重复追加', () => {
    const current = [{ id: 'grok-4.6', enabled: true }];
    expect(commitPendingModel(current, '  ')).toEqual(current);
    expect(commitPendingModel(current, 'grok-4.6')).toEqual(current);
  });
});

describe('mergeFetchedModels', () => {
  it('新模型追加为启用条目并携带元数据', () => {
    const merged = mergeFetchedModels(
      [],
      [{ id: 'grok-4.6', contextWindow: 256000 }, { id: 'plain' }]
    );
    expect(merged).toEqual([
      { id: 'grok-4.6', enabled: true, contextWindow: 256000 },
      { id: 'plain', enabled: true },
    ]);
  });

  it('已有模型仅回填缺失字段，不覆盖已有值', () => {
    const current: ModelEntry[] = [
      {
        id: 'kept',
        enabled: false,
        label: '自定义名称',
        reasoning: 'off',
        thinkingLevel: 'low',
        contextWindow: 80000,
      },
      { id: 'backfill', enabled: true, maxTokens: 4096 },
    ];
    const merged = mergeFetchedModels(current, [
      { id: 'kept', contextWindow: 256000, maxTokens: 32000 },
      { id: 'backfill', contextWindow: 128000, maxTokens: 8192 },
    ]);
    expect(merged).toEqual([
      {
        id: 'kept',
        enabled: false,
        label: '自定义名称',
        reasoning: 'off',
        thinkingLevel: 'low',
        contextWindow: 80000,
        maxTokens: 32000,
      },
      { id: 'backfill', enabled: true, contextWindow: 128000, maxTokens: 4096 },
    ]);
  });

  it('上游缺席的条目（含手动添加）移除，仍存在的保持原顺序，新模型追加到末尾', () => {
    const current: ModelEntry[] = [
      { id: 'a' },
      { id: 'manual', label: '手动添加' },
      { id: 'b', label: 'B' },
      { id: 'c', enabled: false },
    ];
    const merged = mergeFetchedModels(current, [{ id: 'c' }, { id: 'new' }, { id: 'b' }]);
    expect(merged).toEqual([
      { id: 'b', label: 'B' },
      { id: 'c', enabled: false },
      { id: 'new', enabled: true },
    ]);
  });

  it('成功拉取空列表时清空所有条目', () => {
    const current: ModelEntry[] = [
      { id: 'previously-fetched', enabled: false, contextWindow: 80000 },
      { id: 'manual', label: '手动添加' },
    ];
    expect(mergeFetchedModels(current, [])).toEqual([]);
  });

  it('fetched 中已有模型和新模型的重复 id 都不产生重复行', () => {
    const current: ModelEntry[] = [{ id: 'kept', enabled: false, label: '自定义名称' }];
    const merged = mergeFetchedModels(current, [
      { id: 'kept' },
      { id: 'kept' },
      { id: 'new', contextWindow: 128000 },
      { id: 'new', contextWindow: 128000 },
    ]);
    expect(merged).toEqual([
      { id: 'kept', enabled: false, label: '自定义名称' },
      { id: 'new', enabled: true, contextWindow: 128000 },
    ]);
  });

  it('同步、回填和去重均不修改 current 或 fetched 入参', () => {
    const current: ModelEntry[] = [
      { id: 'kept', enabled: false, label: '自定义名称', reasoning: 'off' },
      { id: 'removed', enabled: true },
    ];
    const fetched: FetchedModel[] = [
      { id: 'new', contextWindow: 64000, maxTokens: 4096 },
      { id: 'kept', contextWindow: 128000, maxTokens: 8192 },
      { id: 'new', contextWindow: 64000, maxTokens: 4096 },
    ];
    const currentBefore = structuredClone(current);
    const fetchedBefore = structuredClone(fetched);

    mergeFetchedModels(current, fetched);

    expect(current).toEqual(currentBefore);
    expect(fetched).toEqual(fetchedBefore);
  });

  it('新模型一并带上端点声明的 label / reasoning / 档位集 / 视觉', () => {
    const merged = mergeFetchedModels(
      [],
      [
        {
          id: 'auto/deepseek-v4.1-flash',
          contextWindow: 1048576,
          maxTokens: 384000,
          label: 'DeepSeek V4.1 Flash',
          reasoning: true,
          thinkingLevels: ['low', 'high', 'max'],
          supportsImage: true,
        },
        { id: 'text-only', supportsImage: false },
      ]
    );
    expect(merged).toEqual([
      {
        id: 'auto/deepseek-v4.1-flash',
        enabled: true,
        contextWindow: 1048576,
        maxTokens: 384000,
        label: 'DeepSeek V4.1 Flash',
        reasoning: 'on',
        thinkingLevels: ['low', 'high', 'max'],
        vision: true,
      },
      { id: 'text-only', enabled: true, vision: false },
    ]);
  });

  it('已有一律不覆盖：用户改过的 label / 关闭的推理 / 自定的档位与视觉都保留', () => {
    const current: ModelEntry[] = [
      {
        id: 'kept',
        enabled: true,
        label: '我的名字',
        reasoning: 'off',
        thinkingLevels: ['low'],
        vision: false,
      },
    ];
    const merged = mergeFetchedModels(current, [
      {
        id: 'kept',
        label: '端点名字',
        reasoning: true,
        thinkingLevels: ['low', 'high', 'max'],
        supportsImage: true,
      },
    ]);
    expect(merged).toEqual(current);
  });

  it('删除与回填同一次生效：下架的整行消失，留下的行补齐端点新声明', () => {
    const current: ModelEntry[] = [
      { id: 'retired', enabled: true, contextWindow: 8000 },
      { id: 'kept', enabled: false },
    ];
    const merged = mergeFetchedModels(current, [
      {
        id: 'kept',
        label: '端点名字',
        reasoning: true,
        thinkingLevels: ['low', 'max'],
        supportsImage: false,
      },
    ]);
    expect(merged).toEqual([
      {
        id: 'kept',
        enabled: false,
        label: '端点名字',
        reasoning: 'on',
        thinkingLevels: ['low', 'max'],
        vision: false,
      },
    ]);
  });
});
