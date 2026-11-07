import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  afterPack,
  ensurePtyHelpersExecutable,
  hostPrebuildName,
  stripForeignPrebuildDirs,
  stripForeignSqlitePrebuilds,
  unpackedAppDir,
} from './stripPackagedNatives.mjs';

const dirs: string[] = [];

function writeUnfixedHelper(file: string) {
  // Windows only records writability; make chmod observable there too.
  writeFileSync(file, 'x', { mode: process.platform === 'win32' ? 0o444 : 0o644 });
}

function expectHelperPermissions(file: string) {
  // Windows chmod cannot represent execute bits. Verify its supported owner
  // permissions and unchanged bytes instead; POSIX keeps the executable check.
  const mask = process.platform === 'win32' ? 0o600 : 0o111;
  expect(statSync(file).mode & mask).toBe(mask);
  expect(readFileSync(file, 'utf8')).toBe('x');
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('stripPackagedNatives', () => {
  it('keeps only the host better-sqlite3 prebuild', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'enso-prebuilds-'));
    dirs.push(root);
    for (const name of [
      'darwin-arm64.node',
      'darwin-x64.node',
      'linux-x64.node',
      'linux-arm64.node',
      'linuxmusl-x64.node',
      'win32-x64.node',
      'win32-arm64.node',
    ]) {
      writeFileSync(path.join(root, name), 'x');
    }
    expect(stripForeignSqlitePrebuilds(root, 'darwin', 'arm64')).toEqual(
      expect.arrayContaining([
        'darwin-x64.node',
        'linux-x64.node',
        'win32-x64.node',
        'linuxmusl-x64.node',
      ])
    );
    expect(readdirSync(root)).toEqual(['darwin-arm64.node']);
  });

  it('resolves unpacked paths and host prebuild names per platform', () => {
    expect(hostPrebuildName('darwin', 'arm64')).toBe('darwin-arm64.node');
    expect(hostPrebuildName('win32', 'x64')).toBe('win32-x64.node');
    expect(unpackedAppDir('/out', 'darwin', 'EnsoCode')).toBe(
      path.join('/out', 'EnsoCode.app', 'Contents', 'Resources', 'app.asar.unpacked')
    );
    expect(unpackedAppDir('/out', 'linux', 'EnsoCode')).toBe(
      path.join('/out', 'resources', 'app.asar.unpacked')
    );
  });

  it('no-ops when the prebuilds directory is missing', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'enso-missing-'));
    dirs.push(root);
    expect(stripForeignSqlitePrebuilds(path.join(root, 'nope'), 'darwin', 'arm64')).toEqual([]);
    expect(stripForeignPrebuildDirs(path.join(root, 'nope'), 'darwin', 'x64')).toEqual([]);
  });

  it('keeps only the target <platform>-<arch> prebuild directory', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'enso-pty-'));
    dirs.push(root);
    for (const name of ['darwin-arm64', 'darwin-x64', 'win32-x64', 'win32-arm64']) {
      mkdirSync(path.join(root, name));
      writeFileSync(path.join(root, name, 'pty.node'), 'x');
    }
    expect(stripForeignPrebuildDirs(root, 'darwin', 'x64').sort()).toEqual([
      'darwin-arm64',
      'win32-arm64',
      'win32-x64',
    ]);
    expect(readdirSync(root)).toEqual(['darwin-x64']);
  });

  it('多架构目录（x64+arm64）对其中任一架构都保留', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'enso-multiarch-'));
    dirs.push(root);
    for (const name of ['darwin-x64+arm64', 'linux-x64', 'win32-x64', 'android-arm64']) {
      mkdirSync(path.join(root, name));
    }
    expect(stripForeignPrebuildDirs(root, 'darwin', 'arm64').sort()).toEqual([
      'android-arm64',
      'linux-x64',
      'win32-x64',
    ]);
    expect(readdirSync(root)).toEqual(['darwin-x64+arm64']);
  });

  it('给 node-pty 预编译的 spawn-helper 补执行位（npm 包里是 644）', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'enso-pty-helper-'));
    dirs.push(root);
    for (const name of ['darwin-arm64', 'darwin-x64', 'win32-x64']) {
      mkdirSync(path.join(root, name));
    }
    const helpers = ['darwin-arm64', 'darwin-x64'].map((dir) =>
      path.join(root, dir, 'spawn-helper')
    );
    for (const helper of helpers) writeUnfixedHelper(helper);
    expect(ensurePtyHelpersExecutable(root).sort()).toEqual(helpers);
    for (const helper of helpers) expectHelperPermissions(helper);
    expect(ensurePtyHelpersExecutable(path.join(root, 'nope'))).toEqual([]);
  });

  it('afterPack strips foreign prebuilds from the mac unpacked tree', async () => {
    const appOutDir = mkdtempSync(path.join(tmpdir(), 'enso-appout-'));
    dirs.push(appOutDir);
    const modules = path.join(unpackedAppDir(appOutDir, 'darwin', 'EnsoCode'), 'node_modules');
    const prebuilds = path.join(modules, 'better-sqlite3', 'prebuilds');
    const ptyPrebuilds = path.join(modules, 'node-pty', 'prebuilds');
    const tuiNative = path.join(modules, '@earendil-works', 'pi-tui', 'native');
    const levelPrebuilds = path.join(modules, 'classic-level', 'prebuilds');
    mkdirSync(prebuilds, { recursive: true });
    writeFileSync(path.join(prebuilds, 'darwin-arm64.node'), 'keep');
    writeFileSync(path.join(prebuilds, 'linux-x64.node'), 'drop');
    mkdirSync(path.join(ptyPrebuilds, 'darwin-arm64'), { recursive: true });
    writeUnfixedHelper(path.join(ptyPrebuilds, 'darwin-arm64', 'spawn-helper'));
    mkdirSync(path.join(ptyPrebuilds, 'darwin-x64'), { recursive: true });
    for (const dir of ['darwin/prebuilds/darwin-arm64', 'darwin/prebuilds/darwin-x64']) {
      mkdirSync(path.join(tuiNative, dir), { recursive: true });
    }
    mkdirSync(path.join(tuiNative, 'win32', 'prebuilds', 'win32-x64'), { recursive: true });
    for (const dir of ['darwin-x64+arm64', 'linux-x64', 'win32-x64']) {
      mkdirSync(path.join(levelPrebuilds, dir), { recursive: true });
    }
    await afterPack({
      appOutDir,
      electronPlatformName: 'darwin',
      arch: 3,
      packager: { appInfo: { productFilename: 'EnsoCode' } },
    });
    expect(readdirSync(prebuilds)).toEqual(['darwin-arm64.node']);
    expect(readdirSync(ptyPrebuilds)).toEqual(['darwin-arm64']);
    expectHelperPermissions(path.join(ptyPrebuilds, 'darwin-arm64', 'spawn-helper'));
    expect(readdirSync(path.join(tuiNative, 'darwin', 'prebuilds'))).toEqual(['darwin-arm64']);
    expect(readdirSync(path.join(tuiNative, 'win32', 'prebuilds'))).toEqual([]);
    expect(readdirSync(levelPrebuilds)).toEqual(['darwin-x64+arm64']);
  });
});
