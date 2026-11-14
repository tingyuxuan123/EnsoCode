import { describe, expect, it } from 'vitest';
import { grantExpands, grantOf } from './grant';
import { isPluginRelativePath, parseExtensionPluginManifest } from './manifest';
import { parsePluginPresetId, pluginPresetId } from './preset';
import { parsePluginToolName, pluginToolName } from './toolName';

const base = { schemaVersion: 1, id: 'enso.test', name: 'Test', version: '1.0.0', permissions: [] };
const parse = (patch: object = {}) => parseExtensionPluginManifest({ ...base, ...patch }, '0.2.37');
describe('native plugin manifest', () => {
  // 上游 0.3.5 起预设支持真尾、boost 与推脱补发，按新契约校验而不是拒绝
  it.each(['systemPromptTail', 'boostPrompt', 'refusalRetryPrompt'])(
    '按上游契约接受预设字段 %s',
    (key) => {
      const result = parse({
        contributes: {
          presets: [{ id: 'review', name: 'Review', [key]: 'prompt.md' }],
        },
      });
      expect(result.ok && result.manifest.contributes.presets[0]).toMatchObject({
        [key]: 'prompt.md',
      });
    }
  );
  it('推脱补发开关必须有正文', () => {
    expect(
      parse({
        contributes: { presets: [{ id: 'review', name: 'Review', refusalRetry: true }] },
      }).ok
    ).toBe(false);
    expect(
      parse({
        contributes: {
          presets: [
            { id: 'review', name: 'Review', refusalRetry: true, refusalRetryPrompt: 'prompt.md' },
          ],
        },
      }).ok
    ).toBe(true);
  });
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

describe('browser.control 与 browser.domains', () => {
  it('未声明 browser 时解析结果不新增字段', () => {
    const result = parse();
    if (!result.ok) throw new Error('fixture');
    expect(result.manifest).not.toHaveProperty('browser');
    expect(grantOf(result.manifest).browserDomains).toEqual([]);
  });

  it('声明 browser.control 必须提供非空、精确 host 的白名单', () => {
    expect(parse({ permissions: ['browser.control'] }).ok).toBe(false);
    expect(parse({ permissions: ['browser.control'], browser: {} }).ok).toBe(false);
    expect(parse({ permissions: ['browser.control'], browser: { domains: [] } }).ok).toBe(false);
    expect(parse({ permissions: ['browser.control'], browser: { domains: ['a'] } }).ok).toBe(false);
    for (const domain of ['*.example.com', 'https://example.com', 'example.com/path', 'a.b'])
      expect(parse({ permissions: ['browser.control'], browser: { domains: [domain] } }).ok).toBe(
        false
      );
    const result = parse({
      permissions: ['browser.control'],
      browser: { domains: ['example.com', 'docs.example.org', 'example.com'] },
    });
    if (!result.ok) throw new Error('fixture');
    expect(result.manifest.browser).toEqual({ domains: ['example.com', 'docs.example.org'] });
  });

  it('browser.domains 必须配套 browser.control 权限', () => {
    expect(parse({ browser: { domains: ['example.com'] } }).ok).toBe(false);
  });

  it('白名单与权限都进入授权范围', () => {
    const base = parse();
    const next = parse({
      permissions: ['browser.control'],
      browser: { domains: ['example.com'] },
    });
    if (!base.ok || !next.ok) throw new Error('fixture');
    expect(grantOf(next.manifest).browserDomains).toEqual(['example.com']);
    expect(grantExpands(grantOf(base.manifest), grantOf(next.manifest))).toBe(true);
    const wider = parse({
      permissions: ['browser.control'],
      browser: { domains: ['example.com', 'docs.example.org'] },
    });
    if (!wider.ok) throw new Error('fixture');
    expect(grantExpands(grantOf(next.manifest), grantOf(wider.manifest))).toBe(true);
    expect(grantExpands(grantOf(wider.manifest), grantOf(next.manifest))).toBe(false);
  });
});
