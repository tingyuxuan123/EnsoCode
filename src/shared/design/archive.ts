import { Inflate } from 'fflate';

export interface DesignArchiveLimits {
  maxCompressedBytes?: number;
  maxUncompressedBytes?: number;
  maxFileBytes?: number;
  maxEntries?: number;
}

const DEFAULTS: Required<DesignArchiveLimits> = {
  maxCompressedBytes: 32 * 1024 * 1024,
  maxUncompressedBytes: 128 * 1024 * 1024,
  maxFileBytes: 32 * 1024 * 1024,
  maxEntries: 10000,
};
function invalid(reason: string): never {
  throw new Error(`Invalid design archive: ${reason}`);
}

/** Also used before importing an already-decoded/mutated package. No normalization may hide traversal. */
export function assertDesignArchivePath(name: string): void {
  if (
    !name ||
    name.length > 4096 ||
    /[\\\0:]/.test(name) ||
    name.split('/').some((part) => !part || part === '.' || part === '..')
  )
    invalid('unsafe path');
}
const identity = (name: string) => name.normalize('NFC').toLowerCase();
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  let crc = n;
  for (let k = 0; k < 8; k++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});
function updateCrc(crc: number, bytes: Uint8Array): number {
  let next = crc;
  for (const byte of bytes) next = (next >>> 8) ^ crcTable[(next ^ byte) & 255];
  return next;
}
interface Entry {
  name: string;
  directory: boolean;
  size: number;
  compressed: number;
  method: number;
  crc: number;
  start: number;
}

/**
 * ZIP32 only, stored/deflate, no encryption/symlinks. Preflight ALL central/local headers
 * before allocating output. Then stream tiny compressed chunks, checking real output length
 * and CRC: central-directory sizes alone do not defend against a forged-size zip bomb.
 * At 256 compressed bytes/push, even maximal DEFLATE expansion has bounded scratch memory
 * (~264KiB plus fflate's 32KiB history), independently of the attacker's declared sizes.
 */
export function decodeDesignArchive(
  bytes: Uint8Array,
  limits: DesignArchiveLimits = {}
): Map<string, Uint8Array> {
  const bound = { ...DEFAULTS, ...limits };
  for (const limit of Object.values(bound)) {
    if (!Number.isSafeInteger(limit) || limit < 0) invalid('invalid limits');
  }
  if (bytes.length > bound.maxCompressedBytes || bytes.length < 22) invalid('compressed size');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (offset: number) => view.getUint16(offset, true);
  const u32 = (offset: number) => view.getUint32(offset, true);
  let end = bytes.length - 22;
  const earliest = Math.max(0, end - 65535);
  while (end >= earliest && (u32(end) !== 0x06054b50 || end + 22 + u16(end + 20) !== bytes.length))
    end--;
  if (end < earliest) invalid('missing end record');
  const count = u16(end + 10);
  const centralSize = u32(end + 12);
  const centralStart = u32(end + 16);
  if (
    u16(end + 4) ||
    u16(end + 6) ||
    u16(end + 8) !== count ||
    count === 65535 ||
    count > bound.maxEntries ||
    centralStart + centralSize !== end
  )
    invalid('unsupported directory');
  const decodeName = (start: number, length: number) => {
    try {
      // Current shares are UTF-8. Reject ill-formed names instead of silently aliasing replacements.
      return new TextDecoder('utf-8', { fatal: true }).decode(
        bytes.subarray(start, start + length)
      );
    } catch {
      return invalid('invalid UTF-8 path');
    }
  };
  const checkExtra = (start: number, length: number) => {
    const stop = start + length;
    for (let p = start; p < stop; ) {
      if (p + 4 > stop) invalid('truncated extra field');
      const tag = u16(p);
      const size = u16(p + 2);
      if (tag === 1 || tag === 0x7075 || p + 4 + size > stop) invalid('unsupported extra field');
      p += 4 + size;
    }
  };
  const entries: Entry[] = [];
  const paths = new Map<string, boolean>();
  const spans: Array<[number, number]> = [];
  let total = 0;
  let p = centralStart;
  for (let i = 0; i < count; i++) {
    if (p + 46 > end || u32(p) !== 0x02014b50) invalid('central header');
    const flags = u16(p + 8);
    const method = u16(p + 10);
    const crc = u32(p + 16);
    const compressed = u32(p + 20);
    const size = u32(p + 24);
    const nameLength = u16(p + 28);
    const extraLength = u16(p + 30);
    const next = p + 46 + nameLength + extraLength + u16(p + 32);
    if (next > end || flags & ~0x80e || (method !== 0 && method !== 8) || u16(p + 34))
      invalid('unsupported entry');
    const rawName = decodeName(p + 46, nameLength);
    const directory = rawName.endsWith('/');
    const name = directory ? rawName.slice(0, -1) : rawName;
    assertDesignArchivePath(name);
    const key = identity(name);
    if (paths.has(key)) invalid('duplicate path');
    paths.set(key, directory);
    const unixType = (u32(p + 38) >>> 16) & 0xf000;
    if (unixType && unixType !== (directory ? 0x4000 : 0x8000)) invalid('non-regular entry');
    if ((directory && size !== 0) || size > bound.maxFileBytes) invalid('entry size');
    total += size;
    if (total > bound.maxUncompressedBytes) invalid('total size');
    checkExtra(p + 46 + nameLength, extraLength);
    const local = u32(p + 42);
    if (local + 30 > centralStart || u32(local) !== 0x04034b50) invalid('local header');
    const localNameLength = u16(local + 26);
    const localExtraLength = u16(local + 28);
    const start = local + 30 + localNameLength + localExtraLength;
    if (
      start + compressed > centralStart ||
      u16(local + 6) !== flags ||
      u16(local + 8) !== method ||
      decodeName(local + 30, localNameLength) !== rawName ||
      (!(flags & 8) &&
        (u32(local + 14) !== crc || u32(local + 18) !== compressed || u32(local + 22) !== size)) ||
      (method === 0 && compressed !== size)
    )
      invalid('inconsistent local entry');
    checkExtra(local + 30 + localNameLength, localExtraLength);
    spans.push([local, start + compressed]);
    entries.push({ name, directory, size, compressed, method, crc, start });
    p = next;
  }
  if (p !== end) invalid('directory size mismatch');
  spans.sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < spans.length; i++) {
    if (spans[i][0] < spans[i - 1][1]) invalid('overlapping entries');
  }
  for (const name of paths.keys()) {
    const parts = name.split('/');
    for (let i = 1; i < parts.length; i++) {
      if (paths.get(parts.slice(0, i).join('/')) === false) invalid('file/directory conflict');
    }
  }
  const result = new Map<string, Uint8Array>();
  for (const entry of entries) {
    const output = new Uint8Array(entry.size);
    let offset = 0;
    let crc = -1;
    const consume = (chunk: Uint8Array) => {
      if (offset + chunk.length > entry.size) invalid('inflated size exceeds header');
      output.set(chunk, offset);
      offset += chunk.length;
      crc = updateCrc(crc, chunk);
    };
    const data = bytes.subarray(entry.start, entry.start + entry.compressed);
    if (entry.method === 0) consume(data);
    else {
      const inflate = new Inflate(consume);
      if (!data.length) invalid('empty deflate stream');
      for (let n = 0; n < data.length; n += 256)
        inflate.push(data.subarray(n, n + 256), n + 256 >= data.length);
    }
    if (offset !== entry.size || (crc ^ -1) >>> 0 !== entry.crc) invalid('length or CRC mismatch');
    if (!entry.directory) result.set(entry.name, output);
  }
  return result;
}
