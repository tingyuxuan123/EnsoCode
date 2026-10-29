import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import {
  connect,
  fetchJson,
  parseArgs,
  selectPage,
  waitUntil,
} from '../.agents/skills/enso-cdp/scripts/cdp-core.mjs';
import {
  browserPid,
  click,
  domReady,
  ensureFocus,
} from '../.agents/skills/enso-cdp/scripts/cdp-input.mjs';
import { sessionAction } from '../.agents/skills/enso-cdp/scripts/cdp-session.mjs';

test('arguments preserve text/options anywhere and validate command arity/port/timeout/seq', () => {
  const args = parseArgs(
    [
      'session-send',
      's',
      'hello -- world',
      '--page',
      'index.html',
      '--model-id',
      'm',
      '--provider-id',
      'p',
    ],
    { ENSO_CDP_PORT: '9333' }
  );
  assert.deepEqual(args.rest, ['s', 'hello -- world']);
  assert.equal(args.providerId, 'p');
  assert.equal(args.port, 9333);
  for (const port of ['0', '65536', 'abc', '9333/path', '-1', '1.2']) {
    assert.throws(() => parseArgs(['pages'], { ENSO_CDP_PORT: port }), /PORT/);
  }
  for (const argv of [
    [],
    ['wat'],
    ['eval'],
    ['click'],
    ['session-send', 's'],
    ['ready', '--timeout', '0'],
    ['session-wait', 's', '--after-seq', '-1'],
    ['click', 'a', '--button', 'middle'],
    ['session-send', 's', 'x', '--provider-id', 'p'],
    ['ready', '--page'],
  ]) {
    assert.throws(() => parseArgs(argv, {}));
  }
});

test('default profile session mutations fail closed; reads and explicit unlock work', () => {
  for (const cmd of [
    ['session-new', 'p'],
    ['session-send', 's', 'hi'],
  ]) {
    assert.throws(() => parseArgs(cmd, {}), /DEFAULT_PROFILE/);
    assert.equal(parseArgs([...cmd, '--allow-default-profile'], {}).port, 9222);
    assert.equal(parseArgs(cmd, { ENSO_CDP_PORT: '9333' }).port, 9333);
  }
  assert.equal(parseArgs(['session-read', 's'], {}).port, 9222);
});

test('only a unique matching page target may be selected', () => {
  const page = {
    type: 'page',
    url: 'http://localhost/index.html',
    webSocketDebuggerUrl: 'ws://127.0.0.1:9333/p',
  };
  assert.equal(selectPage([{ ...page, type: 'browser' }, page], 'index.html'), page);
  assert.throws(() => selectPage([{ ...page, type: 'browser' }], 'index.html'), /NO_PAGE/);
  assert.throws(() => selectPage([page, { ...page }], 'index.html'), /AMBIGUOUS/);
});

test('HTTP failures, body stalls, redirects and unreachable CDP are bounded and explained', async () => {
  for (const fetchImpl of [
    async () => {
      throw new Error('refused');
    },
    async () => ({ ok: false, status: 500 }),
    async () => ({
      ok: true,
      json: async () => {
        throw new Error('invalid');
      },
    }),
    async () => new Promise(() => {}),
    async () => ({ ok: true, json: () => new Promise(() => {}) }),
  ]) {
    await assert.rejects(
      fetchJson(9333, '/json/list', { fetchImpl, timeout: 15 }),
      /CDP_UNREACHABLE/
    );
  }
  await fetchJson(9333, '/json/list', {
    fetchImpl: async (url, options) => {
      assert.equal(url, 'http://127.0.0.1:9333/json/list');
      assert.equal(options.redirect, 'error');
      return { ok: true, json: async () => [] };
    },
  });
});

class FakeSocket extends EventEmitter {
  constructor(url) {
    super();
    this.url = url;
    FakeSocket.last = this;
  }
  addEventListener(name, fn) {
    this.on(name, fn);
  }
  send(data) {
    this.sent = JSON.parse(data);
  }
  close() {
    this.closed = true;
    this.emit('close');
  }
}
const openSocket = async () => {
  const promise = connect('ws://127.0.0.1:9333/p', { WebSocketImpl: FakeSocket, timeout: 20 });
  FakeSocket.last.emit('open');
  return promise;
};

test('websocket connect timeout and remote endpoints fail closed', async () => {
  await assert.rejects(
    connect('ws://127.0.0.1:9333/p', { WebSocketImpl: FakeSocket, timeout: 15 }),
    /CONNECT_TIMEOUT/
  );
  assert.equal(FakeSocket.last.closed, true);
  await assert.rejects(
    connect('ws://evil.example:9333/p', { WebSocketImpl: FakeSocket }),
    /LOOPBACK/
  );
});

test('RPC resolves response, rejects protocol errors, deadlines and every pending on disconnect', async () => {
  const rpc = await openSocket();
  const socket = FakeSocket.last;
  const good = rpc.send('Runtime.enable');
  socket.emit('message', { data: JSON.stringify({ id: socket.sent.id, result: { yes: 1 } }) });
  assert.deepEqual(await good, { result: { yes: 1 }, id: socket.sent.id });
  const bad = rpc.send('Bad');
  socket.emit('message', {
    data: JSON.stringify({ id: socket.sent.id, error: { message: 'bad method' } }),
  });
  await assert.rejects(bad, /bad method/);
  await assert.rejects(rpc.send('Stall'), /RPC_TIMEOUT/);
  const one = rpc.send('One');
  const two = rpc.send('Two');
  socket.emit('close');
  await Promise.all([assert.rejects(one, /CLOSED/), assert.rejects(two, /CLOSED/)]);
  await assert.rejects(rpc.send('After'), /CLOSED/);
  rpc.close();
});

test('socket errors reject connect and pending commands', async () => {
  const opening = connect('ws://127.0.0.1:9333/p', { WebSocketImpl: FakeSocket, timeout: 20 });
  FakeSocket.last.emit('error', new Error('oops'));
  await assert.rejects(opening, /ERROR/);
  const rpc = await openSocket();
  const pending = rpc.send('Wait');
  FakeSocket.last.emit('error', new Error('oops'));
  await assert.rejects(pending, /ERROR/);
  const closed = connect('ws://127.0.0.1:9333/p', { WebSocketImpl: FakeSocket, timeout: 20 });
  FakeSocket.last.emit('close');
  await assert.rejects(closed, /CLOSED/);
  await assert.rejects(
    connect('ws://127.0.0.1:9222/p', { WebSocketImpl: FakeSocket, expectedPort: 9333 }),
    /LOOPBACK/
  );
});

test('bounded readiness polling times out rather than hanging on a stalled probe', async () => {
  let count = 0;
  assert.equal(
    await waitUntil(async () => ++count === 3 && 'ready', { timeout: 100, interval: 1 }),
    'ready'
  );
  await assert.rejects(
    waitUntil(() => new Promise(() => {}), { timeout: 15 }),
    /WAIT_TIMEOUT/
  );
});

const fakeWindow = () => {
  const calls = [];
  const settings = {
    projects: [{ id: 'p', path: '/project' }],
    projectGroups: [],
    defaultModel: { providerId: 'pv', modelId: 'm' },
  };
  const state = {
    conversations: { s: { id: 's', projectId: 'p', lastSeq: 4, status: 'idle', messages: [] } },
    send: async (...args) => {
      calls.push(args);
      return null;
    },
    newConversation: async () => 's-new',
  };
  const win = {
    __stores: { sessions: { getState: () => state }, settings: { getState: () => settings } },
    electronAPI: {
      agent: {
        readParentHistoryTail: async (id) => ({ ok: true, messages: [{ text: `disk:${id}` }] }),
        readChildHistory: async (id) => ({
          ok: true,
          source: 'history',
          projection: { records: [`child:${id}`] },
        }),
      },
    },
  };
  const load = async (path) =>
    path.includes('useProviders')
      ? { readMaterializedProviders: () => [{ id: 'pv', enabled: true, models: [{ id: 'm' }] }] }
      : {
          useOauthCredentialStore: { getState: () => ({ snapshot: {} }) },
          usableProvidersForOauthSnapshot: (providers) => providers,
        };
  return { win, calls, settings, state, load };
};

test('session send derives cwd, validates model, uses exact four-argument store contract without secrets', async () => {
  const f = fakeWindow();
  const run = () =>
    sessionAction(f.win, { command: 'session-send', id: 's', text: 'hello' }, f.load);
  const result = await run();
  assert.equal(result.accepted, true);
  assert.equal(result.afterSeq, 4);
  assert.deepEqual(f.calls[0], [
    'hello',
    { providerId: 'pv', modelId: 'm', cwd: '/project' },
    undefined,
    's',
  ]);
  f.state.conversations.s.worktree = { path: '/worktree' };
  await run();
  assert.equal(f.calls[1][1].cwd, '/worktree');
  delete f.state.conversations.s.worktree;
  f.settings.projects[0].path = '';
  assert.equal((await run()).accepted, false);
  assert.equal(f.calls.length, 2);
  f.settings.projects[0].path = '/project';
  assert.equal(
    (
      await sessionAction(
        f.win,
        { command: 'session-send', id: 's', text: 'x', providerId: 'pv', modelId: 'missing' },
        f.load
      )
    ).accepted,
    false
  );
  assert.equal(f.calls.length, 2);
});

test('send refusals/exceptions are accepted:false and never retried', async () => {
  const f = fakeWindow();
  f.state.send = async () => {
    f.calls.push('send');
    return 'spawn failed';
  };
  assert.deepEqual(
    (await sessionAction(f.win, { command: 'session-send', id: 's', text: 'x' }, f.load)).accepted,
    false
  );
  f.state.send = async () => {
    f.calls.push('send');
    throw new Error('lost');
  };
  assert.equal(
    (await sessionAction(f.win, { command: 'session-send', id: 's', text: 'x' }, f.load)).accepted,
    false
  );
  assert.equal(f.calls.length, 2);
});

test('session send never queues into a busy turn or confuses its completion', async () => {
  const f = fakeWindow();
  f.state.conversations.s.status = 'running';
  const result = await sessionAction(
    f.win,
    { command: 'session-send', id: 's', text: 'x' },
    f.load
  );
  assert.equal(result.error, 'SESSION_BUSY');
  assert.equal(f.calls.length, 0);
});

test('cold history is read from Main by ID, never renderer body or arbitrary paths', async () => {
  const f = fakeWindow();
  assert.deepEqual(
    (await sessionAction(f.win, { command: 'session-read', id: 's' })).history.messages,
    [{ text: 'disk:s' }]
  );
  f.state.conversations.s.parentId = 'parent';
  assert.deepEqual(
    (await sessionAction(f.win, { command: 'session-read', id: 's' })).history.projection.records,
    ['child:s']
  );
  assert.equal(
    (await sessionAction(f.win, { command: 'session-read', id: '/tmp/any.jsonl' })).ok,
    false
  );
});

test('session wait needs seq progress AND turn settlement; approvals are not completion', async () => {
  const f = fakeWindow();
  const read = () => sessionAction(f.win, { command: 'session-state', id: 's', afterSeq: 4 });
  assert.equal((await read()).complete, false);
  f.state.conversations.s.lastSeq = 5;
  f.state.conversations.s.spawning = true;
  assert.equal((await read()).complete, false);
  f.state.conversations.s.spawning = false;
  f.state.conversations.s.status = 'running';
  assert.equal((await read()).complete, false);
  f.state.conversations.s.pendingApprovals = [{ id: 'approval' }];
  assert.equal((await read()).waiting, 'approval');
  assert.equal((await read()).complete, false);
  f.state.conversations.s.pendingApprovals = [];
  f.state.conversations.s.status = 'idle';
  assert.equal((await read()).complete, false);
});

test('fast turns are observed before wait, but spawn-ready seq alone never completes a turn', async () => {
  const f = fakeWindow();
  let event;
  f.win.electronAPI.agent.onEvent = (listener) => {
    event = listener;
  };
  await sessionAction(f.win, { command: 'session-send', id: 's', text: 'hi' }, f.load);
  f.state.conversations.s.lastSeq = 5;
  assert.equal((await sessionAction(f.win, { command: 'session-state', id: 's' })).complete, false);
  event({ type: 'status', identity: { sessionId: 's' }, status: 'running', seq: 6 });
  event({ type: 'status', identity: { sessionId: 's' }, status: 'idle', seq: 7 });
  f.state.conversations.s.lastSeq = 7;
  assert.equal((await sessionAction(f.win, { command: 'session-state', id: 's' })).complete, false);
  event({ type: 'turn-completed', identity: { sessionId: 's' }, turnId: 't', seq: 8 });
  f.state.conversations.s.lastSeq = 8;
  assert.equal((await sessionAction(f.win, { command: 'session-state', id: 's' })).complete, true);
  f.state.conversations.s.pendingCapabilityAsks = [{ requestId: 'ask' }];
  const waiting = await sessionAction(f.win, { command: 'session-state', id: 's' });
  assert.equal(waiting.waiting, 'capability-approval');
  assert.equal(waiting.success, false);
});

test('a stale generation completion cannot settle the latest send', async () => {
  const f = fakeWindow();
  let event;
  f.win.electronAPI.agent.onEvent = (listener) => {
    event = listener;
  };
  f.state.conversations.s.generation = 'current';
  await sessionAction(f.win, { command: 'session-send', id: 's', text: 'hi' }, f.load);
  event({
    type: 'status',
    identity: { sessionId: 's', generation: 'current' },
    status: 'running',
    seq: 5,
  });
  event({
    type: 'turn-completed',
    identity: { sessionId: 's', generation: 'stale' },
    turnId: 'old',
    seq: 99,
  });
  f.state.conversations.s.lastSeq = 6;
  assert.equal((await sessionAction(f.win, { command: 'session-state', id: 's' })).complete, false);
});

test('new session rejects unknown projects, and Main history errors do not fall back to renderer messages', async () => {
  const f = fakeWindow();
  assert.equal(
    (await sessionAction(f.win, { command: 'session-new', id: 'missing' })).accepted,
    false
  );
  assert.equal(
    (await sessionAction(f.win, { command: 'session-new', id: 'p' })).sessionId,
    's-new'
  );
  f.state.conversations.s.messages = [{ text: 'stale cache' }];
  f.win.electronAPI.agent.readParentHistoryTail = async () => ({ ok: false, error: 'unavailable' });
  const result = await sessionAction(f.win, { command: 'session-read', id: 's' });
  assert.equal(result.ok, false);
  assert.equal(result.history.error, 'unavailable');
  assert.equal(result.history.messages, undefined);
});

test('DOM readiness requires bridge/stores and optional selector visible/nonzero/enabled', () => {
  const f = fakeWindow();
  let rect = { x: 1, y: 2, width: 0, height: 10 };
  const el = {
    isConnected: true,
    disabled: false,
    getBoundingClientRect: () => rect,
    getClientRects: () => [rect],
    scrollIntoView() {},
  };
  const doc = { readyState: 'complete', querySelectorAll: () => [el] };
  const style = () => ({ display: 'block', visibility: 'visible', opacity: '1' });
  assert.equal(domReady(f.win, doc, style, 'button').ready, false);
  rect = { ...rect, width: 20 };
  assert.equal(domReady(f.win, doc, style, 'button').ready, true);
  el.disabled = true;
  assert.equal(domReady(f.win, doc, style, 'button').ready, false);
  assert.equal(domReady({}, doc, style).ready, false);
  doc.querySelectorAll = () => [el, el];
  assert.throws(() => domReady(f.win, doc, style, 'button'), /AMBIGUOUS/);
});

test('settings window can be DOM-ready without main session stores, but session helpers cannot', () => {
  const win = { electronAPI: { agent: {} } };
  const doc = { readyState: 'complete' };
  assert.equal(domReady(win, doc, () => ({})).ready, true);
  assert.equal(domReady(win, doc, () => ({}), undefined, true).ready, false);
});

test('visible is not focused; activation is PID-only and focus must actually change', async () => {
  assert.equal(
    browserPid({
      result: {
        processInfo: [
          { type: 'renderer', id: 99 },
          { type: 'browser', id: 123 },
        ],
      },
    }),
    123
  );
  for (const processInfo of [
    [],
    [{ type: 'renderer', id: 99 }],
    [
      { type: 'browser', id: 1 },
      { type: 'browser', id: 2 },
    ],
    [{ type: 'browser', id: '123' }],
  ]) {
    assert.equal(browserPid({ result: { processInfo } }), null);
  }
  let focused = false;
  const calls = [];
  const ctx = {
    evaluate: async () => ({ visible: true, focused }),
    send: async (method) => calls.push(method),
    activate: async () => {
      focused = true;
      calls.push('activate-target');
    },
  };
  await ensureFocus(ctx);
  assert.deepEqual(calls, ['Page.bringToFront', 'activate-target']);
  focused = false;
  ctx.activate = async () => {};
  await assert.rejects(ensureFocus(ctx), /MANUAL_FOCUS/);
});

test('click waits for ready box, uses trusted mouse events, and checks focus after clicking', async () => {
  const calls = [];
  let probes = 0;
  const ctx = {
    evaluate: async (expr) =>
      expr.includes('domReady')
        ? ++probes < 2
          ? { ready: false }
          : { ready: true, box: { x: 10, y: 20, width: 20, height: 10 } }
        : { visible: true, focused: true },
    send: async (method, params) => calls.push([method, params]),
  };
  await click(ctx, 'button', { button: 'right', timeout: 100, interval: 1 });
  const mouse = calls.filter(([method]) => method === 'Input.dispatchMouseEvent');
  assert.deepEqual(
    mouse.map(([, p]) => p.type),
    ['mouseMoved', 'mousePressed', 'mouseReleased']
  );
  assert.equal(mouse[1][1].button, 'right');
  assert.equal(mouse[1][1].x, 20);
});

test('click refuses to report success if focus is lost after real input', async () => {
  let sent = false;
  const ctx = {
    evaluate: async (expr) =>
      expr.includes('domReady')
        ? { ready: true, box: { x: 0, y: 0, width: 10, height: 10 } }
        : { visible: true, focused: !sent },
    send: async (method, params) => {
      if (method === 'Input.dispatchMouseEvent' && params.type === 'mouseReleased') sent = true;
    },
  };
  await assert.rejects(click(ctx, 'button'), /MANUAL_FOCUS/);
});
