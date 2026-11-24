import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, realpath, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { registerMaintenance } from '../maintenance.mjs';

async function fixture(t, setup) {
  const top = await realpath(await mkdtemp(join(tmpdir(), 'llmdoc-maintenance-')));
  t.after(() => rm(top, { recursive: true, force: true }));
  const root = join(top, 'code');
  await mkdir(root);
  const abort = new AbortController();
  const draft = { text: '', hasReferences: false, generation: 'd1', rev: 'r1' };
  const writes = [];
  const methods = new Map();
  const tools = new Map();
  const config = {
    nodeExecutable: join(top, 'node'),
    cliEntry: join(top, 'runtime', 'llmdoc.js'),
    gitExecutable: join(top, 'git'),
    secret: 'must-not-leak',
  };
  const state = { configured: true, gitConfigured: true, gesture: true };
  registerMaintenance(
    {
      renderer: { handle: (name, handler) => methods.set(name, handler) },
      tools: { register: (name, handler) => tools.set(name, handler) },
      config: { get: async () => config },
      composer: {
        readDraft: async () => {
          if (!state.gesture) throw new Error('GESTURE_REQUIRED');
          return { ...draft };
        },
        insertText: async (input) => {
          assert.equal(input.expect.rev, draft.rev);
          writes.push(input);
        },
        replaceDraft: () => assert.fail('must not replace drafts'),
      },
      session: { inject: () => assert.fail('must not submit a message') },
    },
    {
      gitRoot: async (ctx) => {
        if (!ctx?.sessionId || ctx.projectRoot !== root) throw new Error('not a Code project');
        return root;
      },
      executable: async () => {
        if (!state.configured) throw new Error('missing CLI');
        return { node: config.nodeExecutable, entry: config.cliEntry };
      },
      resolveGitExecutable: async () => {
        if (!state.gitConfigured) throw new Error('missing Git');
        return config.gitExecutable;
      },
      setup,
    }
  );
  return {
    root,
    draft,
    writes,
    tools,
    state,
    config,
    abort,
    methods,
    ctx: { sessionId: 's', projectRoot: root, signal: abort.signal },
  };
}

test('reports setup readiness and exposes install only to the sidebar', async (t) => {
  const calls = [];
  const discovered = {
    nodeAvailable: true,
    cliAvailable: false,
    gitAvailable: true,
    canInstall: true,
  };
  const f = await fixture(t, {
    resolveConfig: async (root) => {
      calls.push(['resolve', root]);
      return {};
    },
    inspect: async (root) => {
      calls.push(['inspect', root]);
      return { ...discovered };
    },
    install: async (root, signal) => {
      calls.push(['install', root, signal]);
      return { installed: true };
    },
  });
  const { methods, tools, ctx, root, abort } = f;
  f.state.configured = false;
  const status = await methods.get('inspect')({}, ctx);
  assert.deepEqual(status.setup, discovered);
  assert.equal(status.configured, false);
  assert.deepEqual(calls, [
    ['resolve', root],
    ['inspect', root],
  ]);
  assert.ok(!tools.has('install_cli'));
  const install = methods.get('install_cli');
  await assert.rejects(install({ package: 'unexpected-package' }, ctx), /不接受参数/);
  f.state.gesture = false;
  await assert.rejects(install({}, ctx), /GESTURE_REQUIRED/);
  f.state.gesture = true;
  assert.deepEqual(await install({}, ctx), { installed: true });
  assert.deepEqual(calls.at(-1), ['install', root, ctx.signal]);
  abort.abort();
  await assert.rejects(install({}, ctx), /取消/);
  assert.equal(calls.filter(([method]) => method === 'install').length, 1);
});

test('detects uninitialized worktrees without creating files or disclosing machine paths to the panel', async (t) => {
  const { methods, ctx, state, root } = await fixture(t);
  const inspect = methods.get('inspect');
  assert.deepEqual(await inspect({}, ctx), {
    state: 'missing',
    configured: true,
    gitConfigured: true,
  });
  assert.deepEqual(await readdir(root), []);
  await mkdir(join(root, 'llmdoc'));
  state.configured = false;
  assert.deepEqual(await inspect({}, ctx), {
    state: 'present',
    configured: false,
    gitConfigured: true,
    configurationError: 'missing CLI',
  });
  state.configured = true;
  state.gitConfigured = false;
  assert.deepEqual(await inspect({}, ctx), {
    state: 'present',
    configured: true,
    gitConfigured: false,
    gitConfigurationError: 'missing Git',
  });
  await assert.rejects(inspect({}, { ...ctx, sessionId: null }), /not a Code project/);
});

test('prepares a review request only, never sends or writes workspace files', async (t) => {
  const { methods, ctx, writes, root } = await fixture(t);
  const prepare = methods.get('prepare_workflow');
  assert.deepEqual(await prepare({ action: 'init' }, ctx), { prepared: true });
  assert.deepEqual(await readdir(root), []);
  assert.deepEqual(writes[0].expect, { generation: 'd1', rev: 'r1' });
  assert.match(writes[0].text, /llmdoc-maintenance.*init/);
  assert.match(writes[0].text, /确认前.*不写.*提交/);
  await mkdir(join(root, 'llmdoc'));
  await assert.rejects(prepare({ action: 'init' }, ctx), /已有 llmdoc/);
  for (const action of ['update', 'prune']) {
    assert.deepEqual(await prepare({ action }, ctx), { prepared: true });
    assert.match(writes.at(-1).text, new RegExp(`llmdoc-maintenance.*${action}`));
  }
  assert.deepEqual(await readdir(join(root, 'llmdoc')), []);
});

test('rejects invalid, unconfigured, cancelled, or conflicting drafts before changing them', async (t) => {
  const { methods, ctx, draft, state, writes, abort } = await fixture(t);
  const prepare = methods.get('prepare_workflow');
  for (const bad of [
    { action: 'upgrade' },
    { action: 'init', root: '/tmp' },
    { action: 'commit' },
  ]) {
    await assert.rejects(prepare(bad, ctx), /无效/);
  }
  await assert.rejects(prepare({ action: 'prune' }, ctx), /没有 llmdoc/);
  state.configured = false;
  await assert.rejects(prepare({ action: 'init' }, ctx), /missing CLI/);
  state.configured = true;
  draft.text = '请先修这个错';
  await assert.rejects(prepare({ action: 'init' }, ctx), /现有草稿/);
  draft.text = '';
  draft.hasReferences = true;
  await assert.rejects(prepare({ action: 'init' }, ctx), /现有草稿/);
  draft.hasReferences = false;
  abort.abort();
  await assert.rejects(prepare({ action: 'init' }, ctx), /取消/);
  assert.deepEqual(writes, []);
});

test('does not read symlinked vaults or reveal arbitrary config to the agent', async (t) => {
  const { methods, tools, ctx, root, config } = await fixture(t);
  const target = join(root, 'other');
  await mkdir(target);
  await symlink(target, join(root, 'llmdoc'), 'junction');
  await assert.rejects(methods.get('inspect')({}, ctx), /普通目录/);
  await rm(join(root, 'llmdoc'));
  const runtime = tools.get('runtime');
  assert.deepEqual(JSON.parse((await runtime({}, ctx)).content), {
    state: 'missing',
    projectRoot: root,
    nodeExecutable: config.nodeExecutable,
    cliEntry: config.cliEntry,
    gitExecutable: config.gitExecutable,
  });
  await assert.rejects(runtime({ command: 'commit' }, ctx), /不接受参数/);
});
