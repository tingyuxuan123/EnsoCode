import { describe, expect, it } from 'vitest';
import { parseCodeSearchAccountKey, parseCodeSearchConfig } from './codeSearch';
import { parseAgentCommand } from './types/agent';

describe('代码搜索配置边界', () => {
  it('只接受明确的 Devin 账号引用，不把 token 或其他 provider 当账号', () => {
    expect(parseCodeSearchAccountKey(' devin#2 ')).toBe('devin#2');
    expect(parseCodeSearchAccountKey('devin')).toBe('devin');
    for (const value of [
      null,
      1,
      {},
      '',
      'anthropic',
      'devin#1',
      'devin#02',
      'devin-session-token$secret',
      'devin/../../x',
    ]) {
      expect(parseCodeSearchAccountKey(value)).toBeNull();
    }
  });

  it('配置仅传账号和有限代际，未知密钥字段不跨 worker 边界', () => {
    expect(parseCodeSearchConfig({ accountKey: 'devin#2', revision: 1 })).toEqual({
      accountKey: 'devin#2',
      revision: 1,
    });
    expect(parseCodeSearchConfig({ accountKey: null, revision: 0 })).toEqual({
      accountKey: null,
      revision: 0,
    });
    for (const value of [
      null,
      {},
      { accountKey: 'other', revision: 1 },
      { accountKey: 'devin', revision: Infinity },
      { accountKey: 'devin', revision: -1 },
      { accountKey: 'devin', revision: 0.5 },
      { accountKey: 'devin', revision: 1, apiKey: 'secret' },
    ]) {
      expect(parseCodeSearchConfig(value)).toBeNull();
    }
  });

  it('新 worker 命令收窄完整载荷，拒绝任意字段或坏配置', () => {
    const valid = { type: 'set-code-search-config', config: { accountKey: 'devin', revision: 2 } };
    expect(parseAgentCommand(valid)).toEqual(valid);
    expect(parseAgentCommand({ ...valid, config: { accountKey: 'x', revision: 2 } })).toBeNull();
    expect(parseAgentCommand({ ...valid, apiKey: 'secret' })).toBeNull();
  });
});
