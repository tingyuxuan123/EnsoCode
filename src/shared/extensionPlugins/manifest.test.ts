import { describe, expect, it } from 'vitest';
import { grantExpands, grantOf } from './grant';
import { isPluginRelativePath, parseExtensionPluginManifest } from './manifest';
import { parsePluginPresetId, pluginPresetId } from './preset';
import { parsePluginToolName, pluginToolName } from './toolName';

const base = { schemaVersion: 1, id: 'enso.test', name: 'Test', version: '1.0.0', permissions: [] };
const parse = (patch: object = {}) => parseExtensionPluginManifest({ ...base, ...patch }, '0.2.37');
describe('native plugin manifest', () => {
  it.each(['systemPromptTail', 'boostPrompt', 'refusalRetry', 'refusalRetryPrompt'])(
    '拒绝未实现的预设字段 %s',
    (key) => {
      expect(
        parse({
          contributes: {
            presets: [
              { id: 'review', name: 'Review', [key]: key === 'refusalRetry' ? false : 'prompt.md' },
            ],
          },
        }).ok
      ).toBe(false);
    }
  );
  it('MCP 授权必须同时绑定 server 和 tool', () => {
    expect(parse({ permissions: ['mcp.call'], mcp: { tools: ['write_data'] } }).ok).toBe(false);
    expect(parse({ permissions: ['mcp.call'], mcp: { tools: ['s/write_data'] } }).ok).toBe(true);
  });
  it('MCP server 按最后一个斜杠切分，允许用户配置的中文、空格和斜杠', () => {
    for (const server of ['中文服务', 'my server', 'team/service', 'a'.repeat(128)])
      expect(parse({ permissions: ['mcp.call'], mcp: { tools: [`${server}/read`] } }).ok).toBe(
        true
      );
    for (const tool of [
      '/read',
      'a\n/read',
      'a\u007f/read',
      'a\u0085/read',
      `${'a'.repeat(129)}/read`,
      'a/bad tool',
      'a/read\n',
      'a/',
    ])
      expect(parse({ permissions: ['mcp.call'], mcp: { tools: [tool] } }).ok).toBe(false);
  });
  it('normalizes defaults and warns on unknown fields', () => {
    const result = parse({ ignored: true });
    expect(result).toMatchObject({
      ok: true,
      warnings: [expect.any(String)],
      manifest: { contributes: { presets: [], agentTools: [] }, fs: { read: [], write: [] } },
    });
  });
  it.each(['../x', '/tmp/a', 'C:/a', 'a\\b', 'a/../b', 'x\0y'])('rejects unsafe path %s', (path) =>
    expect(isPluginRelativePath(path)).toBe(false)
  );
  it.each([
    null,
    [],
    {},
    { ...base, id: 'x' },
    { ...base, permissions: ['unknown'] },
    { ...base, engines: { enso: '>=9.0.0' } },
  ])('rejects malformed manifest', (raw) =>
    expect(parseExtensionPluginManifest(raw, '0.2.37').ok).toBe(false)
  );
  it('requires complete object schema, permission and main for tools', () => {
    const tool = {
      name: 'count',
      description: 'Count',
      parameters: { type: 'object', properties: {} },
    };
    expect(parse({ contributes: { agentTools: [tool] } }).ok).toBe(false);
    expect(
      parse({ main: 'main.mjs', permissions: ['agent.tool'], contributes: { agentTools: [tool] } })
        .ok
    ).toBe(true);
    expect(
      parse({
        main: 'main.mjs',
        permissions: ['agent.tool'],
        contributes: { agentTools: [{ ...tool, parameters: {} }] },
      }).ok
    ).toBe(false);
  });
  it('only allows # completion and declared preset resources', () => {
    expect(
      parse({
        main: 'main.mjs',
        permissions: ['ui.slot'],
        contributes: { triggers: [{ symbol: '@', name: 'test' }] },
      }).ok
    ).toBe(false);
    expect(
      parse({
        contributes: { presets: [{ id: 'review', name: 'Review', skills: ['not-declared'] }] },
      }).ok
    ).toBe(false);
    expect(
      parse({
        contributes: {
          skills: ['skills/a'],
          presets: [{ id: 'review', name: 'Review', skills: ['skills/a'] }],
        },
      }).ok
    ).toBe(true);
  });
  it('rejects duplicate configuration and invalid long method timeout', () => {
    expect(
      parse({
        main: 'main.mjs',
        contributes: {
          configuration: [
            { key: 'token', title: 'Token', secret: true },
            { key: 'token', title: 'Again' },
          ],
        },
      }).ok
    ).toBe(false);
    expect(
      parse({ main: 'main.mjs', contributes: { methods: [{ name: 'work', timeoutMs: 120001 }] } })
        .ok
    ).toBe(false);
  });
  it('detects grant expansion including MCP executable and host tools', () => {
    const a = parse();
    const b = parse({ permissions: ['fs.write'], fs: { write: ['.'] } });
    if (!a.ok || !b.ok) throw new Error('fixture');
    expect(grantExpands(grantOf(a.manifest), grantOf(b.manifest))).toBe(true);
    expect(grantExpands(grantOf(b.manifest), grantOf(a.manifest))).toBe(false);
  });
  it('round trips fixed tool and preset namespaces without accepting arbitrary names', () => {
    expect(parsePluginToolName(pluginToolName('enso.test', 'count'))).toEqual({
      pluginId: 'enso.test',
      toolName: 'count',
    });
    expect(parsePluginToolName('bash')).toBeNull();
    expect(parsePluginPresetId(pluginPresetId('enso.test', 'review'))).toEqual({
      pluginId: 'enso.test',
      localId: 'review',
    });
    expect(parsePluginPresetId('plugin:../../x:a')).toBeUndefined();
  });
});
