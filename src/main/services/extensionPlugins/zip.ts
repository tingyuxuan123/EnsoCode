import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { inflateRaw } from 'node:zlib';

const inflate = promisify(inflateRaw);

export interface ExtractZipOptions {
  maxEntries?: number;
  maxTotalBytes?: number;
  maxEntryBytes?: number;
  maxArchiveBytes?: number;
  signal?: AbortSignal;
}

interface Entry {
  name: string;
  flags: number;
  method: number;
  compressed: number;
  size: number;
  offset: number;
  attrs: number;
  unix: boolean;
  start: number;
  end: number;
}

export async function extractZip(
  zipPath: string,
  destDir: string,
  options: ExtractZipOptions = {}
): Promise<void> {
  options.signal?.throwIfAborted();
  const info = await lstat(zipPath);
  if (!info.isFile() || info.nlink !== 1) throw new Error('压缩包必须是无链接的普通文件');
  const source = await realpath(zipPath);
  const file = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW);
  let buf: Buffer;
  try {
    const actual = await file.stat();
    if (
      actual.dev !== info.dev ||
      actual.ino !== info.ino ||
      actual.nlink !== 1 ||
      !actual.isFile()
    )
      throw new Error('压缩包已变化');
    if (actual.size > Math.min(options.maxArchiveBytes ?? 100 * 1024 * 1024, 100 * 1024 * 1024))
      throw new Error('压缩包过大');
    // Allocate only the checked size, never readFile an attacker-growing file.
    buf = Buffer.alloc(actual.size);
    let received = 0;
    while (received < buf.length) {
      options.signal?.throwIfAborted();
      const { bytesRead } = await file.read(buf, received, buf.length - received, received);
      if (!bytesRead) throw new Error('压缩包已变化');
      received += bytesRead;
    }
    if ((await file.stat()).size !== actual.size) throw new Error('压缩包已变化');
  } finally {
    await file.close();
  }
  let end = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50 && i + 22 + buf.readUInt16LE(i + 20) === buf.length) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error('不是有效的 ZIP 文件');
  const count = buf.readUInt16LE(end + 10);
  if (count === 0xffff || buf.readUInt32LE(end + 12) === 0xffffffff)
    throw new Error('不支持 ZIP64');
  if (buf.readUInt16LE(end + 4) || buf.readUInt16LE(end + 6) || buf.readUInt16LE(end + 8) !== count)
    throw new Error('不支持分卷压缩包');
  if (count > Math.min(options.maxEntries ?? 5000, 5000)) throw new Error('压缩包条目过多');
  const entries: Entry[] = [];
  let cursor = buf.readUInt32LE(end + 16);
  const cdStart = cursor;
  if (cursor + buf.readUInt32LE(end + 12) !== end) throw new Error('压缩包已损坏');
  let total = 0;
  const names = new Map<string, boolean>();
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > end || buf.readUInt32LE(cursor) !== 0x02014b50)
      throw new Error('压缩包已损坏');
    const length = buf.readUInt16LE(cursor + 28);
    const entry = {
      name: buf.toString('utf8', cursor + 46, cursor + 46 + length),
      flags: buf.readUInt16LE(cursor + 8),
      method: buf.readUInt16LE(cursor + 10),
      compressed: buf.readUInt32LE(cursor + 20),
      size: buf.readUInt32LE(cursor + 24),
      offset: buf.readUInt32LE(cursor + 42),
      attrs: buf.readUInt32LE(cursor + 38),
      unix: buf.readUInt16LE(cursor + 4) >>> 8 === 3,
      start: 0,
      end: 0,
    };
    const directory = entry.name.endsWith('/');
    const name = directory ? entry.name.slice(0, -1) : entry.name;
    if (
      name.includes('\\') ||
      name.includes('\0') ||
      name.startsWith('/') ||
      name
        .split('/')
        .some(
          (part) =>
            !part ||
            part === '.' ||
            part === '..' ||
            part.includes(':') ||
            hasControlCharacters(part) ||
            /[. ]$/.test(part) ||
            /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)
        )
    )
      throw new Error('压缩包条目路径越界');
    const key = name.normalize('NFC').toLowerCase();
    if (names.has(key)) throw new Error('压缩包包含重复路径');
    names.set(key, directory);
    const type = (entry.attrs >>> 16) & 0o170000;
    if (type && type !== (directory ? 0o040000 : 0o100000))
      throw new Error('压缩包包含链接或特殊文件');
    if (entry.flags & ~0x080e || (entry.method !== 0 && entry.method !== 8))
      throw new Error('不支持的压缩方法或加密');
    if ([entry.size, entry.compressed, entry.offset].includes(0xffffffff))
      throw new Error('不支持 ZIP64');
    if (directory && entry.size !== 0) throw new Error('目录包含数据');
    if (entry.size > Math.min(options.maxEntryBytes ?? 50 * 1024 * 1024, 50 * 1024 * 1024))
      throw new Error('单个条目过大');
    total += entry.size;
    if (total > Math.min(options.maxTotalBytes ?? 100 * 1024 * 1024, 100 * 1024 * 1024))
      throw new Error('压缩包过大');
    const next =
      cursor + 46 + length + buf.readUInt16LE(cursor + 30) + buf.readUInt16LE(cursor + 32);
    if (next > end) throw new Error('压缩包已损坏');
    checkExtra(buf, cursor + 46 + length, cursor + 46 + length + buf.readUInt16LE(cursor + 30));
    const offset = entry.offset;
    if (offset + 30 > cdStart || buf.readUInt32LE(offset) !== 0x04034b50)
      throw new Error('压缩包已损坏');
    const nameEnd = offset + 30 + buf.readUInt16LE(offset + 26);
    entry.start = nameEnd + buf.readUInt16LE(offset + 28);
    entry.end = entry.start + entry.compressed;
    if (
      entry.end > cdStart ||
      entry.start > cdStart ||
      buf.toString('utf8', offset + 30, nameEnd) !== entry.name ||
      buf.readUInt16LE(offset + 6) !== entry.flags ||
      buf.readUInt16LE(offset + 8) !== entry.method
    )
      throw new Error('压缩包本地头不一致');
    checkExtra(buf, nameEnd, entry.start);
    for (const [local, central] of [
      [buf.readUInt32LE(offset + 18), entry.compressed],
      [buf.readUInt32LE(offset + 22), entry.size],
      [buf.readUInt32LE(offset + 14), buf.readUInt32LE(cursor + 16)],
    ]) {
      if (local !== central && (!(entry.flags & 8) || local !== 0))
        throw new Error('压缩包大小声明不一致');
    }
    entries.push(entry);
    cursor = next;
  }
  if (cursor !== end) throw new Error('压缩包已损坏');
  for (const [name] of names) {
    const parts = name.split('/');
    for (let i = 1; i < parts.length; i++)
      if (names.get(parts.slice(0, i).join('/')) === false) throw new Error('文件和目录冲突');
  }
  const ranges = [...entries].sort((a, b) => a.offset - b.offset);
  for (let i = 1; i < ranges.length; i++)
    if (ranges[i].offset < ranges[i - 1].end) throw new Error('压缩包条目重叠');
  await mkdir(destDir, { recursive: true });
  if (
    !(await lstat(destDir)).isDirectory() ||
    (await lstat(destDir)).isSymbolicLink() ||
    (await readdir(destDir)).length
  )
    throw new Error('解压目标必须是空的普通目录');
  const root = await realpath(destDir);
  for (const entry of entries) {
    options.signal?.throwIfAborted();
    const compressed = buf.subarray(entry.start, entry.end);
    const bytes =
      entry.method === 8
        ? await inflate(compressed, { maxOutputLength: Math.max(1, entry.size) })
        : compressed;
    options.signal?.throwIfAborted();
    if (bytes.length !== entry.size) throw new Error('条目大小与声明不一致');
    const target = path.join(root, entry.name);
    if (entry.name.endsWith('/')) await safeMkdir(root, target);
    else {
      await safeMkdir(root, path.dirname(target));
      const out = await open(
        target,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
        entry.unix && (entry.attrs >>> 16) & 0o111 ? 0o700 : 0o600
      );
      try {
        await out.writeFile(bytes);
      } finally {
        await out.close();
      }
    }
  }
}

function checkExtra(buf: Buffer, start: number, end: number): void {
  for (let cursor = start; cursor < end; ) {
    if (cursor + 4 > end) throw new Error('压缩包已损坏');
    const id = buf.readUInt16LE(cursor);
    const size = buf.readUInt16LE(cursor + 2);
    if ([1, 0x000d, 0x756e].includes(id)) throw new Error('不支持 ZIP64 或 Unix 链接扩展');
    cursor += 4 + size;
    if (cursor > end) throw new Error('压缩包已损坏');
  }
}

async function safeMkdir(root: string, target: string): Promise<void> {
  let current = root;
  for (const part of path.relative(root, target).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    await mkdir(current, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'EEXIST') throw error;
    });
    const info = await lstat(current);
    if (!info.isDirectory() || info.isSymbolicLink() || (await realpath(current)) !== current)
      throw new Error('解压目录包含链接');
  }
}

/** Control characters must never appear in archive entry names. */
function hasControlCharacters(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}
