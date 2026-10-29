import { describe, expect, it } from 'vitest';
import { parseMcpImportJson } from './mcpConfig';

describe('parseMcpImportJson', () => {
  it.each(['http', 'sse'])('%s 配置保留 Authorization 与自定义请求头', (type) => {
    const headers = { Authorization: 'Bearer test-only', 'X-Tenant': 'team-a' };
    expect(
      parseMcpImportJson(JSON.stringify({ type, url: 'https://example.test/mcp', headers }))
    ).toMatchObject({ ok: true, servers: [{ transport: type, headers }] });
  });

  it('headers 只接收字符串对象，坏输入不变成请求头', () => {
    const parse = (headers: unknown) =>
      parseMcpImportJson(JSON.stringify({ url: 'https://example.test/mcp', headers }));
    const result = parse({ Authorization: 'Bearer test-only', Number: 1, Nested: {}, Empty: '' });
    expect(result.ok && result.servers[0].headers).toEqual({
      Authorization: 'Bearer test-only',
      Empty: '',
    });
    for (const headers of [null, ['not-a-header'], 'bad', 42]) {
      const result = parse(headers);
      expect(result.ok && result.servers[0]).not.toHaveProperty('headers');
    }
    const stdio = parseMcpImportJson(JSON.stringify({ command: 'test', headers: { A: 'b' } }));
    expect(stdio.ok && stdio.servers[0]).not.toHaveProperty('headers');
  });

  it('解析 Cursor / Claude Desktop 的 mcpServers 对象', () => {
    const result = parseMcpImportJson(
      JSON.stringify({
        mcpServers: {
          github: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'] },
        },
      })
    );
    expect(result).toEqual({
      ok: true,
      servers: [
        {
          name: 'github',
          transport: 'stdio',
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-github'],
          env: {},
          url: undefined,
        },
      ],
    });
  });

  it('解析 Codex mcp_servers 与 VS Code servers / mcp.servers', () => {
    expect(
      parseMcpImportJson(JSON.stringify({ mcp_servers: { a: { command: 'x' } } }))
    ).toMatchObject({ ok: true, servers: [{ name: 'a', command: 'x' }] });
    expect(
      parseMcpImportJson(JSON.stringify({ servers: { b: { url: 'https://x' } } }))
    ).toMatchObject({ ok: true, servers: [{ name: 'b', transport: 'http', url: 'https://x' }] });
    expect(
      parseMcpImportJson(JSON.stringify({ mcp: { servers: { c: { command: 'z' } } } }))
    ).toMatchObject({ ok: true, servers: [{ name: 'c', command: 'z' }] });
  });

  it('解析顶层服务器表与单条 command/url 配置', () => {
    expect(
      parseMcpImportJson(JSON.stringify({ grep: { url: 'https://mcp.grep.app' } }))
    ).toMatchObject({ ok: true, servers: [{ name: 'grep', url: 'https://mcp.grep.app' }] });
    expect(
      parseMcpImportJson(
        JSON.stringify({ name: 'fs', command: 'npx', args: ['-y', 'mcp-server-filesystem'] })
      )
    ).toMatchObject({
      ok: true,
      servers: [{ name: 'fs', command: 'npx', args: ['-y', 'mcp-server-filesystem'] }],
    });
    expect(parseMcpImportJson(JSON.stringify({ command: 'uvx', args: ['mcp'] }))).toMatchObject({
      ok: true,
      servers: [{ name: 'uvx', command: 'uvx', args: ['mcp'] }],
    });
  });

  it('解析数组与 mcpServers 数组', () => {
    const result = parseMcpImportJson(
      JSON.stringify({
        mcpServers: [{ name: 'a', command: 'one' }, { url: 'https://two.example' }],
      })
    );
    expect(result).toMatchObject({
      ok: true,
      servers: [
        { name: 'a', command: 'one' },
        { name: 'mcp', url: 'https://two.example' },
      ],
    });
  });

  it('去掉 markdown 代码围栏后再解析', () => {
    const result = parseMcpImportJson('```json\n{"mcpServers":{"a":{"command":"x"}}}\n```');
    expect(result).toMatchObject({ ok: true, servers: [{ name: 'a', command: 'x' }] });
  });

  it('解析 "name": { ... } 片段', () => {
    const result = parseMcpImportJson('"fast-context": { "command": "npx", "args": ["-y", "x"] }');
    expect(result).toMatchObject({
      ok: true,
      servers: [{ name: 'fast-context', command: 'npx', args: ['-y', 'x'] }],
    });
  });

  it('非法 JSON 返回 invalid-json；无有效条目返回 empty', () => {
    expect(parseMcpImportJson('{')).toEqual({ ok: false, error: 'invalid-json' });
    expect(parseMcpImportJson('[]')).toEqual({ ok: false, error: 'empty' });
    expect(parseMcpImportJson('{}')).toEqual({ ok: false, error: 'empty' });
    expect(parseMcpImportJson('null')).toEqual({ ok: false, error: 'empty' });
    expect(parseMcpImportJson(JSON.stringify({ empty: { description: 'nope' } }))).toEqual({
      ok: false,
      error: 'empty',
    });
  });

  it('跳过脏条目，保留可解析的服务器', () => {
    const result = parseMcpImportJson(
      JSON.stringify({
        mcpServers: {
          bad: null,
          ok: { command: 'x', env: { A: '1', N: 2 } },
        },
      })
    );
    expect(result).toMatchObject({
      ok: true,
      servers: [{ name: 'ok', command: 'x', env: { A: '1' } }],
    });
  });
});
