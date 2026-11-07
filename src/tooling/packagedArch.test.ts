import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { findArchMismatches, machOArchs } from './packagedArch.mjs';

const X86_64 = 0x01000007;
const ARM64 = 0x0100000c;

function thin(cpu: number): Buffer {
  const buffer = Buffer.alloc(32);
  buffer.writeUInt32LE(0xfeedfacf, 0);
  buffer.writeInt32LE(cpu, 4);
  return buffer;
}

function fat(...cpus: number[]): Buffer {
  const buffer = Buffer.alloc(8 + cpus.length * 20);
  buffer.writeUInt32BE(0xcafebabe, 0);
  buffer.writeUInt32BE(cpus.length, 4);
  for (const [index, cpu] of cpus.entries()) buffer.writeInt32BE(cpu, 8 + index * 20);
  return buffer;
}

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('packagedArch', () => {
  it('读出 thin / universal Mach-O 的架构，非 Mach-O 返回 null', () => {
    expect(machOArchs(thin(X86_64))).toEqual(['x64']);
    expect(machOArchs(thin(ARM64))).toEqual(['arm64']);
    expect(machOArchs(fat(X86_64, ARM64))).toEqual(['x64', 'arm64']);
    expect(machOArchs(Buffer.from('#!/bin/sh\n'))).toBeNull();
    expect(machOArchs(Buffer.alloc(2))).toBeNull();
    // Java class 与 fat Mach-O 同魔数，靠架构数量区分
    const javaClass = Buffer.alloc(8);
    javaClass.writeUInt32BE(0xcafebabe, 0);
    javaClass.writeUInt32BE(52, 4);
    expect(machOArchs(javaClass)).toBeNull();
  });

  it('列出缺少目标架构的 Mach-O，跳过非 Mach-O 与符号链接', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'enso-arch-'));
    dirs.push(root);
    mkdirSync(path.join(root, 'a', 'b'), { recursive: true });
    writeFileSync(path.join(root, 'x64.node'), thin(X86_64));
    writeFileSync(path.join(root, 'universal'), fat(ARM64, X86_64));
    writeFileSync(path.join(root, 'a', 'b', 'wrong.node'), thin(ARM64));
    writeFileSync(path.join(root, 'a', 'readme.txt'), 'hello');
    symlinkSync(path.join(root, 'a', 'b'), path.join(root, 'link'), 'junction');
    expect(findArchMismatches(root, 'x64')).toEqual([
      { file: path.join('a', 'b', 'wrong.node'), archs: ['arm64'] },
    ]);
    expect(findArchMismatches(root, 'arm64')).toEqual([{ file: 'x64.node', archs: ['x64'] }]);
  });
});
