import { describe, expect, it } from 'vitest';
import { commitPendingModel, mergeFetchedModels } from './modelEntry';
import type { ModelEntry } from './types';

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
      { id: 'kept', enabled: false, contextWindow: 80000 },
      { id: 'backfill', enabled: true },
    ];
    const merged = mergeFetchedModels(current, [
      { id: 'kept', contextWindow: 256000, maxTokens: 32000 },
      { id: 'backfill', contextWindow: 128000, maxTokens: 8192 },
    ]);
    expect(merged).toEqual([
      // contextWindow 已有 → 保留 80000；maxTokens 缺失 → 回填
      { id: 'kept', enabled: false, contextWindow: 80000, maxTokens: 32000 },
      { id: 'backfill', enabled: true, contextWindow: 128000, maxTokens: 8192 },
    ]);
  });

  it('保持已有顺序，新模型排在末尾；fetched 无元数据时已有条目原样返回', () => {
    const current: ModelEntry[] = [{ id: 'a' }, { id: 'b', label: 'B' }];
    const merged = mergeFetchedModels(current, [{ id: 'b' }, { id: 'new' }]);
    expect(merged).toEqual([{ id: 'a' }, { id: 'b', label: 'B' }, { id: 'new', enabled: true }]);
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
});
