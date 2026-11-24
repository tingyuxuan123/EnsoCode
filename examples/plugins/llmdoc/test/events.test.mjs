import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { registerLookupNudge } from '../events.mjs';

async function fixture(t, { hasKnowledge = true } = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'llmdoc-nudge-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const project = join(root, 'project');
  const data = join(root, 'data');
  await Promise.all([mkdir(project), mkdir(data)]);
  if (hasKnowledge) await mkdir(join(project, 'llmdoc'));
  const handlers = new Map();
  const notices = [];
  registerLookupNudge(
    {
      events: { on: (name, handler) => handlers.set(name, handler) },
      ui: { notify: () => notices.push('notify') },
    },
    {
      projectRoot: (ctx) => ctx?.projectRoot,
      dataDir: data,
      ready: async () => ({ nodeExecutable: 'node', cliEntry: 'cli', gitExecutable: 'git' }),
    }
  );
  return {
    project,
    handlers,
    notices,
    run: (ctx, prompt = '改 pages/pagesBuyer/orderList/orderList 这个文案') =>
      handlers.get('before_agent_start')({ prompt, kind: 'user' }, ctx),
  };
}

const ctx = (project) => ({ sessionId: 's1', projectRoot: project });

test('nudges a configured local project to consult llmdoc before changing code', async (t) => {
  const f = await fixture(t);
  const result = await f.run(ctx(f.project));
  assert.match(result.append, /plugin_codekiln-llmdoc__context/);
  assert.match(result.append, /pages\/pagesBuyer\/orderList/);
  assert.match(result.append, /search/);
  assert.match(result.append, /源码核对/);
  assert.match(result.append, /不会.*更新知识库/);
  assert.ok(result.append.length < 1400);
  assert.deepEqual(f.notices, []);
});

test('says nothing for non-Code, missing-vault, unfinished-setup, or non-user turns', async (t) => {
  const configured = await fixture(t);
  assert.equal(await configured.run({ sessionId: 's', projectRoot: null }), undefined);
  assert.equal(await configured.run(ctx(configured.project), ''), undefined);
  assert.equal(await configured.run({ ...ctx(configured.project), caller: 'plugin' }), undefined);
  const empty = await fixture(t, { hasKnowledge: false });
  assert.equal(await empty.run(ctx(empty.project)), undefined);
  const pending = await fixture(t);
  pending.handlers.clear();
  registerLookupNudge(
    { events: { on: (name, handler) => pending.handlers.set(name, handler) } },
    {
      projectRoot: (c) => c?.projectRoot,
      dataDir: pending.project,
      ready: async () => {
        throw new Error('unconfigured');
      },
    }
  );
  assert.equal(
    await pending.handlers.get('before_agent_start')(
      { prompt: 'x', kind: 'user' },
      ctx(pending.project)
    ),
    undefined
  );
});

test('a failed or slow lookup setup never delays or breaks the turn', async (t) => {
  const f = await fixture(t);
  f.handlers.clear();
  let called = false;
  registerLookupNudge(
    { events: { on: (name, handler) => f.handlers.set(name, handler) } },
    {
      projectRoot: (c) => c?.projectRoot,
      dataDir: f.project,
      ready: () => {
        called = true;
        return new Promise(() => {});
      },
      timeoutMs: 20,
    }
  );
  const started = Date.now();
  assert.equal(
    await f.handlers.get('before_agent_start')({ prompt: 'x', kind: 'user' }, ctx(f.project)),
    undefined
  );
  assert.ok(called);
  assert.ok(Date.now() - started < 400);
});
