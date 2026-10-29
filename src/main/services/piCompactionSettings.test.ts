import { mkdir, mkdtemp, readdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SettingsManager } from '@earendil-works/pi-coding-agent';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readCompactReserveTokens, writeCompactReserveTokens } from './piCompactionSettings';

let dir: string;
let file: string;
const json = async () => JSON.parse(await readFile(file, 'utf8'));
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'enso-reserve-'));
  file = join(dir, 'pi-agent', 'settings.json');
});
afterEach(async () => rm(dir, { recursive: true, force: true }));

describe('应用隔离目录的压缩预留设置', () => {
  it('缺省读取不创建目录；写入后可读且文件权限不暴露设置', async () => {
    expect(await readCompactReserveTokens(file)).toEqual({ ok: true, value: null });
    expect(await readdir(dir)).toEqual([]);
    expect(await writeCompactReserveTokens(file, 20000)).toEqual({ ok: true });
    expect(await json()).toEqual({ compaction: { reserveTokens: 20000 } });
    expect(await readCompactReserveTokens(file)).toEqual({ ok: true, value: 20000 });
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(await readdir(join(dir, 'pi-agent'))).toEqual(['settings.json']);
  });

  it('保留未知字段、压缩策略及模型覆盖，清空只删目标字段', async () => {
    await mkdir(join(dir, 'pi-agent'));
    const compaction = { enabled: false, keepRecentTokens: 123, modelOverrides: { m: {} } };
    await writeFile(file, `\uFEFF${JSON.stringify({ deviceId: 'd', compaction })}`);
    expect(await writeCompactReserveTokens(file, 32768)).toEqual({ ok: true });
    expect(await json()).toEqual({
      deviceId: 'd',
      compaction: { ...compaction, reserveTokens: 32768 },
    });
    expect(await writeCompactReserveTokens(file, null)).toEqual({ ok: true });
    expect(await json()).toEqual({ deviceId: 'd', compaction });
    await writeFile(file, JSON.stringify({ deviceId: 'd', compaction: { reserveTokens: 4096 } }));
    expect(await writeCompactReserveTokens(file, null)).toEqual({ ok: true });
    expect(await json()).toEqual({ deviceId: 'd' });
  });

  it.each(['{ broken', '[]', 'null', '{"compaction":[]}'])(
    '坏配置不覆盖且返回结构化错误：%s',
    async (body) => {
      await mkdir(join(dir, 'pi-agent'));
      await writeFile(file, body);
      expect(await readCompactReserveTokens(file)).toEqual({ ok: false, error: 'invalid-file' });
      expect(await writeCompactReserveTokens(file, 20000)).toEqual({
        ok: false,
        error: 'invalid-file',
      });
      expect(await readFile(file, 'utf8')).toBe(body);
      expect(await readdir(join(dir, 'pi-agent'))).toEqual(['settings.json']);
    }
  );

  it('非法输入不创建任何本地文件', async () => {
    for (const value of [10, '20000', NaN, undefined, {}]) {
      expect(await writeCompactReserveTokens(file, value)).toEqual({
        ok: false,
        error: 'invalid-value',
      });
    }
    expect(await readdir(dir)).toEqual([]);
  });

  it('锁等待不阻塞事件循环、不删除其他持有者的锁、不改写文件', async () => {
    await mkdir(join(dir, 'pi-agent'));
    await writeFile(file, '{}');
    await mkdir(`${file}.lock`);
    let ticked = false;
    const timer = setTimeout(() => {
      ticked = true;
    }, 0);
    expect(await writeCompactReserveTokens(file, 20000)).toEqual({ ok: false, error: 'locked' });
    clearTimeout(timer);
    expect(ticked).toBe(true);
    expect(await json()).toEqual({});
    expect((await stat(`${file}.lock`)).isDirectory()).toBe(true);
  });

  it('锁释放后读取最新盘面，避免覆盖并发写入的其他字段', async () => {
    await mkdir(join(dir, 'pi-agent'));
    await writeFile(file, '{}');
    await mkdir(`${file}.lock`);
    const pending = writeCompactReserveTokens(file, 20000);
    await writeFile(file, JSON.stringify({ concurrent: true }));
    await rm(`${file}.lock`, { recursive: true });
    expect(await pending).toEqual({ ok: true });
    expect(await json()).toEqual({ concurrent: true, compaction: { reserveTokens: 20000 } });
  });

  it('按 pi 相同的过期规则恢复崩溃残留锁，不永久阻塞设置保存', async () => {
    await mkdir(join(dir, 'pi-agent'));
    await writeFile(file, '{}');
    await mkdir(`${file}.lock`);
    const stale = new Date(Date.now() - 60_000);
    await utimes(`${file}.lock`, stale, stale);
    expect(await writeCompactReserveTokens(file, 20000)).toEqual({ ok: true });
    expect(await json()).toEqual({ compaction: { reserveTokens: 20000 } });
    expect(await readdir(join(dir, 'pi-agent'))).toEqual(['settings.json']);
  });

  it('不可写或不可读的路径返回错误而不向 IPC 抛异常', async () => {
    await mkdir(join(dir, 'pi-agent'));
    await mkdir(file);
    expect(await readCompactReserveTokens(file)).toEqual({ ok: false, error: 'io-error' });
    expect(await writeCompactReserveTokens(file, 20000)).toEqual({ ok: false, error: 'io-error' });
    expect(await readdir(join(dir, 'pi-agent'))).toEqual(['settings.json']);
  });

  it('新建 SettingsManager 读取新值，已有会话实例不伪装成热更新', async () => {
    const cwd = join(dir, 'project');
    await mkdir(cwd);
    const before = SettingsManager.create(cwd, join(dir, 'pi-agent'));
    expect(before.getCompactionReserveTokens()).toBe(16384);
    expect(await writeCompactReserveTokens(file, 32768)).toEqual({ ok: true });
    expect(before.getCompactionReserveTokens()).toBe(16384);
    const after = SettingsManager.create(cwd, join(dir, 'pi-agent'));
    expect(after.getCompactionReserveTokens()).toBe(32768);
  });
});
