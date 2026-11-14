import fs, {
  chmodSync,
  linkSync,
  lstatSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PluginRecord } from './lifecycle';
import { readRegistry, writeRegistry } from './registry';

vi.mock('node:fs', async (original) => {
  const actual = await original<typeof import('node:fs')>();
  return { ...actual, lstatSync: vi.fn(actual.lstatSync) };
});

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
  grant: {
    permissions: [],
    fsRead: [],
    fsWrite: [],
    netDomains: [],
    browserDomains: [],
    mcp: [],
    mcpTools: [],
    renderer: false,
    env: [],
    interop: [],
    intercepts: [],
    resident: false,
    styles: false,
  },
  installedAt: 1,
};
describe('原子私有插件登记表', () => {
  it('roundtrips validated sources and refuses malformed authority metadata', () => {
    const root = temp();
    const record = {
      ...valid,
      source: { kind: 'market' as const, id: valid.id, version: '2' },
      crossSessionInject: false,
      lastError: { at: 1, message: 'failed' },
    };
    writeRegistry(root, { version: 1, plugins: [record] });
    expect(readRegistry(root).plugins).toEqual([record]);
    for (const source of [
      { kind: 'url', url: 'http://example.com/a.zip' },
      { kind: 'dir', path: '../relative' },
      { kind: 'market', id: '../bad' },
      { kind: 'market', id: valid.id, marketId: 'Collabra!' },
      { kind: 'market', id: valid.id, marketId: 'x'.repeat(33) },
      { kind: 'market', id: valid.id, marketId: 7 },
      { kind: 'unknown' },
    ]) {
      writeFileSync(
        join(root, 'registry.json'),
        JSON.stringify({ version: 1, plugins: [{ ...valid, source }] })
      );
      expect(readRegistry(root).error).toContain('只读');
    }
  });
  it('历史无 marketId 的市场来源仍可读取，新市场来源带 marketId 也合法', () => {
    const root = temp();
    const legacy = { ...valid, source: { kind: 'market' as const, id: valid.id, version: '2' } };
    writeRegistry(root, { version: 1, plugins: [legacy] });
    const read = readRegistry(root);
    expect(read.error).toBeUndefined();
    expect(read.plugins[0].source).toEqual({ kind: 'market', id: valid.id, version: '2' });
    const current = {
      ...valid,
      source: { kind: 'market' as const, id: valid.id, marketId: 'collabra' },
    };
    writeRegistry(root, { version: 1, plugins: [current] });
    expect(readRegistry(root).error).toBeUndefined();
    expect(readRegistry(root).plugins[0].source).toEqual({
      kind: 'market',
      id: valid.id,
      marketId: 'collabra',
    });
  });

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
        .map((path) => basename(path))
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
    const permissionMask = process.platform === 'win32' ? 0o600 : 0o777;
    expect(statSync(join(root, 'registry.json')).mode & permissionMask).toBe(0o600);
    expect(JSON.parse(readFileSync(join(root, 'registry.json'), 'utf8'))).toEqual({
      version: 1,
      plugins: [valid],
    });
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
    const content = JSON.stringify({ version: 1, plugins: [valid] });
    const target = join(realpathSync(root), 'registry.json');
    writeFileSync(outside, content);
    if (process.platform === 'win32') {
      // A readable leaf is real; only its link metadata needs symlink privileges.
      writeFileSync(target, content);
      vi.mocked(lstatSync).mockImplementation((path, options) => {
        const info = fs.lstatSync(path, options);
        if (path === target && info) {
          info.isFile = () => false;
          info.isSymbolicLink = () => true;
        }
        return info;
      });
    } else symlinkSync(outside, target);
    try {
      expect(readRegistry(root).plugins).toEqual([]);
      expect(() => writeRegistry(root, { version: 1, plugins: [] })).toThrow();
      expect(readFileSync(target, 'utf8')).toBe(content);
    } finally {
      vi.mocked(lstatSync).mockImplementation(fs.lstatSync);
    }
    expect(JSON.parse(readFileSync(outside, 'utf8')).plugins).toHaveLength(1);
    rmSync(target);
    linkSync(outside, target);
    expect(readRegistry(root).plugins).toEqual([]);
    expect(() => writeRegistry(root, { version: 1, plugins: [] })).toThrow();
    expect(readFileSync(outside, 'utf8')).toBe(content);
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
