import assert from 'node:assert/strict';
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import test from 'node:test';
import { executable, resolveGitExecutable } from '../main.mjs';
import { createRuntimeSetup } from '../setup.mjs';

const version = '3.6.0';
const nativeHeader = Buffer.from(
  process.platform === 'win32' ? [0x4d, 0x5a, 0, 0] : [0x7f, 0x45, 0x4c, 0x46]
);
const nodeName = process.platform === 'win32' ? 'node.exe' : 'node';
const gitName = process.platform === 'win32' ? 'git.exe' : 'git';
const controller = () => new AbortController();
const option = (args, name) => args.find((arg) => arg.startsWith(`--${name}=`))?.split(/=(.*)/s)[1];

async function nativeFile(path, content = nativeHeader) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
  await chmod(path, 0o700);
}

async function writeCli(prefix, installedVersion = version) {
  const pkg = join(prefix, 'node_modules', '@tokenroll', 'llmdoc');
  const entry = join(pkg, 'dist', 'bin', 'llmdoc.js');
  await mkdir(dirname(entry), { recursive: true });
  await writeFile(entry, '/* fake trusted CLI; detection never executes this file */');
  await writeFile(
    join(pkg, 'package.json'),
    JSON.stringify({
      name: '@tokenroll/llmdoc',
      version: installedVersion,
      bin: { llmdoc: './dist/bin/llmdoc.js' },
    })
  );
  return entry;
}

async function fixture(t, { withNode = true, withNpm = true } = {}) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'codekiln-llmdoc-setup-')));
  t.after(() => rm(dir, { force: true, recursive: true }));
  const home = join(dir, 'home');
  const root = join(dir, 'project');
  const dataDir = join(dir, 'plugin-data');
  const binDir = join(dir, 'trusted bin');
  for (const path of [home, root, dataDir, binDir]) await mkdir(path);
  const nodePrefix = join(home, '.nvm', 'versions', 'node', 'v24.16.0');
  const node = join(nodePrefix, 'bin', nodeName);
  if (withNode) await nativeFile(node);
  const git = join(binDir, gitName);
  await nativeFile(git);
  const npmRoot = join(nodePrefix, 'lib', 'node_modules', 'npm');
  const npmEntry = join(npmRoot, 'bin', 'npm-cli.js');
  if (withNpm) {
    await mkdir(dirname(npmEntry), { recursive: true });
    await writeFile(npmEntry, '#!/usr/bin/env node\n// fixture');
    await writeFile(
      join(npmRoot, 'package.json'),
      JSON.stringify({ name: 'npm', bin: { npm: 'bin/npm-cli.js' } })
    );
  }
  const knownPrefix = join(home, '.local', 'share', 'codekiln-llmdoc');
  const env = {
    HOME: home,
    PATH: `.${process.platform === 'win32' ? ';' : ':'}${root}`,
    NODE_OPTIONS: '--require secret.js',
    NPM_TOKEN: 'fixture-credential',
    npm_config_userconfig: join(home, '.npmrc'),
    HTTPS_PROXY: 'http://fixture-credentials.invalid',
    GIT_DIR: root,
  };
  await writeFile(join(root, '.npmrc'), 'registry=https://fixture-project.invalid/');
  await writeFile(join(home, '.npmrc'), '# fixture credential file\n');
  const config = { untouched: 'keep' };
  const runs = [];
  const versions = new Map([[node, { node: '24.16.0', release: 'node', electron: null }]]);
  const runner = async (file, args, options) => {
    runs.push({ file, args, options });
    if (args[0] === '-p')
      return { stdout: JSON.stringify(versions.get(file) ?? null), stderr: '', code: 0 };
    const prefix = option(args, 'prefix');
    await writeCli(prefix);
    return { stdout: '', stderr: '', code: 0 };
  };
  const options = {
    dataDir,
    getConfig: async () => config,
    validateCli: executable,
    validateGit: resolveGitExecutable,
    version,
    home,
    env,
    binDirs: [binDir],
    run: runner,
  };
  return {
    root,
    dir,
    dataDir,
    home,
    binDir,
    npmEntry,
    knownPrefix,
    git,
    node,
    config,
    runs,
    versions,
    options,
    setup: createRuntimeSetup(options),
  };
}

test('uses trusted NVM, Git and compatible user-prefix CLI without creating data or running npm', async (t) => {
  const fx = await fixture(t);
  const existing = await writeCli(fx.knownPrefix);
  assert.deepEqual(await fx.setup.resolveConfig(fx.root), {
    untouched: 'keep',
    nodeExecutable: fx.node,
    cliEntry: existing,
    gitExecutable: fx.git,
  });
  assert.deepEqual(await fx.setup.inspect(fx.root), {
    nodeAvailable: true,
    cliAvailable: true,
    gitAvailable: true,
    canInstall: false,
  });
  assert.deepEqual(await fx.setup.install(fx.root, controller().signal), {
    installed: false,
    alreadyPresent: true,
  });
  assert.deepEqual(fx.config, { untouched: 'keep' });
  assert.deepEqual(await readdir(fx.dataDir), []);
  assert.ok(
    fx.runs.every(
      ({ file, args, options }) =>
        file === fx.node && args[0] === '-p' && !('NODE_OPTIONS' in options.env)
    )
  );
});

test('shares concurrent inspect and resolve probes without caching stale settings', async (t) => {
  const fx = await fixture(t);
  const [resolved, inspected] = await Promise.all([
    fx.setup.resolveConfig(fx.root),
    fx.setup.inspect(fx.root),
  ]);
  assert.equal(resolved.nodeExecutable, fx.node);
  assert.equal(inspected.nodeAvailable, true);
  assert.equal(fx.runs.filter(({ args }) => args[0] === '-p').length, 1);
  fx.config.nodeExecutable = '/missing-explicit-node';
  assert.equal((await fx.setup.inspect(fx.root)).nodeAvailable, false);
  assert.equal((await fx.setup.resolveConfig(fx.root)).nodeExecutable, undefined);
  assert.equal(fx.config.nodeExecutable, '/missing-explicit-node');
});

test('preserves explicit overrides and never treats an invalid configured CLI as eligible for install', async (t) => {
  const fx = await fixture(t);
  const auto = await writeCli(fx.knownPrefix);
  const manual = await writeCli(join(fx.dir, 'manual'));
  fx.config.cliEntry = manual;
  fx.config.nodeExecutable = fx.node;
  assert.equal((await fx.setup.resolveConfig(fx.root)).cliEntry, manual);
  fx.config.cliEntry = './wrong.js';
  assert.notEqual(auto, fx.config.cliEntry);
  assert.equal((await fx.setup.resolveConfig(fx.root)).cliEntry, './wrong.js');
  const info = await fx.setup.inspect(fx.root);
  assert.equal(info.cliAvailable, false);
  assert.equal(info.canInstall, false);
  assert.match(info.installUnavailableReason, /手工/);
  await assert.rejects(fx.setup.install(fx.root, controller().signal), /手工/);
  assert.ok(fx.runs.every(({ args }) => args[0] === '-p'));
});

test('does not probe project/relative PATH, project symlinks, shell wrappers, wrong Node versions, or Electron', async (t) => {
  const fx = await fixture(t);
  await nativeFile(join(fx.root, nodeName));
  const fromPath = join(fx.binDir, nodeName);
  if (process.platform !== 'win32') await symlink(join(fx.root, nodeName), fromPath);
  fx.versions.set(fx.node, { node: '22.12.9', release: 'node', electron: null });
  const newer = join(fx.home, '.nvm', 'versions', 'node', 'v26.0.0', 'bin', nodeName);
  await nativeFile(newer);
  fx.versions.set(newer, { node: '24.16.0', release: 'node', electron: '43.0.0' });
  await nativeFile(
    join(fx.home, '.nvm', 'versions', 'node', 'v30.0.0', 'bin', nodeName),
    '#!/bin/sh\nexit 0'
  );
  const info = await fx.setup.inspect(fx.root);
  assert.equal(info.nodeAvailable, false);
  assert.equal(info.canInstall, false);
  assert.match(info.installUnavailableReason, /22\.13/);
  assert.deepEqual(fx.runs.map((run) => run.file).sort(), [fx.node, newer].sort());
});

test('missing npm does not block a ready CLI; unpinned existing CLI is ignored', async (t) => {
  const fx = await fixture(t, { withNpm: false });
  await writeCli(fx.knownPrefix, '3.6.1');
  const missing = await fx.setup.inspect(fx.root);
  assert.equal(missing.cliAvailable, false);
  assert.equal(missing.canInstall, false);
  assert.match(missing.installUnavailableReason, /npm/);
  await writeCli(fx.knownPrefix);
  assert.equal((await fx.setup.inspect(fx.root)).cliAvailable, true);
});

test('explicit install invokes paired npm JS with isolated config and atomically exposes the verified runtime', async (t) => {
  const fx = await fixture(t);
  const info = await fx.setup.inspect(fx.root);
  assert.deepEqual(info, {
    nodeAvailable: true,
    cliAvailable: false,
    gitAvailable: true,
    canInstall: true,
  });
  assert.deepEqual(await readdir(fx.dataDir), []);
  assert.deepEqual(await fx.setup.install(fx.root, controller().signal), { installed: true });
  const call = fx.runs.find(({ args }) => args.includes('install'));
  assert.equal(call.file, fx.node);
  assert.equal(call.args[call.args.indexOf('install') - 1], fx.npmEntry);
  assert.ok(call.args.includes('--permission'));
  assert.ok(!call.args.includes('--allow-child-process'));
  assert.ok(
    call.args.includes('--ignore-scripts') &&
      call.args.includes('--no-audit') &&
      call.args.includes('--no-fund')
  );
  assert.equal(option(call.args, 'registry'), 'https://registry.npmjs.org/');
  assert.equal(call.args.at(-1), '@tokenroll/llmdoc@3.6.0');
  assert.ok(call.options.cwd.startsWith(fx.dataDir));
  assert.ok(call.options.env.HOME.startsWith(fx.dataDir));
  assert.ok(option(call.args, 'userconfig').startsWith(fx.dataDir));
  assert.ok(option(call.args, 'globalconfig').startsWith(fx.dataDir));
  assert.notEqual(option(call.args, 'userconfig'), option(call.args, 'globalconfig'));
  for (const sensitive of [
    'PATH',
    'NODE_OPTIONS',
    'NPM_TOKEN',
    'npm_config_userconfig',
    'GIT_DIR',
    'HTTPS_PROXY',
  ]) {
    assert.equal(call.options.env[sensitive], undefined);
  }
  const result = await fx.setup.resolveConfig(fx.root);
  assert.ok(result.cliEntry.startsWith(fx.dataDir));
  await access(result.cliEntry);
  assert.equal((await readdir(fx.dataDir)).length, 1);
  assert.equal(
    await readFile(join(fx.root, '.npmrc'), 'utf8'),
    'registry=https://fixture-project.invalid/'
  );
  assert.deepEqual(fx.config, { untouched: 'keep' });
  assert.deepEqual(await fx.setup.install(fx.root, controller().signal), {
    installed: false,
    alreadyPresent: true,
  });
  assert.equal(fx.runs.filter(({ args }) => args.includes('install')).length, 1);
});

test('failed or incompatible npm output leaves no staging or visible runtime', async (t) => {
  const fx = await fixture(t);
  const setup = createRuntimeSetup({
    ...fx.options,
    run: async (file, args, options) => {
      if (!args.includes('install')) return fx.options.run(file, args, options);
      await writeCli(option(args, 'prefix'), '3.6.1');
      return { stdout: '', stderr: '', code: 0 };
    },
  });
  await assert.rejects(setup.install(fx.root, controller().signal), /3\.6\.0/);
  assert.deepEqual(await readdir(fx.dataDir), []);
  const failed = createRuntimeSetup({
    ...fx.options,
    run: async (file, args, options) => {
      if (!args.includes('install')) return fx.options.run(file, args, options);
      await writeCli(option(args, 'prefix'));
      return { stdout: '', stderr: 'private runtime failure with credential', code: 42 };
    },
  });
  await assert.rejects(
    failed.install(fx.root, controller().signal),
    (error) => /42/.test(error.message) && !error.message.includes('credential')
  );
  assert.deepEqual(await readdir(fx.dataDir), []);
});

test('only one install runs, cancellation removes staging, and a manual CLI override wins before publish', async (t) => {
  const fx = await fixture(t);
  const entered = Promise.withResolvers();
  const gate = Promise.withResolvers();
  const setup = createRuntimeSetup({
    ...fx.options,
    run: async (file, args, options) => {
      if (!args.includes('install')) return fx.options.run(file, args, options);
      await writeCli(option(args, 'prefix'));
      entered.resolve();
      await gate.promise;
      return { stdout: '', stderr: '', code: 0 };
    },
  });
  const abort = controller();
  const first = setup.install(fx.root, abort.signal);
  await entered.promise;
  assert.equal((await setup.inspect(fx.root)).canInstall, false);
  await assert.rejects(setup.install(fx.root, controller().signal), /安装.*进行/);
  await assert.rejects(
    createRuntimeSetup(fx.options).install(fx.root, controller().signal),
    /安装.*进行/
  );
  abort.abort();
  gate.resolve();
  await assert.rejects(first, /取消/);
  assert.deepEqual(await readdir(fx.dataDir), []);

  const second = createRuntimeSetup({
    ...fx.options,
    run: async (file, args, options) => {
      const result = await fx.options.run(file, args, options);
      if (args.includes('install')) fx.config.cliEntry = await writeCli(join(fx.dir, 'manual-new'));
      return result;
    },
  });
  assert.deepEqual(await second.install(fx.root, controller().signal), {
    installed: false,
    alreadyPresent: true,
  });
  assert.deepEqual(await readdir(fx.dataDir), []);
  assert.match(basename(dirname(fx.config.cliEntry)), /^bin$/);
});
