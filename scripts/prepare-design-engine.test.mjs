import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { prepareDesignEngine, stripForeignDesignPackages } from './prepare-design-engine.mjs';

async function fixture(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'enso-design-engine-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(path.join(dir, 'package-lock.json'), '{"lockfileVersion":3}');
  return dir;
}

test('installs once; missing modules, changed lock or target invalidate the stamp', async (t) => {
  const engineDir = await fixture(t);
  let calls = 0;
  const options = {
    engineDir,
    platform: process.platform,
    arch: process.arch,
    runNpm: async (args, cwd) => {
      calls++;
      assert.equal(cwd, engineDir);
      assert.deepEqual(args.slice(0, 4), ['ci', '--no-audit', '--no-fund', '--include=dev']);
      await mkdir(path.join(engineDir, 'node_modules'), { recursive: true });
    },
  };
  assert.equal(await prepareDesignEngine(options), true);
  assert.equal(await prepareDesignEngine(options), false);
  assert.equal(calls, 1);
  await rm(path.join(engineDir, 'node_modules'), { recursive: true });
  assert.equal(await prepareDesignEngine(options), true);
  await writeFile(
    path.join(engineDir, 'package-lock.json'),
    '{"lockfileVersion":3,"changed":true}'
  );
  assert.equal(await prepareDesignEngine(options), true);
  assert.equal(await prepareDesignEngine({ ...options, arch: 'different-arch' }), true);
  assert.equal(calls, 4);
});

test('a failed install removes the old stamp and is retried, never marked prepared', async (t) => {
  const engineDir = await fixture(t);
  const stamp = path.join(engineDir, '.enso-design-engine-stamp.json');
  await writeFile(stamp, 'old stamp');
  const options = {
    engineDir,
    runNpm: async () => {
      throw new Error('npm failed');
    },
  };
  await assert.rejects(prepareDesignEngine(options), /npm failed/);
  await assert.rejects(readFile(stamp), { code: 'ENOENT' });
  await assert.rejects(prepareDesignEngine(options), /npm failed/);
});

test('cross-architecture install selects target optionals without running host postinstalls', async (t) => {
  const engineDir = await fixture(t);
  await prepareDesignEngine({
    engineDir,
    arch: process.arch === 'arm64' ? 'x64' : 'arm64',
    runNpm: async (args) => {
      assert.ok(args.includes('--ignore-scripts'));
      assert.ok(args.includes(`--cpu=${process.arch === 'arm64' ? 'x64' : 'arm64'}`));
      await mkdir(path.join(engineDir, 'node_modules'));
    },
  });
});

test('afterPack prunes only foreign platform packages, including nested optional packages', async (t) => {
  const modules = path.join(await fixture(t), 'node_modules');
  const packages = [
    ['@esbuild/darwin-arm64', { os: ['darwin'], cpu: ['arm64'] }],
    ['@esbuild/darwin-x64', { os: ['darwin'], cpu: ['x64'] }],
    ['@rollup/rollup-linux-arm64-gnu', { os: ['linux'], cpu: ['arm64'] }],
    ['lightningcss', {}],
    ['vite/node_modules/fsevents', { os: ['darwin'] }],
    ['vite/node_modules/win32-only', { os: ['win32'] }],
    ['@tailwindcss/oxide-darwin-arm64', { os: ['darwin'], cpu: ['arm64'] }],
  ];
  for (const [name, metadata] of packages) {
    const dir = path.join(modules, name);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'package.json'), JSON.stringify(metadata));
  }
  assert.equal((await stripForeignDesignPackages(modules, 'darwin', 'arm64')).length, 3);
  await readFile(path.join(modules, '@esbuild/darwin-arm64/package.json'));
  await readFile(path.join(modules, 'lightningcss/package.json'));
  await readFile(path.join(modules, 'vite/node_modules/fsevents/package.json'));
  await readFile(path.join(modules, '@tailwindcss/oxide-darwin-arm64/package.json'));
  await assert.rejects(readFile(path.join(modules, '@esbuild/darwin-x64/package.json')), {
    code: 'ENOENT',
  });
});
