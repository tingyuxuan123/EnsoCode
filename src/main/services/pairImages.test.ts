import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { HostToPhone } from '@enso/pair';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createPairImagePort,
  normalizeSessionImageRel,
  readSessionImage,
  resolveSessionImageFile,
  SESSION_IMAGE_FILE_MAX,
  type SessionImageSource,
} from './pairImages';

const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108020000009077' +
    '3d780000000c4944415478da63f8cf00000003000100' +
    'c9fe92ef0000000049454e44ae426082',
  'hex'
);

describe('会话图片路径边界', () => {
  let tmp: string;
  let root: string;
  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'enso-pair-images-'));
    root = path.join(tmp, 'workspace');
    mkdirSync(path.join(root, 'shots'), { recursive: true });
    writeFileSync(path.join(root, 'shots', 'a.png'), PNG);
    writeFileSync(path.join(tmp, 'outside.png'), PNG);
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it('相对路径在根内才解析成绝对路径', () => {
    expect(resolveSessionImageFile(root, 'shots/a.png')).toBe(
      path.join(realpathSync(root), 'shots', 'a.png')
    );
    expect(resolveSessionImageFile(root, '../outside.png')).toBeNull();
    expect(resolveSessionImageFile(root, 'shots/missing.png')).toBeNull();
    expect(resolveSessionImageFile(root, path.join(tmp, 'outside.png'))).toBeNull();
  });

  it('符号链接逃出根目录时拒绝', () => {
    const link = path.join(root, 'shots', 'escape.png');
    symlinkSync(path.join(tmp, 'outside.png'), link);
    expect(resolveSessionImageFile(root, 'shots/escape.png')).toBeNull();
    expect(normalizeSessionImageRel('shots/escape.png')).toBe('shots/escape.png');
  });

  it('读到像素与 mime；非图片扩展名、目录、超大文件分别报错', async () => {
    const ok = await readSessionImage(root, 'shots/a.png');
    expect('error' in ok).toBe(false);
    if ('error' in ok) throw new Error('unreachable');
    expect(ok.mime).toBe('image/png');
    expect(ok.data.equals(PNG)).toBe(true);

    writeFileSync(path.join(root, 'notes.txt'), 'hi');
    expect(await readSessionImage(root, 'notes.txt')).toEqual({ error: 'unsupported' });
    expect(await readSessionImage(root, 'shots')).toEqual({ error: 'not-found' });
    expect(await readSessionImage(root, 'shots/missing.png')).toEqual({ error: 'not-found' });
    expect(await readSessionImage(root, '../outside.png')).toEqual({ error: 'invalid' });

    const big = path.join(root, 'shots', 'big.png');
    writeFileSync(big, PNG);
    truncateSync(big, SESSION_IMAGE_FILE_MAX + 1);
    expect(await readSessionImage(root, 'shots/big.png')).toEqual({ error: 'too-large' });
  });
});

describe('createPairImagePort', () => {
  let tmp: string;
  let root: string;
  const source: SessionImageSource = { root: '', stamp: 'v1' };
  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'enso-pair-image-port-'));
    root = path.join(tmp, 'workspace');
    mkdirSync(root);
    writeFileSync(path.join(root, 'a.png'), PNG);
    source.root = root;
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  const command = {
    type: 'session-image' as const,
    requestId: 'r1',
    sessionId: 's1',
    rel: 'a.png',
  };

  it('授权会话返回压好的 data URL（编码器决定压缩）', async () => {
    const frames: HostToPhone[] = [];
    const port = createPairImagePort({
      lookup: () => source,
      encode: (data, mime) => `data:${mime};base64,${data.toString('base64')}`,
    });
    await port.handle(command, async (frame) => {
      frames.push(frame);
      return true;
    });
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({
      type: 'session-image-result',
      requestId: 'r1',
      dataUrl: `data:image/png;base64,${PNG.toString('base64')}`,
    });
  });

  it('无权会话/越界路径/缩不下来都回错误码，不回半张图', async () => {
    const lookup = vi.fn((sessionId: string) => (sessionId === 's1' ? source : null));
    const encode = vi.fn(() => null);
    const port = createPairImagePort({ lookup, encode });
    const frames: HostToPhone[] = [];
    const reply = async (frame: HostToPhone) => {
      frames.push(frame);
      return true;
    };
    await port.handle({ ...command, sessionId: 'other' }, reply);
    expect(frames.at(-1)).toMatchObject({ error: 'unavailable' });

    await port.handle({ ...command, rel: '../outside.png' }, reply);
    expect(frames.at(-1)).toMatchObject({ error: 'invalid' });

    await port.handle(command, reply);
    expect(frames.at(-1)).toMatchObject({ error: 'too-large' });
  });

  it('读盘期间权威根变化就不再回图', async () => {
    // 第一次 lookup 在读数前，第二次在编码前：期间工作树/授权变了就不能把旧内容发出去
    let calls = 0;
    const frames: HostToPhone[] = [];
    const port = createPairImagePort({
      lookup: () => ({ root, stamp: ++calls === 1 ? 'v1' : 'v2' }),
      encode: (data, mime) => `data:${mime};base64,${data.toString('base64')}`,
    });
    await port.handle(command, async (frame) => {
      frames.push(frame);
      return true;
    });
    expect(frames.at(-1)).toMatchObject({ error: 'unavailable' });
    expect(calls).toBeGreaterThan(1);
  });

  it('canAccess/accessKey 跟随权威记录', () => {
    const port = createPairImagePort({
      lookup: (id) => (id === 's1' ? source : null),
      encode: () => null,
    });
    expect(port.canAccess?.('s1')).toBe(true);
    expect(port.canAccess?.('s2')).toBe(false);
    expect(port.accessKey?.('s1')).toContain(root);
    expect(port.accessKey?.('s2')).toBeNull();
  });
});
