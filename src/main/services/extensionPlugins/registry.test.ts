import {
  chmodSync,
  linkSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { PluginRecord } from './lifecycle';
import { readRegistry, writeRegistry } from './registry';

const roots: string[] = [];
const temp = () => {
  const d = mkdtempSync(join(tmpdir(), 'enso-registry-'));
  roots.push(d);
  return d;
};
afterEach(() => {
  for (const d of roots.splice(0)) rmSync(d, { recursive: true, force: true });
});
const valid: PluginRecord = {
  id: 'example.demo',
  version: '1.0.0',
  dir: 'abc',
  state: 'disabled',
  grant: { permissions: [], fsRead: [], fsWrite: [], netDomains: [], mcp: [], renderer: false },
  installedAt: 1,
};
describe('原子私有插件登记表', () => {
  it('相同损坏内容只备份一次，最多保留最近五份', () => {
    const root = temp();
    const backups: string[] = [];
    for (let i = 0; i < 7; i++) {
      writeFileSync(join(root, 'registry.json'), `{bad${i}`);
      const result = readRegistry(root);
      expect(readRegistry(root).backupPath).toBe(result.backupPath);
      backups.push(result.backupPath!);
      utimesSync(result.backupPath!, 1000 + i, 1000 + i);
    }
    expect(
      readdirSync(root)
        .filter((name) => name.endsWith('.corrupt'))
        .sort()
    ).toEqual(
      backups
        .slice(-5)
        .map((path) => path.split('/').at(-1)!)
        .sort()
    );
  });
  it('损坏或不支持的登记表保留原件并备份，缺失不是损坏', () => {
    const root = temp();
    expect(readRegistry(root).error).toBeUndefined();
    for (const text of ['{broken', JSON.stringify({ version: 2, plugins: [] })]) {
      writeFileSync(join(root, 'registry.json'), text);
      const result = readRegistry(root);
      expect(result.error).toContain('只读');
      expect(readFileSync(join(root, 'registry.json'), 'utf8')).toBe(text);
      expect(result.backupPath).toMatch(/\.corrupt$/);
      expect(readFileSync(result.backupPath!, 'utf8')).toBe(text);
    }
  });
  it('缺失/坏JSON不抛异常，原子读写无临时文件，文件权限600', () => {
    const root = temp();
    expect(readRegistry(root).plugins).toEqual([]);
    writeFileSync(join(root, 'registry.json'), '{bad');
    expect(readRegistry(root).plugins).toEqual([]);
    writeRegistry(root, { version: 1, plugins: [valid] });
    expect(readRegistry(root)).toMatchObject({ plugins: [valid] });
    expect(readdirSync(root).filter((name) => !name.endsWith('.corrupt'))).toEqual([
      'registry.json',
    ]);
    expect(statSync(join(root, 'registry.json')).mode & 0o777).toBe(0o600);
  });
  it('旧版坏记录、危险路径、非有限时间和未知registry version不可授权', () => {
    const root = temp();
    const bad = [
      { ...valid, id: '../x' },
      { ...valid, id: 'a.b', dir: 'C:\\x' },
      { ...valid, id: 'a.c', installedAt: -1 },
      { ...valid, id: 'a.d', installedAt: null },
      { ...valid, id: 'a.e', grant: { ...valid.grant, permissions: ['root'] } },
    ];
    writeFileSync(
      join(root, 'registry.json'),
      JSON.stringify({ version: 1, plugins: [valid, ...bad, valid] })
    );
    expect(readRegistry(root)).toMatchObject({
      plugins: [],
      error: expect.stringContaining('只读'),
    });
    writeFileSync(join(root, 'registry.json'), JSON.stringify({ version: 2, plugins: [valid] }));
    expect(readRegistry(root).plugins).toEqual([]);
  });
  it('拒绝目标链接且不读取/改写链接源，不使用可预测tmp', () => {
    const root = temp();
    const outside = join(temp(), 'outside');
    writeFileSync(outside, JSON.stringify({ version: 1, plugins: [valid] }));
    symlinkSync(outside, join(root, 'registry.json'));
    expect(readRegistry(root).plugins).toEqual([]);
    expect(() => writeRegistry(root, { version: 1, plugins: [] })).toThrow();
    expect(JSON.parse(readFileSync(outside, 'utf8')).plugins).toHaveLength(1);
    rmSync(join(root, 'registry.json'));
    linkSync(outside, join(root, 'registry.json'));
    expect(readRegistry(root).plugins).toEqual([]);
    expect(() => writeRegistry(root, { version: 1, plugins: [] })).toThrow();
  });
  it('坏写入保留旧registry，已存在的可预测tmp不被覆盖', () => {
    const root = temp();
    writeRegistry(root, { version: 1, plugins: [valid] });
    const tmp = join(root, `registry.json.${process.pid}.tmp`);
    writeFileSync(tmp, 'keep');
    chmodSync(tmp, 0o644);
    writeRegistry(root, { version: 1, plugins: [valid] });
    expect(readFileSync(tmp, 'utf8')).toBe('keep');
    expect(() =>
      writeRegistry(root, { version: 1, plugins: [{ ...valid, installedAt: Number.NaN }] })
    ).toThrow();
    expect(readRegistry(root).plugins).toEqual([valid]);
  });
});
