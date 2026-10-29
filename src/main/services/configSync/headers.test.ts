import { describe, expect, it } from 'vitest';
import { decodeBundle, encodeBundle, redactBundle, validateBundle } from './codec';
import { planImport } from './merge';
import type { ConfigSyncBundle } from './types';

const headers = { Authorization: 'Bearer fake-config-sync-token', 'X-Test': 'fixture' };
const server = {
  id: 'http-server',
  name: 'HTTP fixture',
  transport: 'http' as const,
  url: 'https://example.test/mcp',
  source: 'manual',
  enabled: true,
};
const bundle = (): ConfigSyncBundle => ({
  format: 'enso-config',
  version: 1,
  createdAt: '2025-09-05T00:00:00.000Z',
  state: {
    providers: [],
    skills: [],
    mcpServers: [{ ...server, headers }],
    instructions: [],
    presets: [],
    agentTypes: [],
    subagentModels: [],
  },
  resources: { skills: [], instructions: [] },
  secretsIncluded: true,
});

describe('config sync MCP headers', () => {
  it('加密导出通过精确字段校验并无损导入 headers', async () => {
    const encoded = await encodeBundle(bundle(), 'fake-password');
    expect(encoded.toString()).not.toContain(headers.Authorization);
    const decoded = await decodeBundle(encoded, 'fake-password');
    expect(decoded.state.mcpServers[0]).toMatchObject({ headers });
  });

  it('明文导出删除 headers 并记录省略，不修改原包', async () => {
    const source = bundle();
    const redacted = redactBundle(source);
    expect(redacted.state.mcpServers[0]).not.toHaveProperty('headers');
    expect(redacted.state.mcpServers[0].omittedFields).toContain('headers');
    const decoded = await decodeBundle(await encodeBundle(redacted));
    expect(decoded.state.mcpServers[0]).not.toHaveProperty('headers');
    expect(decoded.state.mcpServers[0].omittedFields).toContain('headers');
    expect(source.state.mcpServers[0]).toMatchObject({ headers });
  });

  it.each([headers, {}])('明文导入拒绝携带 headers %j', async (value) => {
    const source = bundle();
    source.secretsIncluded = false;
    source.state.mcpServers = [{ ...server, headers: value }];
    await expect(decodeBundle(Buffer.from(JSON.stringify(source)))).rejects.toThrow(
      'Plain config sync bundle contains sensitive fields'
    );
  });

  it.each(
    [null, [], 'token', 7, { Authorization: 7 }, { Authorization: null }, { '': 'x' }].map(
      (value) => ({ value })
    )
  )('拒绝非字符串 record headers %j', ({ value }) => {
    const source = bundle();
    expect(() =>
      validateBundle({
        ...source,
        state: { ...source.state, mcpServers: [{ ...server, headers: value }] },
      })
    ).toThrow('Invalid MCP headers');
  });

  it.each(['merge', 'replace'] as const)('%s 省略 headers 时保留本机凭据', (mode) => {
    const source = redactBundle(bundle());
    const result = planImport({ ...bundle().state }, source, mode);
    expect(result.state.mcpServers).toContainEqual(
      expect.objectContaining({ headers, enabled: true })
    );
    expect(result.state.mcpServers).toEqual([
      expect.not.objectContaining({ omittedFields: expect.anything() }),
    ]);
  });

  it('新建条目缺少已省略的 headers 时禁用', () => {
    const source = redactBundle(bundle());
    const result = planImport({ ...source.state, mcpServers: [] }, source, 'merge');
    expect(result.state.mcpServers).toEqual([expect.objectContaining({ enabled: false })]);
    expect(result.state.mcpServers).toEqual([
      expect.not.objectContaining({ headers: expect.anything() }),
    ]);
  });

  it('显式导入不同 headers 时保留本机凭据并禁用，与 env 策略一致', () => {
    const source = bundle();
    source.state.mcpServers = [{ ...server, headers: { Authorization: 'Bearer fake-other' } }];
    const result = planImport({ ...bundle().state }, source, 'merge');
    expect(result.state.mcpServers).toEqual([expect.objectContaining({ headers, enabled: false })]);
  });
});
