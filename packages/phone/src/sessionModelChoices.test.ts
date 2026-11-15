import { describe, expect, it } from 'vitest';
import {
  listModelOptions,
  modelPillLabel,
  resolveModelOption,
  THINKING_LEVELS,
  thinkingLevelLabel,
} from './sessionModelChoices';

const providers = [
  { id: 'anthropic', name: 'Anthropic', models: [{ id: 's46', label: 'Sonnet 4.6' }] },
  { id: 'openai', name: 'OpenAI', models: [{ id: 'g61' }, { id: 'o4' }] },
  { id: 'disabled', name: '没模型的服务', models: [] },
];

describe('listModelOptions', () => {
  it('把 provider × model 拍平成一行一个可选项，跳过没有模型的服务', () => {
    expect(listModelOptions(providers)).toEqual([
      {
        key: 'anthropic\ns46',
        providerId: 'anthropic',
        providerName: 'Anthropic',
        modelId: 's46',
        label: 'Sonnet 4.6',
      },
      {
        key: 'openai\ng61',
        providerId: 'openai',
        providerName: 'OpenAI',
        modelId: 'g61',
        label: 'g61',
      },
      {
        key: 'openai\no4',
        providerId: 'openai',
        providerName: 'OpenAI',
        modelId: 'o4',
        label: 'o4',
      },
    ]);
  });

  it('没有服务时返回空列表', () => {
    expect(listModelOptions([])).toEqual([]);
  });
});

describe('resolveModelOption', () => {
  const options = listModelOptions(providers);

  it('手选有效时用用户选的', () => {
    expect(resolveModelOption(options, 'openai', 'o4')?.label).toBe('o4');
  });

  it('没手选或手选已失效时回落第一项（目录异步到达）', () => {
    expect(resolveModelOption(options, null, null)?.label).toBe('Sonnet 4.6');
    expect(resolveModelOption(options, 'openai', 'gone')?.label).toBe('Sonnet 4.6');
  });

  it('没有可选模型时返回 undefined', () => {
    expect(resolveModelOption([], 'a', 'b')).toBeUndefined();
  });
});

describe('modelPillLabel', () => {
  it('显示当前模型 + 思考档位', () => {
    expect(modelPillLabel('Sonnet 4.6', true, 'high')).toBe('Sonnet 4.6 · 思考 高');
  });

  it('推理关闭时显示不思考', () => {
    expect(modelPillLabel('Sonnet 4.6', false, 'high')).toBe('Sonnet 4.6 · 不思考');
  });

  it('没有模型时提示去选，不假装已选', () => {
    expect(modelPillLabel('', true, 'medium')).toBe('选择模型');
    expect(modelPillLabel('  ', false, 'medium')).toBe('选择模型');
  });
});

describe('thinkingLevelLabel', () => {
  it('现有 6 档都有中文标签，没有丢档', () => {
    expect(THINKING_LEVELS).toEqual(['minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
    expect(THINKING_LEVELS.map(thinkingLevelLabel)).toEqual([
      '极低',
      '低',
      '中',
      '高',
      '极高',
      '最高',
    ]);
  });
});
