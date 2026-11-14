import { mkdirSync, mkdtempSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import * as realFs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 读盘不许「先 stat 再无限读」：文件在读取过程中增长时，必须在固定预算 +1 字节处停下，
 * 不能把整份增长中的文件读进内存再判 changed。这里用可控 open 夹具，不依赖机器速度。
 */

const hooks = {
  /** open 成功后、read 之前的确定性插入点（用于替换文件/根） */
  afterOpen: null as null | (() => void),
  /** 每次 read 前触发：让被读文件「边读边长」 */
  beforeRead: null as null | (() => void),
};

vi.mock('node:fs/promises', async (original) => {
  const fs = await original<typeof import('node:fs/promises')>();
  return {
    ...fs,
    open: vi.fn(async (file: string, flags: number) => {
      const handle = await fs.open(file, flags);
      hooks.afterOpen?.();
      const read = handle.read.bind(handle);
      (handle as unknown as { read: typeof read }).read = async (
        ...args: Parameters<typeof read>
      ) => {
        hooks.beforeRead?.();
        return read(...args);
      };
      return handle;
    }),
  };
});

const { readSessionImage, SESSION_IMAGE_FILE_MAX } = await import('./pairImages');

const PNG_HEAD = Buffer.from('89504e470d0a1a0a', 'hex');

describe('readSessionImage 的有界读取', () => {
  let tmp: string;
  let root: string;
  let file: string;

  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'enso-pair-image-bounded-'));
    root = path.join(tmp, 'workspace');
    mkdirSync(root);
    file = path.join(root, 'a.png');
    writeFileSync(file, PNG_HEAD);
    hooks.afterOpen = null;
    hooks.beforeRead = null;
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it('文件边读边长：读到预算+1 字节即判定超限，不把整份增长内容读进来', async () => {
    let reads = 0;
    hooks.beforeRead = () => {
      // 每次都把文件撑大一些：没有硬上限的实现会一直读下去（测试会超时/内存暴涨）
      reads += 1;
      writeFileSync(file, Buffer.alloc(Math.min(SESSION_IMAGE_FILE_MAX * 2, 1024 * 1024 * reads)));
    };
    const result = await readSessionImage(root, 'a.png');
    expect(result).toEqual({ error: 'too-large' });
    // 预算 20MiB / 单次读取块 1MiB 级别：必须在很少的几次读后停下
    expect(reads).toBeLessThanOrEqual(21);
  });

  it('读到一半被换成符号链接（指向根外）：判定 changed，不返回像素', async () => {
    writeFileSync(file, Buffer.concat([PNG_HEAD, Buffer.alloc(64, 1)]));
    const outside = path.join(tmp, 'outside.png');
    writeFileSync(outside, PNG_HEAD);
    hooks.afterOpen = () => {
      rmSync(file);
      symlinkSync(outside, file);
    };
    expect(await readSessionImage(root, 'a.png')).toEqual({ error: 'changed' });
  });

  it('读到一半被换成目录：判定 changed', async () => {
    writeFileSync(file, Buffer.concat([PNG_HEAD, Buffer.alloc(64, 1)]));
    hooks.afterOpen = () => {
      rmSync(file);
      mkdirSync(file);
    };
    expect(await readSessionImage(root, 'a.png')).toEqual({ error: 'changed' });
  });

  it('读到一半根目录被整体换掉（realpath 变了）：判定 changed', async () => {
    writeFileSync(file, Buffer.concat([PNG_HEAD, Buffer.alloc(64, 1)]));
    hooks.afterOpen = () => {
      renameSync(root, path.join(tmp, 'workspace-old'));
      mkdirSync(root);
      writeFileSync(path.join(root, 'a.png'), PNG_HEAD);
    };
    expect(await readSessionImage(root, 'a.png')).toEqual({ error: 'changed' });
  });

  it('正常小图仍能读到完整字节', async () => {
    const bytes = Buffer.concat([PNG_HEAD, Buffer.alloc(128, 7)]);
    writeFileSync(file, bytes);
    const result = await readSessionImage(root, 'a.png');
    if ('error' in result) throw new Error(`unexpected error ${result.error}`);
    expect(result.mime).toBe('image/png');
    expect(result.data.equals(bytes)).toBe(true);
    void realFs;
  });
});
