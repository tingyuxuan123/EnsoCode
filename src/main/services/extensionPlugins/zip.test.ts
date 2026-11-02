import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { extractZip } from './zip';

interface Input {
  name: string;
  data?: string | Buffer;
  mode?: number;
  madeBy?: number;
  method?: number;
  size?: number;
  localName?: string;
  localSize?: number;
}

// Deliberately permits malformed headers, duplicate names and Unix special entries.
function buildZip(entries: Input[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const localName = Buffer.from(entry.localName ?? entry.name);
    const raw = Buffer.from(entry.data ?? '');
    const compressed = entry.method === 8 ? deflateRawSync(raw) : raw;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(entry.method ?? 0, 8);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.localSize ?? raw.length, 22);
    local.writeUInt16LE(localName.length, 26);
    const localRecord = Buffer.concat([local, localName, compressed]);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50);
    central.writeUInt16LE(entry.madeBy ?? 0x0314, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(entry.method ?? 0, 10);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(entry.size ?? raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(((entry.mode ?? 0) * 65536) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    locals.push(localRecord);
    centrals.push(Buffer.concat([central, name]));
    offset += localRecord.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

describe('安全 ZIP 解压', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'enso-zip-'));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));
  const archive = (entries: Input[]) => {
    const file = join(root, 'input.zip');
    writeFileSync(file, buildZip(entries));
    return file;
  };
  it('正常 stored/deflate 解压，嵌套 zip 仅作为普通文件且不递归展开', async () => {
    const inner = buildZip([{ name: '../escape', data: 'no' }]);
    await extractZip(
      archive([
        { name: 'a.txt', data: 'hello', method: 8 },
        { name: 'nested.zip', data: inner },
      ]),
      join(root, 'out')
    );
    expect(readFileSync(join(root, 'out/a.txt'), 'utf8')).toBe('hello');
    expect(readFileSync(join(root, 'out/nested.zip'))).toEqual(inner);
    expect(existsSync(join(root, 'escape'))).toBe(false);
  });
  it('只保留 owner 执行权限，不传播 group/other 或特殊位', async () => {
    await extractZip(
      archive([
        { name: 'bin/x', data: 'x', mode: 0o104755, method: 8 },
        { name: 'plain', data: 'x', mode: 0o100666 },
      ]),
      join(root, 'out')
    );
    expect(statSync(join(root, 'out/bin/x')).mode & 0o7777).toBe(0o700);
    expect(statSync(join(root, 'out/plain')).mode & 0o7777).toBe(0o600);
  });
  it('非 Unix 生成者的 external attributes 不授予执行权限', async () => {
    await extractZip(
      archive([{ name: 'bin', data: 'x', mode: 0o100755, madeBy: 0x0014 }]),
      join(root, 'out')
    );
    expect(statSync(join(root, 'out/bin')).mode & 0o777).toBe(0o600);
  });
  it.each([
    '../escape',
    '/escape',
    'x\\escape',
    'C:/escape',
    '\\\\server\\share',
    'a/./b',
    'a//b',
    'a\0b',
    'file:stream',
    'CON',
    'a.',
  ])('拒绝跨平台危险路径 %s', async (name) => {
    await expect(extractZip(archive([{ name, data: 'x' }]), join(root, 'out'))).rejects.toThrow();
  });
  it.each([0o120777, 0o010600, 0o020600, 0o060600, 0o140600])(
    '拒绝 symlink/FIFO/device/socket %i',
    async (mode) => {
      await expect(
        extractZip(archive([{ name: 'special', mode }]), join(root, 'out'))
      ).rejects.toThrow();
    }
  );
  it.each(
    [
      [
        { name: 'a', data: 'first' },
        { name: 'a', data: 'overwrite' },
      ],
      [
        { name: 'A', data: 'first' },
        { name: 'a', data: 'overwrite' },
      ],
      [
        { name: 'a', data: 'first' },
        { name: 'a/b', data: 'x' },
      ],
      [{ name: 'a', localName: '../else', data: 'x' }],
      [{ name: 'a', localSize: 100, data: 'x' }],
      [{ name: 'a', method: 12, data: 'x' }],
      [{ name: 'a', method: 8, data: 'x'.repeat(1000), size: 1, localSize: 1 }],
    ].map((entries) => ({ entries }))
  )('拒绝重复路径、头部歧义或伪造体积 %#', async ({ entries }) => {
    await expect(extractZip(archive(entries), join(root, 'out'))).rejects.toThrow();
  });
  it('不通过预先存在的目标 symlink 写出 root，也不覆盖普通文件', async () => {
    const outside = join(root, 'outside');
    const out = join(root, 'out');
    mkdirSync(outside);
    mkdirSync(out);
    symlinkSync(outside, join(out, 'nested'));
    await expect(extractZip(archive([{ name: 'nested/x', data: 'pwn' }]), out)).rejects.toThrow();
    expect(existsSync(join(outside, 'x'))).toBe(false);
    writeFileSync(join(out, 'existing'), 'keep');
    await expect(extractZip(archive([{ name: 'existing', data: 'pwn' }]), out)).rejects.toThrow();
    expect(readFileSync(join(out, 'existing'), 'utf8')).toBe('keep');
  });
  it('输入 symlink/hardlink 拒绝，不误删用户源', async () => {
    const file = archive([{ name: 'a', data: 'a' }]);
    const linked = join(root, 'linked.zip');
    symlinkSync(file, linked);
    await expect(extractZip(linked, join(root, 'out'))).rejects.toThrow();
    rmSync(linked);
    linkSync(file, linked);
    await expect(extractZip(linked, join(root, 'out'))).rejects.toThrow();
    expect(existsSync(file)).toBe(true);
  });
  it('条目数、单文件和总量预算都有界', async () => {
    const file = archive([
      { name: 'a', data: '1234' },
      { name: 'b', data: '1234' },
    ]);
    for (const opts of [{ maxEntries: 1 }, { maxEntryBytes: 3 }, { maxTotalBytes: 7 }]) {
      await expect(extractZip(file, join(root, 'out'), opts)).rejects.toThrow();
    }
  });
});
