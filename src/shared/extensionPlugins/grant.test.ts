import { describe, expect, it } from 'vitest';
import { grantExpands, type PluginGrant } from './grant';

const grant = (patch: Partial<PluginGrant> = {}): PluginGrant => ({
  permissions: ['agent.tool', 'fs.read', 'net.fetch', 'mcp.server'],
  fsRead: ['docs'],
  fsWrite: [],
  netDomains: ['api.example.com'],
  browserDomains: [],
  mcp: [{ name: 'demo', command: 'node', args: ['server.js'], envKeys: [] }],
  mcpTools: ['search_context'],
  renderer: false,
  env: [],
  interop: [],
  intercepts: [],
  resident: false,
  styles: false,
  ...patch,
});

describe('upstream grantExpands compatibility', () => {
  it('完全相同不算扩大', () => {
    expect(grantExpands(grant(), grant())).toBe(false);
  });

  it('删掉权限、缩小范围不算扩大', () => {
    expect(
      grantExpands(
        grant(),
        grant({ permissions: ['agent.tool'], fsRead: [], netDomains: [], mcp: [], mcpTools: [] })
      )
    ).toBe(false);
    expect(grantExpands(grant(), grant({ fsRead: ['docs/api'] }))).toBe(false);
  });

  it('旧记录没有 mcpTools 字段时按空处理', () => {
    const { mcpTools: _omit, ...legacy } = grant();
    expect(grantExpands(legacy as PluginGrant, grant({ mcpTools: [] }))).toBe(false);
    expect(grantExpands(legacy as PluginGrant, grant())).toBe(true);
  });

  it('旧记录没有浏览器域名时按空处理', () => {
    const { browserDomains: _omit, ...legacy } = grant();
    expect(grantExpands(legacy as PluginGrant, grant({ browserDomains: [] }))).toBe(false);
    expect(grantExpands(legacy as PluginGrant, grant({ browserDomains: ['example.com'] }))).toBe(
      true
    );
  });

  it.each<[string, Partial<PluginGrant>]>([
    ['新增权限', { permissions: ['agent.tool', 'fs.read', 'net.fetch', 'mcp.server', 'fs.write'] }],
    ['只加一个域名', { netDomains: ['api.example.com', 'evil.example.com'] }],
    ['新增浏览器域名', { browserDomains: ['example.com'] }],
    ['fs 变宽', { fsRead: ['.'] }],
    ['fs 换成兄弟目录', { fsRead: ['docs2'] }],
    [
      '只改 MCP 命令',
      { mcp: [{ name: 'demo', command: 'bash', args: ['server.js'], envKeys: [] }] },
    ],
    [
      '只改 MCP 参数',
      { mcp: [{ name: 'demo', command: 'node', args: ['other.js'], envKeys: [] }] },
    ],
    [
      'MCP 新增 env 键',
      { mcp: [{ name: 'demo', command: 'node', args: ['server.js'], envKeys: ['TOKEN'] }] },
    ],
    ['新增 renderer', { renderer: true }],
    ['可调用的 MCP 工具变多', { mcpTools: ['search_context', 'enhance_prompt'] }],
    ['新增透传环境变量', { env: ['JAVA_HOME'] }],
    ['新增可调用的插件', { interop: ['other.plugin'] }],
    ['新增拦截事件', { intercepts: ['tool_call'] }],
    ['改为常驻', { resident: true }],
  ])('%s 算扩大', (_label, patch) => {
    expect(grantExpands(grant(), grant(patch))).toBe(true);
  });

  it('旧记录没有新增字段时按空处理', () => {
    const legacy = {
      permissions: grant().permissions,
      fsRead: grant().fsRead,
      fsWrite: grant().fsWrite,
      netDomains: grant().netDomains,
      mcp: grant().mcp,
      mcpTools: grant().mcpTools,
      renderer: false,
    } as unknown as PluginGrant;
    expect(grantExpands(legacy, legacy)).toBe(false);
    expect(grantExpands(legacy, grant({ resident: true }))).toBe(true);
  });
});
