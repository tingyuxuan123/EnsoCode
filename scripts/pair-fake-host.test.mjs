import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const script = fileURLToPath(new URL('./pair-fake-host.mjs', import.meta.url));
const goDirectory = fileURLToPath(new URL('../packages/relay-go/', import.meta.url));

function capture(command, args) {
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let output = '';
  let errors = '';
  const exited = once(child, 'close');
  // Register a rejection handler even if spawn fails before the test starts waiting.
  void exited.catch(() => {});
  child.stdout.setEncoding('utf8').on('data', (chunk) => (output += chunk));
  child.stderr.setEncoding('utf8').on('data', (chunk) => (errors += chunk));
  return {
    exited,
    output: () => output,
    errors: () => errors,
    async stop() {
      if (child.exitCode === null && child.signalCode === null) child.kill();
      await exited;
    },
  };
}

async function waitFor(check, label, budget = 5_000) {
  const deadline = performance.now() + budget;
  do {
    const found = check();
    if (found !== undefined) return found;
    await delay(15);
  } while (performance.now() < deadline);
  assert.fail(`没有收到 ${label}`);
}

async function listen(t, handler) {
  const server = createServer(handler).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

test('拒绝非 loopback、路径、凭据和超出中继有效期的邀请参数', async () => {
  for (const args of [
    ['--relay', 'https://relay.yfdl.site'],
    ['--relay', 'http://localhost.evil.test:8787'],
    ['--relay', 'http://127.0.0.1:8787/elsewhere'],
    ['--relay', 'http://hidden:secret@localhost:8787'],
    ['--relay', 'http://127.0.0.1:8787/?token=secret'],
    ['--pair-timeout', '60'],
  ]) {
    const host = capture(process.execPath, [script, ...args]);
    assert.equal((await host.exited)[0], 1);
    assert.match(host.errors(), /loopback|pair-timeout/);
    assert.equal(host.errors().includes('secret'), false);
    assert.equal(host.output(), '');
  }
});

test('握手不跟随重定向，且不打印中继返回的内容', { timeout: 5_000 }, async (t) => {
  let followed = false;
  const target = await listen(t, (_request, response) => {
    followed = true;
    response.end(JSON.stringify({ error: 'secret' }));
  });
  const relay = await listen(t, (_request, response) => {
    response.writeHead(307, { location: target });
    response.end();
  });
  const host = capture(process.execPath, [script, '--relay', relay]);
  t.after(() => host.stop());
  assert.equal((await host.exited)[0], 1);
  assert.match(host.errors(), /register|registration/i);
  assert.equal(followed, false);
  assert.equal(host.errors().includes('secret'), false);
});

test('无人认领时，配对轮询有界并退出', { timeout: 6_000 }, async (t) => {
  let requests = 0;
  const relay = await listen(t, (_request, response) => {
    requests++;
    response.end(JSON.stringify({ state: 'requested' }));
  });
  const host = capture(process.execPath, [script, '--relay', relay, '--pair-timeout', '1']);
  t.after(() => host.stop());
  assert.equal((await host.exited)[0], 1);
  assert.match(host.output(), /Pair link: http:\/\/127\.0\.0\.1:\d+\/#relay=.*&pk=/);
  assert.match(host.errors(), /timed out/);
  assert.ok(requests >= 2 && requests <= 5);
});

test('配对截止会中止正在等待的 HTTP 请求', { timeout: 6_000 }, async (t) => {
  let polls = 0;
  let closed = false;
  const relay = await listen(t, (_request, response) => {
    if (++polls === 1) response.end(JSON.stringify({ state: 'requested' }));
    else
      response.once('close', () => {
        closed = true;
      });
  });
  const host = capture(process.execPath, [script, '--relay', relay, '--pair-timeout', '1']);
  t.after(() => host.stop());
  assert.equal((await host.exited)[0], 1);
  assert.match(host.errors(), /timed out/);
  assert.equal(polls, 2);
  await waitFor(() => (closed ? true : undefined), '被中止的轮询连接');
});

test('经 Go 中继真实扫码、认证、同步、回复审批和提问，并完成或失败', {
  skip: process.env.PAIR_FAKE_HOST_GO === '1' ? false : 'set PAIR_FAKE_HOST_GO=1 with Go on PATH',
  timeout: 240_000,
}, async () => {
  const { loadPair } = await import('./pair-fake-host.mjs');
  const pair = await loadPair();
  const directory = await mkdtemp(join(tmpdir(), 'enso-pair-fake-host-'));
  const binary = join(directory, process.platform === 'win32' ? 'relay.exe' : 'relay');
  let relay;
  let host;
  let socket;
  try {
    await exec('go', ['build', '-o', binary, '.'], { cwd: goDirectory, timeout: 180_000 });
    relay = capture(binary, [
      '-listen',
      '127.0.0.1:0',
      '-db',
      join(directory, 'relay.sqlite'),
      '-auto-update=false',
    ]);
    const relayUrl = await waitFor(
      () => relay.output().match(/http:\/\/127\.0\.0\.1:\d+/)?.[0],
      '中继监听地址'
    );
    host = capture(process.execPath, [script, '--relay', relayUrl]);
    const link = await waitFor(
      () => host.output().match(/^Pair link: (\S+)\r?$/m)?.[1],
      '配对链接'
    );
    const invite = pair.parsePairUri(link);
    assert.equal(invite.relay, relayUrl);
    const { pairId, deviceToken, contentKey } = await pair.claimPairing(
      relayUrl,
      invite.publicKey,
      'Fixture guest'
    );
    socket = new WebSocket(
      `${pair.toWebSocketUrl(relayUrl)}/v1/pair/${encodeURIComponent(pairId)}?role=guest&token=${encodeURIComponent(deviceToken)}`
    );
    socket.binaryType = 'arraybuffer';
    const replay = pair.createFrameReplay(undefined, undefined, {
      role: 'guest',
      requireModern: true,
    });
    let received = Promise.resolve();
    const frames = [];
    const controls = [];
    socket.addEventListener('message', ({ data }) => {
      if (typeof data === 'string') {
        if (data !== 'pong') controls.push(JSON.parse(data).type);
        return;
      }
      received = received.then(async () => {
        const opened = await replay.open(contentKey, new Uint8Array(data));
        if (opened) frames.push(opened);
      });
    });
    const take = (check, label) =>
      waitFor(() => {
        const index = frames.findIndex(check);
        return index < 0 ? undefined : frames.splice(index, 1)[0].payload;
      }, label);
    const live = (type) =>
      take(
        ({ payload, trusted }) =>
          trusted && payload.type === 'agent-event' && payload.event.type === type,
        type
      );
    const send = async (payload) => socket.send(await replay.seal(contentKey, payload));
    await waitFor(() => (controls.includes('host-online') ? true : undefined), 'host-online');

    // Use a new guest prefix that has not opened the host's challenge, plus an unstamped action.
    const untrusted = pair.createFrameReplay(undefined, undefined, {
      role: 'guest',
      requireModern: true,
    });
    const sessionId = (await take(({ payload }) => payload.type === 'catalog', 'catalog'))
      .entries[0].id;
    socket.send(
      await untrusted.seal(contentKey, { type: 'prompt', sessionId, text: 'untrusted action' })
    );
    socket.send(
      await pair.sealFrame(contentKey, { type: 'prompt', sessionId, text: 'legacy action' })
    );
    socket.send(new Uint8Array(42));
    await send({ type: 'replay-hello' });
    await waitFor(() => (replay.isReady() ? true : undefined), 'authenticated host replay');
    await send({ type: 'replay-hello' });
    await send({ type: 'unknown-fixture-command' });
    await send({ type: 'subscribe', sessionId, sync: { requestId: 'fixture-snapshot' } });
    const initial = pair.parsePairSessionSync(
      await take(
        ({ payload, trusted }) =>
          trusted && payload.type === 'session-sync' && payload.requestId === 'fixture-snapshot',
        'session-sync snapshot'
      )
    );
    assert.equal(initial?.mode, 'snapshot');
    assert.ok(initial.snapshot.sessions[0].messages.length > 0);
    assert.equal(JSON.stringify(initial.snapshot).includes('action'), false);

    const first = await live('message-upsert');
    const stream = await live('message-upsert');
    const streamEnd = await live('message-upsert');
    assert.equal(first.event.message.role, 'user');
    assert.equal(stream.event.message.role, 'assistant');
    assert.equal(streamEnd.event.index, stream.event.index);
    assert.notEqual(streamEnd.event.message.content[0].text, stream.event.message.content[0].text);
    assert.ok(stream.cursor.seq > initial.cursor.seq);
    const approval = await live('approval-request');
    await take(
      ({ payload, trusted }) =>
        trusted && payload.type === 'catalog' && payload.entries[0].pendingApprovalCount === 1,
      'catalog approval count'
    );
    await send({
      type: 'subscribe',
      sessionId,
      sync: { requestId: 'fixture-replay', cursor: initial.cursor },
    });
    const delta = pair.parsePairSessionSync(
      await take(
        ({ payload, trusted }) =>
          trusted && payload.type === 'session-sync' && payload.requestId === 'fixture-replay',
        'session-sync replay'
      )
    );
    assert.equal(delta?.mode, 'replay');
    assert.equal(delta.fromSeq, initial.cursor.seq);
    assert.ok(delta.events.some((event) => event.type === 'approval-request'));
    await send({
      type: 'approval-respond',
      sessionId,
      requestId: approval.event.request.requestId,
      decision: 'allow',
    });
    await live('approval-resolved');
    assert.equal(
      (await live('message-upsert')).event.message.toolCallId,
      approval.event.request.toolCallId
    );
    const ask = await live('ask-request');
    await take(
      ({ payload, trusted }) =>
        trusted && payload.type === 'catalog' && payload.entries[0].pendingAskCount === 1,
      'catalog ask count'
    );
    await send({
      type: 'ask-respond',
      sessionId,
      requestId: ask.event.ask.requestId,
      answer: ask.event.ask.options[0],
    });
    await live('ask-resolved');
    await live('turn-completed');
    await send({ type: 'prompt', sessionId, text: '/fail' });
    assert.match((await live('turn-failed')).event.error, /fixture/i);

    await pair.revokePairing(relayUrl, pairId, deviceToken);
    await waitFor(
      () => (socket.readyState === WebSocket.CLOSED ? true : undefined),
      'guest socket close'
    );
    let exitCode;
    void host.exited.then(([code]) => {
      exitCode = code;
    });
    assert.equal(await waitFor(() => exitCode, 'host process exit'), 0);
    const logs = host.output() + host.errors();
    assert.equal(logs.includes(deviceToken) || logs.includes(pair.toBase64Url(contentKey)), false);
  } finally {
    socket?.close();
    await host?.stop();
    await relay?.stop();
    await rm(directory, { recursive: true, force: true });
  }
});
