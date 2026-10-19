import { linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BrowserHistoryStore } from './browserHistory';

let directory: string;
let filePath: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'enso-browser-history-'));
  filePath = join(directory, 'history.json');
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));

const visit = (url: string, at: number, tabId = 'tab-a', conversationId = 'conversation-a') => ({
  conversationId,
  tabId,
  url,
  title: `Title ${at}`,
  at,
});

describe('BrowserHistoryStore', () => {
  it('只合并同一 tab 的连续同 URL 提交，离开后返回另记一次', () => {
    const store = new BrowserHistoryStore({ filePath });
    store.record(visit('https://example.com/a', 1));
    const id = store.query('conversation-a', {}).items[0].id;
    store.record(visit('https://example.com/b', 2, 'tab-b'));
    store.record(visit('https://example.com/a', 3));
    expect(store.query('conversation-a', {}).items).toEqual([
      expect.objectContaining({ id, title: 'Title 3', visitedAt: 3 }),
      expect.objectContaining({ tabId: 'tab-b', visitedAt: 2 }),
    ]);
    store.record(visit('https://example.com/c', 4));
    store.record(visit('https://example.com/a', 5));
    const entries = store.query('conversation-a', {}).items;
    expect(entries).toHaveLength(4);
    expect(entries[0].id).not.toBe(id);
  });

  it('HTTP(S) 规范化，不记录带凭据或非网页 URL，离开网页打断连续访问', () => {
    const store = new BrowserHistoryStore({ filePath });
    store.record(visit('HTTPS://EXAMPLE.COM', 1));
    const id = store.query('conversation-a', {}).items[0].id;
    for (const url of ['file:///secret', 'about:blank', 'https://u:p@example.com', 'not a URL'])
      store.record(visit(url, 2));
    store.record(visit('https://example.com/', 3));
    expect(store.query('conversation-a', {}).items).toHaveLength(2);
    expect(store.query('conversation-a', {}).items[0].id).not.toBe(id);
    expect(
      store.query('conversation-a', {}).items.every((entry) => entry.url === 'https://example.com/')
    ).toBe(true);
  });

  it('查询按时间倒序并在当前会话内搜索、分页，返回值不能修改权威记录', () => {
    const store = new BrowserHistoryStore({ filePath });
    store.record(visit('https://example.com/alpha', 1));
    store.record(visit('https://example.com/beta', 2));
    store.record(visit('https://example.com/alpha', 3));
    store.record(visit('https://example.com/alpha', 4, 'tab-b', 'conversation-b'));
    const result = store.query('conversation-a', { query: ' ALPHA ', offset: 1, limit: 1 });
    expect(result.total).toBe(2);
    expect(result.items.map((entry) => entry.visitedAt)).toEqual([1]);
    result.items[0].url = 'https://changed.test/';
    expect(store.query('conversation-a', { query: 'changed' }).total).toBe(0);
    expect(store.query('conversation-a', { query: 'title 2' }).total).toBe(1);
    expect(store.query('unknown', {}).total).toBe(0);
    expect(store.query('conversation-a', { offset: Number.NaN, limit: -2 }).items).toHaveLength(1);
  });

  it('按全局上限淘汰最旧记录且删除和清空不能越过会话边界', async () => {
    const store = new BrowserHistoryStore({ filePath, limit: 2 });
    store.record(visit('https://example.com/a', 1));
    store.record(visit('https://example.com/b', 2));
    store.record(visit('https://example.com/c', 3, 'tab-c', 'conversation-b'));
    const target = store.query('conversation-a', {}).items[0];
    expect(target.visitedAt).toBe(2);
    store.remove('conversation-b', target.id);
    expect(store.query('conversation-a', {}).total).toBe(1);
    store.clear('conversation-b');
    store.remove('conversation-a', target.id);
    await store.flush();
    expect(new BrowserHistoryStore({ filePath }).query('conversation-a', {}).total).toBe(0);
    expect(new BrowserHistoryStore({ filePath }).query('conversation-b', {}).total).toBe(0);
  });

  it('合并连续写入并原子替换独立文件，重启保留最新记录', async () => {
    const store = new BrowserHistoryStore({ filePath: join(directory, 'nested', 'history.json') });
    store.record(visit('https://example.com/a', 1));
    await store.flush();
    store.record(visit('https://example.com/b', 2));
    store.record(visit('https://example.com/c', 3));
    await store.flush();
    const restored = new BrowserHistoryStore({
      filePath: join(directory, 'nested', 'history.json'),
    });
    expect(restored.query('conversation-a', {}).items.map((entry) => entry.visitedAt)).toEqual([
      3, 2, 1,
    ]);
    expect(
      JSON.parse(readFileSync(join(directory, 'nested', 'history.json'), 'utf8')).version
    ).toBe(1);
  });

  it('坏 JSON、错误版本、超大文件安全降级为空库', () => {
    for (const data of ['{broken', 'null', '{"version":99,"items":[]}']) {
      writeFileSync(filePath, data);
      expect(new BrowserHistoryStore({ filePath }).query('conversation-a', {}).total).toBe(0);
    }
    truncateSync(filePath, 32 * 1024 * 1024 + 1);
    expect(new BrowserHistoryStore({ filePath }).query('conversation-a', {}).total).toBe(0);
  });

  it('逐项收窄磁盘数据，拒绝脏行和凭据并丢弃额外字段', async () => {
    const store = new BrowserHistoryStore({ filePath });
    store.record(visit('https://example.com/a', 1));
    await store.flush();
    const valid = store.query('conversation-a', {}).items[0];
    writeFileSync(
      filePath,
      JSON.stringify({
        version: 1,
        items: [
          null,
          {},
          { ...valid, visitedAt: 'bad' },
          { ...valid, id: 'bad', url: 'file:///secret' },
          { ...valid, id: 'bad', url: 'https://u:p@example.com' },
          { ...valid, secret: 'do not project' },
        ],
      })
    );
    const restored = new BrowserHistoryStore({ filePath });
    expect(restored.query('conversation-a', {}).items).toEqual([valid]);
    expect(restored.query('conversation-a', {}).items[0]).not.toHaveProperty('secret');
  });

  it('原子替换不改动旧 inode，忽略指向其他文件的历史符号链接', async () => {
    const store = new BrowserHistoryStore({ filePath });
    store.record(visit('https://example.com/a', 1));
    await store.flush();
    const backup = join(directory, 'backup.json');
    linkSync(filePath, backup);
    const previous = readFileSync(backup, 'utf8');
    store.record(visit('https://example.com/b', 2));
    await store.flush();
    expect(readFileSync(backup, 'utf8')).toBe(previous);
    expect(readFileSync(filePath, 'utf8')).not.toBe(previous);
    const alias = join(directory, 'alias.json');
    symlinkSync(filePath, alias);
    expect(new BrowserHistoryStore({ filePath: alias }).query('conversation-a', {}).total).toBe(0);
    expect(readdirSync(directory).some((name) => name.endsWith('.tmp'))).toBe(false);
  });

  it('坏 limit 和无效访问字段不能突破记录上限或污染存储', async () => {
    const store = new BrowserHistoryStore({ filePath, limit: -10 });
    store.record(visit('https://example.com/a', 1));
    store.record(visit('https://example.com/b', 2));
    store.record({ ...visit('https://example.com/c', 3), conversationId: '' });
    expect(store.query('conversation-a', {}).items.map((entry) => entry.visitedAt)).toEqual([2]);
    await store.flush();
  });

  it('写入失败会保留内存记录且 flush 可在修复目录后重试', async () => {
    const parent = join(directory, 'blocked');
    writeFileSync(parent, 'not a directory');
    const store = new BrowserHistoryStore({ filePath: join(parent, 'history.json') });
    store.record(visit('https://example.com/a', 1));
    await expect(store.flush()).rejects.toThrow();
    expect(store.query('conversation-a', {}).total).toBe(1);
    rmSync(parent);
    mkdirSync(parent);
    await store.flush();
    expect(
      new BrowserHistoryStore({ filePath: join(parent, 'history.json') }).query(
        'conversation-a',
        {}
      ).total
    ).toBe(1);
  });
});
