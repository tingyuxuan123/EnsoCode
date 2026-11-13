import { describe, expect, it } from 'vitest';
import { parseAgentCommand, parseContextOccupancy } from './agent';

describe('微压缩设置与统计协议', () => {
  it('既有压缩路由接受布尔开关，兼容旧命令并拒绝坏配置', () => {
    expect(parseAgentCommand({ type: 'set-compact-route' })).not.toBeNull();
    for (const microcompactEnabled of [true, false]) {
      const command = { type: 'set-compact-route', microcompactEnabled };
      expect(parseAgentCommand(command)).toEqual(command);
    }
    for (const microcompactEnabled of ['false', 0, null, {}]) {
      expect(parseAgentCommand({ type: 'set-compact-route', microcompactEnabled })).toBeNull();
    }
  });

  it('spawn 接受明确开关，不把非布尔值当成有效配置', () => {
    const base = {
      type: 'spawn-parent',
      identity: { sessionId: 'mc', generation: '11111111-1111-4111-8111-111111111111' },
      cwd: '/workspace',
      model: {
        api: 'openai-completions',
        baseUrl: 'https://example.test/v1',
        apiKey: 'fixture',
        modelId: 'fixture',
        settingsProviderId: 'fixture',
      },
    };
    expect(parseAgentCommand(base)).not.toBeNull();
    expect(parseAgentCommand({ ...base, microcompactEnabled: false })).toEqual({
      ...base,
      microcompactEnabled: false,
    });
    expect(parseAgentCommand({ ...base, microcompactEnabled: 'false' })).toBeNull();
  });

  const occupancy = {
    buckets: {
      system: 0,
      instructions: 0,
      skills: 0,
      tools: 0,
      conversation: 0,
      compaction: 0,
      projectMemory: 0,
      reminders: 0,
    },
    used: 0,
    estimated: true,
    compactedMessageCount: 0,
    compactionModelMismatch: false,
  };

  it('清理量只接受完整的非负整数字符统计', () => {
    expect(parseContextOccupancy(occupancy)).toEqual(occupancy);
    const valid = { ...occupancy, microcompact: { results: 2, charsRemoved: 1234 } };
    expect(parseContextOccupancy(valid)).toEqual(valid);
    for (const microcompact of [
      null,
      {},
      { results: 1 },
      { results: -1, charsRemoved: 10 },
      { results: 1.5, charsRemoved: 10 },
      { results: 1, charsRemoved: NaN },
      { results: 1, charsRemoved: Infinity },
      { results: 1, charsRemoved: '100' },
      { results: 1, charsRemoved: 100, tokenSavings: 25 },
    ]) {
      expect(parseContextOccupancy({ ...occupancy, microcompact })).toBeNull();
    }
  });
});
