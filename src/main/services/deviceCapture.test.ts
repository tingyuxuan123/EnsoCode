import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MAX_DEVICE_CAPTURE_BYTES, parseDeviceCapture, saveDeviceCapture } from './deviceCapture';

const bytes = (...values: number[]) => new Uint8Array(values);
const at = new Date(2026, 10, 19, 8, 5, 7);

async function downloads(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'codekiln-capture-'));
}

describe('saveDeviceCapture', () => {
  it('把画面写成按设备命名的文件并返回路径', async () => {
    const directory = await downloads();
    const written = await saveDeviceCapture({
      directory,
      device: 'Pixel 10 Pro',
      kind: 'png',
      data: bytes(1, 2, 3),
      now: at,
    });
    expect(path.dirname(written)).toBe(directory);
    expect(path.basename(written)).toBe('Pixel-10-Pro-20261119-080507.png');
    expect([...(await readFile(written))]).toEqual([1, 2, 3]);
  });

  it('同一秒的两次保存不会互相覆盖', async () => {
    const directory = await downloads();
    const first = await saveDeviceCapture({
      directory,
      device: 'Pixel',
      kind: 'png',
      data: bytes(1),
      now: at,
    });
    const second = await saveDeviceCapture({
      directory,
      device: 'Pixel',
      kind: 'png',
      data: bytes(2),
      now: at,
    });
    expect(second).not.toBe(first);
    expect((await readdir(directory)).sort()).toEqual([
      'Pixel-20261119-080507-2.png',
      'Pixel-20261119-080507.png',
    ]);
  });

  it('录屏按容器写扩展名，并接受 IPC 传来的 ArrayBuffer', async () => {
    const directory = await downloads();
    const data = bytes(7, 8).buffer;
    const written = await saveDeviceCapture({
      directory,
      device: 'iPhone 17',
      kind: 'webm',
      data,
      now: at,
    });
    expect(path.extname(written)).toBe('.webm');
    expect([...(await readFile(written))]).toEqual([7, 8]);
  });

  it('设备名里的路径字符不会逃出目录', async () => {
    const directory = await downloads();
    const written = await saveDeviceCapture({
      directory,
      device: '../../etc/passwd',
      kind: 'png',
      data: bytes(1),
      now: at,
    });
    expect(path.dirname(written)).toBe(directory);
    expect(path.basename(written)).not.toContain('/');
  });

  it('拒绝空数据、未知类型与超大画面', async () => {
    const directory = await downloads();
    const common = { directory, device: 'Pixel', now: at };
    await expect(saveDeviceCapture({ ...common, kind: 'png', data: bytes() })).rejects.toThrow(
      'empty'
    );
    await expect(
      saveDeviceCapture({ ...common, kind: 'gif' as never, data: bytes(1) })
    ).rejects.toThrow('kind');
    await expect(
      saveDeviceCapture({
        ...common,
        kind: 'png',
        data: new Uint8Array(MAX_DEVICE_CAPTURE_BYTES + 1),
      })
    ).rejects.toThrow('too large');
  });
});

describe('parseDeviceCapture', () => {
  it('接受渲染端传来的截图与录屏', () => {
    expect(parseDeviceCapture({ device: 'Pixel', kind: 'png', data: bytes(1) })).toMatchObject({
      device: 'Pixel',
      kind: 'png',
    });
    const buffer = bytes(1, 2).buffer;
    expect(parseDeviceCapture({ device: 'iPhone', kind: 'mp4', data: buffer })?.kind).toBe('mp4');
  });

  it('拒绝坏参数，不把路径、未知类型或空名字放进来', () => {
    expect(parseDeviceCapture(null)).toBeNull();
    expect(parseDeviceCapture({ kind: 'png', data: bytes(1) })).toBeNull();
    expect(parseDeviceCapture({ device: '  ', kind: 'png', data: bytes(1) })).toBeNull();
    expect(parseDeviceCapture({ device: 'x'.repeat(201), kind: 'png', data: bytes(1) })).toBeNull();
    expect(parseDeviceCapture({ device: 'Pixel', kind: 'gif', data: bytes(1) })).toBeNull();
    expect(parseDeviceCapture({ device: 'Pixel', kind: 'png', data: 'not bytes' })).toBeNull();
  });
});
