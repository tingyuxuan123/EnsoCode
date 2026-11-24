import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { registerLookupNudge } from '../events.mjs';

async function fixture(
  t,
  { hasKnowledge = true, review = async () => ({ impacted: 0, needsReview: 0, unmapped: 0 }) } = {}
) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'llmdoc-nudge-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const project = join(root, 'project');
  const data = join(root, 'data');
  await Promise.all([mkdir(project), mkdir(data)]);
  if (hasKnowledge) await mkdir(join(project, 'llmdoc'));
  const handlers = new Map();
  const notices = [];
  const injections = [];
  registerLookupNudge(
    {
      events: { on: (name, handler) => handlers.set(name, handler) },
      session: {
        inject: async (input) => {
          injections.push(input);
          return null;
        },
      },
      ui: { notify: () => notices.push('notify') },
    },
    {
      projectRoot: (ctx) => ctx?.projectRoot,
      dataDir: data,
      ready: async () => ({ nodeExecutable: 'node', cliEntry: 'cli', gitExecutable: 'git' }),
      review,
    }
  );
  return {
    project,
    handlers,
    notices,
    injections,
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
  assert.match(result.append, /硬性前置/);
  assert.match(result.append, /第一条工具调用/);
  assert.match(result.append, /即使只是解释/);
  assert.match(result.append, /回源码核对/);
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

test('adds one llmdoc reminder to the first source tool result in a turn', async (t) => {
  const f = await fixture(t);
  const ctx = { sessionId: 's1', projectRoot: f.project };
  await f.run(ctx);
  const reminder = await f.handlers.get('tool_result')(
    { toolName: 'bash', content: 'grep output' },
    ctx
  );
  assert.match(reminder.content, /plugin_codekiln-llmdoc__search/);
  assert.match(reminder.content, /grep output$/);
  assert.equal(
    await f.handlers.get('tool_result')({ toolName: 'bash', content: 'again' }, ctx),
    undefined
  );
});

test('does not remind after an llmdoc tool or in child sessions', async (t) => {
  const f = await fixture(t);
  const ctx = { sessionId: 's1', projectRoot: f.project };
  await f.run(ctx);
  assert.equal(
    await f.handlers.get('tool_result')(
      { toolName: 'plugin_codekiln-llmdoc__search', content: '[]' },
      ctx
    ),
    undefined
  );
  assert.equal(
    await f.handlers.get('tool_result')(
      { toolName: 'bash', content: 'x' },
      { ...ctx, agent: { sessionId: 'child' } }
    ),
    undefined
  );
});

test('appends one review reminder after a turn with pending knowledge work', async (t) => {
  const f = await fixture(t, {
    review: async () => ({ impacted: 1, needsReview: 1, unmapped: 2 }),
  });
  const ctx = { sessionId: 's1', projectRoot: f.project };
  await f.handlers.get('agent_end')({}, ctx);
  assert.equal(f.injections.length, 1);
  assert.match(f.injections[0].text, /1 篇文档受影响/);
  assert.match(f.injections[0].text, /1 篇待复核/);
  assert.match(f.injections[0].text, /2 个源码路径未映射/);
  assert.equal(f.injections[0].deliverAs, 'followUp');
  assert.equal(f.injections[0].triggerTurn, false);
  await f.handlers.get('agent_end')({}, ctx);
  assert.equal(f.injections.length, 1);
});

test('stays silent after a clean turn or in a child session', async (t) => {
  const f = await fixture(t);
  const ctx = { sessionId: 's1', projectRoot: f.project };
  await f.handlers.get('agent_end')({}, ctx);
  assert.equal(f.injections.length, 0);
  const dirty = await fixture(t, {
    review: async () => ({ impacted: 1, needsReview: 0, unmapped: 0 }),
  });
  await dirty.handlers.get('agent_end')({}, { ...ctx, agent: { sessionId: 'child' } });
  assert.equal(dirty.injections.length, 0);
});
