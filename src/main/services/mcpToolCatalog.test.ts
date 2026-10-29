import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { McpServerEntry } from '@shared/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let dir: string;
vi.mock('electron', () => ({ app: { getPath: () => dir } }));

import { McpToolCatalogStore } from './mcpToolCatalog';

const file = () => path.join(dir, 'mcp-tool-catalog.json');
const entry = (patch: Partial<McpServerEntry> = {}): McpServerEntry => ({
  id: 's1',
  name: 'search',
  transport: 'stdio',
  command: 'search-mcp',
  env: { API_KEY: 'top-secret' },
  source: 'manual',
  enabled: true,
  ...patch,
});

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'enso-mcp-catalog-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('McpToolCatalogStore', () => {
  it('headers 只存签名，轮换后磁盘目录失效', () => {
    const server = entry({
      transport: 'http',
      url: 'https://example.test/mcp',
      headers: { Authorization: 'Bearer fake-secret' },
    });
    new McpToolCatalogStore(file()).record(server, ['find']);
    const reloaded = new McpToolCatalogStore(file());
    expect(reloaded.names(server)).toEqual(['find']);
    expect(readFileSync(file(), 'utf-8')).not.toContain('fake-secret');
    expect(readFileSync(file(), 'utf-8')).not.toContain('Authorization');
    expect(
      reloaded.names({ ...server, headers: { Authorization: 'Bearer fake-rotated' } })
    ).toBeUndefined();
  });

  it('记录工具名并由新实例从盘上读回，文件不含 env 明文', () => {
    new McpToolCatalogStore(file()).record(entry(), ['find', 'fetch']);
    expect(new McpToolCatalogStore(file()).names(entry())).toEqual(['find', 'fetch']);
    expect(readFileSync(file(), 'utf-8')).not.toContain('top-secret');
  });

  it('连接配置变化后视为无缓存；改名、开关等不影响', () => {
    const store = new McpToolCatalogStore(file());
    store.record(entry(), ['find']);
    expect(store.names(entry({ name: 'renamed', enabled: false }))).toEqual(['find']);
    expect(store.names(entry({ args: ['--v2'] }))).toBeUndefined();
    expect(store.names(entry({ env: { API_KEY: 'rotated' } }))).toBeUndefined();
    expect(store.names(entry({ id: 'other' }))).toBeUndefined();
  });

  it('retain 剔除已删除 server 的条目并落盘', () => {
    const store = new McpToolCatalogStore(file());
    store.record(entry(), ['find']);
    store.record(entry({ id: 's2' }), ['read']);
    store.retain(['s2']);
    const reloaded = new McpToolCatalogStore(file());
    expect(reloaded.names(entry())).toBeUndefined();
    expect(reloaded.names(entry({ id: 's2' }))).toEqual(['read']);
  });

  it('无变化时不写盘；空列表不记录', () => {
    const store = new McpToolCatalogStore(file());
    store.retain([]);
    store.record(entry(), []);
    expect(existsSync(file())).toBe(false);
  });

  it('损坏或结构异常的文件当空库', () => {
    writeFileSync(file(), '{not json');
    expect(new McpToolCatalogStore(file()).names(entry())).toBeUndefined();
    writeFileSync(file(), JSON.stringify({ servers: { s1: { signature: 1, tools: 'x' } } }));
    expect(new McpToolCatalogStore(file()).names(entry())).toBeUndefined();
  });
});
