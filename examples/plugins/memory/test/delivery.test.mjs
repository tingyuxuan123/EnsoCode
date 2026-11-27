import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { activate } from '../main.mjs';

const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';
async function fixture(t, inject = async () => null) {
  const dataDir = await mkdtemp(join(tmpdir(), 'memory-delivery-'));
  t.after(() => rm(dataDir, { force: true, recursive: true }));
  const methods = new Map(),
    copied = [],
    injections = [];
  const ctx = { projectRoot: '/project/a', sessionId: null };
  await activate({
    dataDir,
    tools: { register() {} },
    events: { on() {} },
    commands: { register() {} },
    config: { get: async () => ({}) },
    renderer: { handle: (name, handler) => methods.set(name, handler) },
    ui: {
      view: { emit: async () => {} },
      notify: async () => {},
      clipboard: { writeText: async (text) => void copied.push(text) },
    },
    session: {
      list: async (args) => {
        assert.equal(args.scope, 'workspace');
        return { current: null, sessions: [{ id: 'session-a', title: 'A会话', state: 'idle' }] };
      },
      inject: async (input) => {
        injections.push(input);
        return inject(input);
      },
    },
  });
  const call = (method, args = {}, context = ctx) => methods.get(method)(args, context);
  const state = async () => (await call('scratchpad', { action: 'list' })).items[0];
  const { added } = await call('scratchpad', { action: 'add', text: '执行这个待办' });
  return { call, state, id: added.id, copied, injections, ctx };
}

test('copy is only copy; a confirmed session delivery carries original images and starts the todo', async (t) => {
  const f = await fixture(t);
  await f.call('copy_todo', { id: f.id });
  assert.equal((await f.state()).status, 'todo');
  const image = await f.call('attachment_save', { data: PNG, thumb: PNG });
  await f.call('scratchpad', { action: 'edit', id: f.id, text: '带图执行', images: [image.id] });
  const result = await f.call('send_todo', {
    id: f.id,
    sessionId: 'session-a',
    deliveryId: 'send-1',
  });
  assert.equal(result.ok, true);
  assert.equal((await f.state()).status, 'doing');
  assert.equal(f.injections[0].sameWorkspace, true);
  assert.equal(f.injections[0].triggerTurn, true);
  assert.equal(f.injections[0].images[0].data, PNG);
  assert.match(f.injections[0].text, /action=done/);
  assert.match(f.injections[0].text, new RegExp(f.id));
});

test('no optimistic doing, duplicate clicks share one delivery, and late ACK never overwrites completion', async (t) => {
  let accept;
  let reached;
  const started = new Promise((resolve) => {
    reached = resolve;
  });
  const f = await fixture(
    t,
    () =>
      new Promise((resolve) => {
        accept = resolve;
        reached();
      })
  );
  const args = { id: f.id, sessionId: 'session-a', deliveryId: 'send-2' };
  const one = f.call('send_todo', args),
    two = f.call('send_todo', args);
  await started;
  assert.equal(f.injections.length, 1);
  assert.equal((await f.state()).status, 'todo');
  await f.call('scratchpad', { action: 'done', id: f.id });
  accept(null);
  await Promise.all([one, two]);
  assert.equal((await f.state()).status, 'done');
  await f.call('send_todo', args);
  assert.equal(f.injections.length, 1);
});

test('failed, foreign, global-without-project and over-limit sends never mark work in progress', async (t) => {
  const f = await fixture(t, async () => {
    throw new Error('worker refused delivery');
  });
  await assert.rejects(
    f.call('send_todo', { id: f.id, sessionId: 'session-a', deliveryId: 'failed' }),
    /refused/
  );
  assert.equal((await f.state()).status, 'todo');
  const count = f.injections.length;
  await assert.rejects(
    f.call('send_todo', { id: f.id, sessionId: 'foreign', deliveryId: 'foreign' })
  );
  await assert.rejects(
    f.call(
      'send_todo',
      { id: f.id, sessionId: 'session-a', deliveryId: 'global' },
      { projectRoot: null, sessionId: null }
    )
  );
  const ids = [];
  for (let i = 0; i < 5; i++) ids.push((await f.call('attachment_save', { data: PNG })).id);
  await f.call('scratchpad', { action: 'edit', id: f.id, text: '五张图', images: ids });
  await assert.rejects(
    f.call('send_todo', { id: f.id, sessionId: 'session-a', deliveryId: 'too-many' }),
    /4/
  );
  assert.equal(f.injections.length, count);
  assert.equal((await f.state()).status, 'todo');
  assert.equal((await f.state()).images.length, 5);
});
