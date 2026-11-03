import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { decodeDesignArchive } from './archive';

function archive(name = 'design/frames/index.tsx', text = 'hello') {
  return zipSync({ [name]: strToU8(text) });
}
function central(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < bytes.length - 4; i++) {
    if (view.getUint32(i, true) === 0x02014b50) return i;
  }
  throw new Error('missing central directory');
}
function patchSize(bytes: Uint8Array, size: number) {
  const result = bytes.slice();
  const view = new DataView(result.buffer);
  view.setUint32(22, size, true);
  view.setUint32(central(result) + 24, size, true);
  return result;
}

describe('有界设计归档解码', () => {
  it('保留二进制内容、中文路径，目录不是可写文件', () => {
    const bytes = zipSync({ 设计: { '图片.png': new Uint8Array([0, 255, 1]) } });
    expect([...decodeDesignArchive(bytes)]).toEqual([
      ['设计/图片.png', new Uint8Array([0, 255, 1])],
    ]);
  });
  it.each([
    '../neighbor.vetd/file',
    'design/../../neighbor.vetd/file',
    '/absolute',
    'C:/drive',
    'design\\..\\escape',
    'design/./file',
    'design//file',
    'design/nu\0l',
  ])('拒绝危险路径 %j', (name) => {
    expect(() => decodeDesignArchive(archive(name))).toThrow();
  });
  it('在任何解压之前拒绝超限大小和数量', () => {
    const bytes = archive();
    expect(() => decodeDesignArchive(bytes, { maxCompressedBytes: bytes.length - 1 })).toThrow();
    expect(() => decodeDesignArchive(bytes, { maxFileBytes: 4 })).toThrow();
    expect(() => decodeDesignArchive(bytes, { maxUncompressedBytes: 4 })).toThrow();
    expect(() => decodeDesignArchive(bytes, { maxEntries: 0 })).toThrow();
  });
  it('计入所有文件的总大小', () => {
    const bytes = zipSync({ a: strToU8('123'), b: strToU8('456') });
    expect(() => decodeDesignArchive(bytes, { maxUncompressedBytes: 5 })).toThrow();
  });
  it('不信任伪造的小原始长度，限制真实膨胀输出', () => {
    const bomb = patchSize(archive('bomb', 'a'.repeat(2 * 1024 * 1024)), 1);
    expect(() => decodeDesignArchive(bomb, { maxFileBytes: 16 })).toThrow();
  });
  it('拒绝CRC损坏、截断、local/central不同的归档', () => {
    const bytes = archive();
    const corrupt = bytes.slice();
    const view = new DataView(corrupt.buffer);
    view.setUint32(14, 0, true);
    view.setUint32(central(corrupt) + 16, 0, true);
    expect(() => decodeDesignArchive(corrupt)).toThrow();
    expect(() => decodeDesignArchive(bytes.subarray(0, -5))).toThrow();
    const mismatch = bytes.slice();
    mismatch[30] = 120;
    expect(() => decodeDesignArchive(mismatch)).toThrow();
  });
  it('拒绝重复规范化路径和文件/目录碰撞', () => {
    const unicode = zipSync({ é: strToU8('a'), 'e\u0301': strToU8('b') });
    expect(() => decodeDesignArchive(unicode)).toThrow();
    expect(() => decodeDesignArchive(zipSync({ a: strToU8('a'), 'a/b': strToU8('b') }))).toThrow();
    const duplicate = zipSync({ a: strToU8('a'), b: strToU8('b') });
    // Rename both local and central b entries to a (zipSync's object cannot express duplicates).
    for (let i = 0; i < duplicate.length - 46; i++) {
      const view = new DataView(duplicate.buffer);
      if (view.getUint32(i, true) === 0x04034b50) duplicate[i + 30] = 97;
      if (view.getUint32(i, true) === 0x02014b50) duplicate[i + 46] = 97;
    }
    expect(() => decodeDesignArchive(duplicate)).toThrow();
  });
  it('拒绝Unix符号链接，而不是把链接伪装成普通文件', () => {
    const bytes = archive('link', '../neighbor');
    const view = new DataView(bytes.buffer);
    const offset = central(bytes);
    view.setUint16(offset + 4, 0x0314, true);
    view.setUint32(offset + 38, 0xa1ff0000, true);
    expect(() => decodeDesignArchive(bytes)).toThrow();
  });
});
