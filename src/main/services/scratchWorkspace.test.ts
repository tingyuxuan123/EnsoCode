import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { removeScratchWorkspace, resolveScratchWorkspace } from './scratchWorkspace';

const id = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
let root: string;
let scratch: string;
beforeEach(() => {
  root = realpathSync(mkdtempSync(path.join(tmpdir(), 'enso-scratch-')));
  scratch = path.join(root, 'scratch');
  mkdirSync(scratch);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('scratch workspace boundary', () => {
  it('创建与重读各会话独立目录，删除只影响本会话', () => {
    const own = path.join(scratch, id);
    const sibling = path.join(scratch, other);
    expect(resolveScratchWorkspace(scratch, id, { create: true })).toBe(own);
    expect(resolveScratchWorkspace(scratch, other, { create: true })).toBe(sibling);
    writeFileSync(path.join(own, 'kept.txt'), 'history');
    writeFileSync(path.join(sibling, 'kept.txt'), 'sibling');
    expect(resolveScratchWorkspace(scratch, id)).toBe(own);
    removeScratchWorkspace(scratch, id);
    expect(existsSync(own)).toBe(false);
    expect(existsSync(path.join(sibling, 'kept.txt'))).toBe(true);
  });

  it.each(['', '..', '../outside', `${id}/..`, `${id}::cw-child`])(
    '拒绝非法 id %s，不创建/删除任何目录',
    (value) => {
      expect(resolveScratchWorkspace(scratch, value, { create: true })).toBeNull();
      removeScratchWorkspace(scratch, value);
      expect(existsSync(scratch)).toBe(true);
    }
  );

  it('拒绝会话目录 symlink 指向相邻会话或根目录外，删除不跟随', () => {
    const sibling = path.join(scratch, other);
    mkdirSync(sibling);
    const file = path.join(sibling, 'kept.txt');
    writeFileSync(file, 'keep');
    symlinkSync(sibling, path.join(scratch, id), 'junction');
    expect(resolveScratchWorkspace(scratch, id, { create: true })).toBeNull();
    removeScratchWorkspace(scratch, id);
    expect(existsSync(file)).toBe(true);
    expect(existsSync(path.join(scratch, id))).toBe(true);
  });

  it('根目录被替换成 symlink 时拒绝读取与删除外部内容', () => {
    const outside = path.join(root, 'outside');
    mkdirSync(path.join(outside, id), { recursive: true });
    const file = path.join(outside, id, 'kept.txt');
    writeFileSync(file, 'keep');
    rmSync(scratch, { recursive: true });
    symlinkSync(outside, scratch, 'junction');
    expect(resolveScratchWorkspace(scratch, id)).toBeNull();
    removeScratchWorkspace(scratch, id);
    expect(existsSync(file)).toBe(true);
  });
});
