import {
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PendingNotificationStore } from './pendingNotifications';

const leafFixture = vi.hoisted(() => ({
  symlink: undefined as string | undefined,
  beforeOpen: undefined as (() => void) | undefined,
  opened: undefined as number | undefined,
}));
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    // Only the selected leaf's metadata is simulated; directory guards and all IO remain real.
    lstatSync: ((...args: Parameters<typeof actual.lstatSync>) => {
      const stat = actual.lstatSync(...args);
      return stat && args[0] === leafFixture.symlink
        ? Object.assign(stat, { isSymbolicLink: () => true, isFile: () => false })
        : stat;
    }) as typeof actual.lstatSync,
    openSync: ((...args: Parameters<typeof actual.openSync>) => {
      leafFixture.beforeOpen?.();
      const fd = actual.openSync(...args);
      leafFixture.opened = fd;
      return fd;
    }) as typeof actual.openSync,
  };
});

describe('PendingNotificationStore', () => {
  let root: string;
  let dir: string;
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'enso-pending-'));
    dir = path.join(root, 'pending');
  });
  afterEach(() => {
    leafFixture.symlink = undefined;
    leafFixture.beforeOpen = undefined;
    leafFixture.opened = undefined;
    rmSync(root, { recursive: true, force: true });
  });

  it('即使 O_NOFOLLOW 缺失也拒绝叶符号链接，不交付其文件内容', () => {
    mkdirSync(dir);
    const file = path.join(dir, 'parent.json');
    writeFileSync(file, '["must not be delivered"]');
    leafFixture.symlink = file;
    expect(new PendingNotificationStore(dir).load('parent')).toEqual([]);
    expect(leafFixture.opened).toBeUndefined();
  });

  it('检查与 open 之间被替换为另一个普通文件时拒绝内容并关闭 fd', () => {
    mkdirSync(dir);
    const file = path.join(dir, 'parent.json');
    const replacement = path.join(dir, 'replacement.json');
    writeFileSync(file, '["approved"]');
    writeFileSync(replacement, '["swapped!"]');
    const before = lstatSync(file, { bigint: true });
    expect(lstatSync(replacement, { bigint: true }).ino).not.toBe(before.ino);
    leafFixture.beforeOpen = () => {
      leafFixture.beforeOpen = undefined;
      renameSync(replacement, file);
    };
    expect(new PendingNotificationStore(dir).load('parent')).toEqual([]);
    expect(leafFixture.opened).toBeTypeOf('number');
    expect(() => fstatSync(leafFixture.opened!)).toThrow(
      expect.objectContaining({ code: 'EBADF' })
    );
  });

  it('原子保留父子通知，重建 store 可读，消费后移除文件', () => {
    const store = new PendingNotificationStore(dir);
    store.save('parent::cw-helper', ['first', 'second']);
    expect(new PendingNotificationStore(dir).load('parent::cw-helper')).toEqual([
      'first',
      'second',
    ]);
    expect(readdirSync(dir)).toEqual(['parent%3A%3Acw-helper.json']);
    store.save('parent::cw-helper', []);
    expect(store.load('parent::cw-helper')).toEqual([]);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('坏 JSON 与脏内容降级为空或合法字符串，过大文件不读入上下文', () => {
    mkdirSync(dir);
    const file = path.join(dir, 'parent.json');
    writeFileSync(file, '{bad');
    const store = new PendingNotificationStore(dir);
    expect(store.load('parent')).toEqual([]);
    writeFileSync(file, JSON.stringify(['ok', 3, null, '', 'next']));
    expect(store.load('parent')).toEqual(['ok', 'next']);
    writeFileSync(file, 'x'.repeat(9 * 1024 * 1024));
    expect(store.load('parent')).toEqual([]);
  });

  it('容量溢出只保留有界的最新通知，不写入临时残片', () => {
    const store = new PendingNotificationStore(dir);
    store.save(
      'parent',
      Array.from({ length: 1200 }, (_, i) => `${i}:${'x'.repeat(9000)}`)
    );
    const restored = store.load('parent');
    expect(restored.length).toBeGreaterThan(0);
    expect(restored.length).toBeLessThanOrEqual(1000);
    expect(restored.at(-1)).toContain('1199:');
    expect(Buffer.byteLength(readFileSync(path.join(dir, 'parent.json')))).toBeLessThanOrEqual(
      8 * 1024 * 1024
    );
    expect(readdirSync(dir)).toEqual(['parent.json']);
  });

  it('无效身份不创建文件，目录或通知符号链接不越界读写', () => {
    const outside = path.join(root, 'outside');
    mkdirSync(outside);
    const secret = path.join(outside, 'secret.json');
    writeFileSync(secret, '["do not read"]');
    const store = new PendingNotificationStore(dir);
    for (const id of ['../escape', '..', '', '/abs', 'a\0b']) {
      store.save(id, ['bad']);
      expect(store.load(id)).toEqual([]);
    }
    expect(existsSync(dir)).toBe(false);
    symlinkSync(outside, dir, process.platform === 'win32' ? 'junction' : 'dir');
    store.save('parent', ['bad']);
    expect(store.load('secret')).toEqual([]);
    expect(existsSync(path.join(outside, 'parent.json'))).toBe(false);
    rmSync(dir, { recursive: true });
    mkdirSync(dir);
    // Windows junctions also exercise a linked leaf without requiring file-symlink privileges.
    symlinkSync(
      process.platform === 'win32' ? outside : secret,
      path.join(dir, 'parent.json'),
      process.platform === 'win32' ? 'junction' : 'file'
    );
    expect(store.load('parent')).toEqual([]);
    store.save('parent', ['safe']);
    expect(readFileSync(secret, 'utf8')).toBe('["do not read"]');
  });
});
