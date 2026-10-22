import { EventEmitter } from 'node:events';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import type { DownloadItem } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserDownloads } from './browserDownloads';

const { reveal } = vi.hoisted(() => ({ reveal: vi.fn() }));
vi.mock('electron', () => ({ shell: { showItemInFolder: reveal } }));

class MockDownload extends EventEmitter {
  filename = 'report.pdf';
  url = 'https://example.com/report';
  received = 0;
  total = 100;
  paused = false;
  resumable = true;
  savePath = '';
  cancel = vi.fn(() => this.emit('done', {}, 'cancelled'));
  pause = vi.fn(() => {
    this.paused = true;
  });
  resume = vi.fn(() => {
    this.paused = false;
  });
  getFilename = () => this.filename;
  getURL = () => this.url;
  getReceivedBytes = () => this.received;
  getTotalBytes = () => this.total;
  isPaused = () => this.paused;
  canResume = () => this.resumable;
  setSavePath = (value: string) => {
    this.savePath = value;
  };
  item(): DownloadItem {
    return this as unknown as DownloadItem;
  }
  update(state = 'progressing'): void {
    this.emit('updated', {}, state);
  }
  done(state = 'completed'): void {
    this.emit('done', {}, state);
  }
}

let directory: string;
let filePath: string;
let downloadDir: string;
let manager: BrowserDownloads;
const owner = { conversationId: 'conversation-a', tabId: 'tab-a' };
const entries = () => manager.query(owner.conversationId, {}).items;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'enso-browser-downloads-'));
  filePath = join(directory, 'downloads.json');
  downloadDir = join(directory, 'files');
  manager = new BrowserDownloads({ filePath, downloadDir });
  reveal.mockReset();
});
afterEach(() => {
  manager.dispose();
  rmSync(directory, { recursive: true, force: true });
});

describe('BrowserDownloads', () => {
  it('直接接收 Electron DownloadItem，分配 Main 权威保存路径且投影不含磁盘路径', () => {
    const item = new MockDownload();
    manager.accept(item.item(), owner);
    expect(dirname(item.savePath)).toBe(downloadDir);
    expect(entries()).toEqual([
      expect.objectContaining({
        ...owner,
        url: item.url,
        filename: 'report.pdf',
        receivedBytes: 0,
        totalBytes: 100,
        state: 'progressing',
      }),
    ]);
    expect(entries()[0]).not.toHaveProperty('path');
    expect(entries()[0]).not.toHaveProperty('savePath');
    expect(JSON.stringify(entries())).not.toContain(directory);
  });

  it('拒绝非法所有者与含凭据、非 HTTP(S) 下载且取消底层任务', () => {
    for (const url of ['file:///secret', 'https://u:p@example.com/file']) {
      const item = new MockDownload();
      item.url = url;
      expect(() => manager.accept(item.item(), owner)).toThrow();
      expect(item.cancel).toHaveBeenCalledOnce();
      expect(item.savePath).toBe('');
    }
    const item = new MockDownload();
    expect(() => manager.accept(item.item(), { conversationId: '', tabId: 'tab' })).toThrow();
    expect(item.cancel).toHaveBeenCalledOnce();
    expect(entries()).toEqual([]);
  });

  it('清理 POSIX、Windows 路径穿越、控制字符、保留名称和超长文件名', () => {
    for (const filename of [
      '../../escape.pdf',
      '..\\..\\escape.pdf',
      '/tmp/file.txt',
      'CON',
      '..',
      '.',
      '\0bad\n:name?.txt',
      '长'.repeat(200),
    ]) {
      const item = new MockDownload();
      item.filename = filename;
      manager.accept(item.item(), owner);
      const actual = basename(item.savePath);
      expect(dirname(item.savePath)).toBe(downloadDir);
      expect(actual).not.toMatch(/[\\/:*?"<>|]/);
      expect(Array.from(actual).some((character) => character.charCodeAt(0) < 32)).toBe(false);
      expect(actual).not.toBe('.');
      expect(actual).not.toBe('..');
      expect(actual).not.toMatch(/^con(?:\.|$)/i);
      expect(Buffer.byteLength(actual)).toBeLessThan(241);
    }
    expect(existsSync(join(directory, 'escape.pdf'))).toBe(false);
  });

  it('重名、已存在文件和符号链接都不会被覆盖，正在下载的名字也不会复用', () => {
    mkdirSync(downloadDir);
    writeFileSync(join(downloadDir, 'report.pdf'), 'existing');
    const outside = join(directory, 'outside');
    writeFileSync(outside, 'secret');
    symlinkSync(outside, join(downloadDir, 'report (1).pdf'));
    const first = new MockDownload();
    const second = new MockDownload();
    manager.accept(first.item(), owner);
    manager.accept(second.item(), owner);
    expect(
      new Set([
        first.savePath,
        second.savePath,
        join(downloadDir, 'report.pdf'),
        join(downloadDir, 'report (1).pdf'),
      ]).size
    ).toBe(4);
    expect(readFileSync(outside, 'utf8')).toBe('secret');
    expect(readFileSync(join(downloadDir, 'report.pdf'), 'utf8')).toBe('existing');
    expect(lstatSync(first.savePath).isSymbolicLink()).toBe(false);
  });

  it('下载目录本身为符号链接时拒绝接收，不写出目录边界', () => {
    const outside = join(directory, 'outside');
    mkdirSync(outside);
    symlinkSync(outside, downloadDir);
    const item = new MockDownload();
    expect(() => manager.accept(item.item(), owner)).toThrow();
    expect(item.cancel).toHaveBeenCalledOnce();
    expect(readdirSync(outside)).toEqual([]);
  });

  it('updated/done 维护进度、暂停、完成以及会话级变更回调', async () => {
    const onChange = vi.fn();
    manager.dispose();
    manager = new BrowserDownloads({ filePath, downloadDir, onChange });
    const item = new MockDownload();
    manager.accept(item.item(), owner);
    const id = entries()[0].id;
    item.received = 30;
    item.update();
    expect(entries()[0].receivedBytes).toBe(30);
    await manager.action(owner.conversationId, id, 'pause');
    expect(item.pause).toHaveBeenCalledOnce();
    expect(entries()[0].state).toBe('paused');
    await manager.action(owner.conversationId, id, 'resume');
    expect(item.resume).toHaveBeenCalledOnce();
    expect(entries()[0].state).toBe('progressing');
    item.received = 100;
    item.done();
    expect(entries()[0]).toMatchObject({ state: 'completed', receivedBytes: 100, totalBytes: 100 });
    expect(onChange).toHaveBeenCalledWith(owner.conversationId);
    expect(item.listenerCount('updated')).toBe(0);
    expect(item.listenerCount('done')).toBe(0);
    await expect(manager.action(owner.conversationId, id, 'pause')).rejects.toThrow();
  });

  it('取消任务保存取消终态，迟到事件不能重新激活记录', async () => {
    const item = new MockDownload();
    manager.accept(item.item(), owner);
    await manager.action(owner.conversationId, entries()[0].id, 'cancel');
    item.update();
    item.done();
    expect(item.cancel).toHaveBeenCalledOnce();
    expect(entries()[0].state).toBe('cancelled');
  });

  it('网络中断保留可恢复活任务，不可恢复任务禁止 resume', async () => {
    const item = new MockDownload();
    manager.accept(item.item(), owner);
    const id = entries()[0].id;
    item.update('interrupted');
    expect(entries()[0].state).toBe('interrupted');
    item.resumable = false;
    await expect(manager.action(owner.conversationId, id, 'resume')).rejects.toThrow();
    item.resumable = true;
    await manager.action(owner.conversationId, id, 'resume');
    expect(entries()[0].state).toBe('progressing');
    item.done('interrupted');
    expect(entries()[0]).toMatchObject({ state: 'interrupted', error: expect.any(String) });
    await expect(manager.action(owner.conversationId, id, 'resume')).rejects.toThrow();
  });

  it('按会话搜索分页，未知或跨会话 id 无法暂停、取消、移除或 reveal', async () => {
    for (let i = 0; i < 3; i++) {
      const item = new MockDownload();
      item.filename = `report-${i}.pdf`;
      manager.accept(item.item(), owner);
    }
    const result = manager.query(owner.conversationId, { query: ' REPORT ', offset: 1, limit: 1 });
    expect(result.total).toBe(3);
    expect(result.items).toHaveLength(1);
    const id = result.items[0].id;
    result.items[0].filename = 'changed';
    expect(manager.query(owner.conversationId, { query: 'changed' }).total).toBe(0);
    for (const action of ['pause', 'resume', 'cancel', 'remove', 'reveal'] as const) {
      await expect(manager.action('conversation-b', id, action)).rejects.toThrow();
      await expect(manager.action(owner.conversationId, 'missing', action)).rejects.toThrow();
    }
    expect(entries()).toHaveLength(3);
    expect(reveal).not.toHaveBeenCalled();
  });

  it('移除记录会取消活任务但不删除实体文件，完成记录也只删记录', async () => {
    const active = new MockDownload();
    manager.accept(active.item(), owner);
    writeFileSync(active.savePath, 'partial');
    await manager.action(owner.conversationId, entries()[0].id, 'remove');
    expect(active.cancel).toHaveBeenCalledOnce();
    expect(readFileSync(active.savePath, 'utf8')).toBe('partial');
    const completed = new MockDownload();
    manager.accept(completed.item(), owner);
    completed.done();
    await manager.action(owner.conversationId, entries()[0].id, 'remove');
    expect(entries()).toEqual([]);
    expect(existsSync(completed.savePath)).toBe(true);
  });

  it('reveal 仅按 id 推导现存普通文件，不执行文件并拒绝符号链接或已替换目录', async () => {
    const item = new MockDownload();
    manager.accept(item.item(), owner);
    item.done();
    const id = entries()[0].id;
    await manager.action(owner.conversationId, id, 'reveal');
    expect(reveal).toHaveBeenCalledExactlyOnceWith(item.savePath);
    rmSync(item.savePath);
    await expect(manager.action(owner.conversationId, id, 'reveal')).rejects.toThrow();
    const outside = join(directory, 'outside');
    writeFileSync(outside, 'secret');
    symlinkSync(outside, item.savePath);
    await expect(manager.action(owner.conversationId, id, 'reveal')).rejects.toThrow();
    rmSync(downloadDir, { recursive: true });
    const replacement = join(directory, 'replacement');
    mkdirSync(replacement);
    writeFileSync(join(replacement, entries()[0].filename), 'other file');
    symlinkSync(replacement, downloadDir);
    await expect(manager.action(owner.conversationId, id, 'reveal')).rejects.toThrow();
    expect(reveal).toHaveBeenCalledOnce();
  });

  it('重启将未完成下载标 interrupted，不恢复 Electron 活对象，完成记录仍可 reveal', async () => {
    const active = new MockDownload();
    manager.accept(active.item(), owner);
    const completed = new MockDownload();
    manager.accept(completed.item(), owner);
    completed.done();
    await manager.flush();
    const activeId = entries().find((entry) => entry.state === 'progressing')?.id ?? '';
    const completedId = entries().find((entry) => entry.state === 'completed')?.id ?? '';
    const restored = new BrowserDownloads({ filePath, downloadDir });
    expect(
      restored.query(owner.conversationId, {}).items.find((entry) => entry.id === activeId)
    ).toMatchObject({ state: 'interrupted' });
    await expect(restored.action(owner.conversationId, activeId, 'resume')).rejects.toThrow();
    await restored.action(owner.conversationId, completedId, 'reveal');
    expect(reveal).toHaveBeenCalledWith(completed.savePath);
    await restored.flush();
    restored.dispose();
  });

  it('坏 JSON、版本和超大文件安全降级为空列表', () => {
    for (const data of ['{bad', 'null', '{"version":99,"items":[]}']) {
      writeFileSync(filePath, data);
      const restored = new BrowserDownloads({ filePath, downloadDir });
      expect(restored.query(owner.conversationId, {}).total).toBe(0);
      restored.dispose();
    }
    truncateSync(filePath, 32 * 1024 * 1024 + 1);
    const restored = new BrowserDownloads({ filePath, downloadDir });
    expect(restored.query(owner.conversationId, {}).total).toBe(0);
    restored.dispose();
  });

  it('过滤恶意持久化名称、脏计数和路径字段，不能借记录 reveal 任意文件', async () => {
    const item = new MockDownload();
    manager.accept(item.item(), owner);
    item.done();
    await manager.flush();
    const valid = entries()[0];
    writeFileSync(
      filePath,
      JSON.stringify({
        version: 1,
        items: [
          null,
          {},
          { ...valid, id: 'bad', filename: '../outside' },
          { ...valid, id: 'bad', receivedBytes: -1 },
          { ...valid, id: 'bad', state: 'bogus' },
          { ...valid, path: '/secret', savePath: '/secret' },
        ],
      })
    );
    const restored = new BrowserDownloads({ filePath, downloadDir });
    expect(restored.query(owner.conversationId, {}).items).toEqual([valid]);
    await expect(restored.action(owner.conversationId, '../outside', 'reveal')).rejects.toThrow();
    restored.dispose();
  });

  it('异常数值不会污染进度或导致持久化失效', async () => {
    const item = new MockDownload();
    item.received = Number.NaN;
    item.total = -1;
    manager.accept(item.item(), owner);
    item.received = Number.POSITIVE_INFINITY;
    item.total = Number.NaN;
    item.update();
    expect(entries()[0]).toMatchObject({ receivedBytes: 0, totalBytes: 0 });
    await manager.flush();
    expect(JSON.parse(readFileSync(filePath, 'utf8')).items[0].receivedBytes).toBe(0);
  });

  it('写盘失败不丢进度，修复目录后 flush 可以重试且不留下临时文件', async () => {
    manager.dispose();
    const blocked = join(directory, 'blocked');
    writeFileSync(blocked, 'not a directory');
    manager = new BrowserDownloads({ filePath: join(blocked, 'downloads.json'), downloadDir });
    const item = new MockDownload();
    manager.accept(item.item(), owner);
    item.received = 45;
    item.update();
    await expect(manager.flush()).rejects.toThrow();
    rmSync(blocked);
    mkdirSync(blocked);
    await manager.flush();
    const restored = new BrowserDownloads({
      filePath: join(blocked, 'downloads.json'),
      downloadDir,
    });
    expect(restored.query(owner.conversationId, {}).items[0].receivedBytes).toBe(45);
    expect(readdirSync(blocked)).toEqual(['downloads.json']);
    restored.dispose();
  });

  it('接收下载时同步 done 事件不能被 pause 操作重新激活', async () => {
    const item = new MockDownload();
    manager.accept(item.item(), owner);
    item.pause.mockImplementation(() => {
      item.paused = true;
      item.done('cancelled');
    });
    await manager.action(owner.conversationId, entries()[0].id, 'pause');
    expect(entries()[0].state).toBe('cancelled');
  });

  it('同一 DownloadItem 重复交入不重复记录，终态后也不会再接管', () => {
    const item = new MockDownload();
    manager.accept(item.item(), owner);
    const originalPath = item.savePath;
    manager.accept(item.item(), owner);
    item.done();
    manager.accept(item.item(), owner);
    expect(item.savePath).toBe(originalPath);
    expect(entries()).toHaveLength(1);
  });

  it('dispose 释放监听器且不取消下载，迟到事件不再发布状态', () => {
    const item = new MockDownload();
    manager.accept(item.item(), owner);
    manager.dispose();
    expect(item.cancel).not.toHaveBeenCalled();
    expect(item.listenerCount('updated')).toBe(0);
    expect(item.listenerCount('done')).toBe(0);
    item.done();
    expect(entries()[0].state).toBe('interrupted');
    expect(() => manager.accept(new MockDownload().item(), owner)).toThrow();
  });
});
