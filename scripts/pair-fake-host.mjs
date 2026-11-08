/** Node >=22.22: node scripts/pair-fake-host.mjs --help */
import { registerHooks } from 'node:module';
import { extname } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { createFixture } from './pair-fake-host-fixture.mjs';

const DEFAULT_RELAY = 'http://127.0.0.1:8787';
// Go recreates an expired request on the next poll. Stop before its 60 s TTL.
const MAX_PAIR_SECONDS = 55;
const MAX_FRAME_BYTES = 1_048_576;

class FixtureError extends Error {}

/** Use native TS stripping, filling only pair's extensionless relative imports. */
export async function loadPair() {
  const source = new URL('../packages/pair/src/', import.meta.url);
  const hook = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (
        context.parentURL?.startsWith(source.href) &&
        specifier.startsWith('.') &&
        !extname(specifier)
      ) {
        return nextResolve(`${specifier}.ts`, context);
      }
      return nextResolve(specifier, context);
    },
  });
  try {
    // The barrel also loads direct/link.ts, which uses a TS parameter property.
    // Only load the shared modules needed by the relay fixture.
    const modules = await Promise.all(
      [
        'crypto',
        'encoding',
        'handshake',
        'heartbeat',
        'protocol',
        'relay',
        'replay',
        'revive',
        'sessionSync',
      ].map((name) => import(new URL(`${name}.ts`, source).href))
    );
    return Object.assign({}, ...modules);
  } finally {
    hook.deregister();
  }
}

function options() {
  let values;
  try {
    ({ values } = parseArgs({
      options: {
        relay: { type: 'string', default: DEFAULT_RELAY },
        'pair-timeout': { type: 'string', default: String(MAX_PAIR_SECONDS) },
        help: { type: 'boolean', short: 'h' },
      },
    }));
  } catch {
    throw new FixtureError('Invalid arguments. See --help.');
  }
  if (values.help) return null;
  let relay;
  try {
    if (!/^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?\/?$/i.test(values.relay))
      throw new Error();
    relay = new URL(values.relay);
  } catch {
    throw new FixtureError(
      'Expected a loopback HTTP(S) origin with no credentials, path, or parameters.'
    );
  }
  const timeout = Number(values['pair-timeout']);
  if (!/^\d+$/.test(values['pair-timeout']) || timeout < 1 || timeout > MAX_PAIR_SECONDS) {
    throw new FixtureError(
      `--pair-timeout must be an integer from 1 to ${MAX_PAIR_SECONDS} seconds.`
    );
  }
  return { relayUrl: relay.origin, timeoutMs: timeout * 1_000 };
}

async function registerAndClaim(pair, relayUrl, timeoutMs, stopping) {
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), timeoutMs);
  const signal = AbortSignal.any([deadline.signal, stopping]);
  const originalFetch = globalThis.fetch;
  // The shared handshake owns fetch/retries; in this standalone CLI, constrain all
  // of its attempts to our deadline and never let a local HTTP redirect escape it.
  globalThis.fetch = (input, init) =>
    originalFetch(input, {
      ...init,
      redirect: 'error',
      signal: init?.signal ? AbortSignal.any([signal, init.signal]) : signal,
    });
  let session;
  try {
    session = await pair.startHostPairing(relayUrl);
    signal.throwIfAborted();
    const link = pair.buildPairLink({
      relay: relayUrl,
      publicKey: pair.fromBase64Url(session.publicKeyB64),
    });
    console.log(`Pair link: ${link}`);
    if (process.stdout.isTTY) {
      try {
        const { default: qr } = await import('qrcode');
        console.log(await qr.toString(link, { type: 'terminal', small: true }));
      } catch {
        // The link is enough to pair if the optional terminal renderer is unavailable.
      }
    }
    while (!signal.aborted) {
      const result = await pair.pollHostPairing(session);
      signal.throwIfAborted();
      if (result) return result;
      await delay(350, undefined, { signal });
    }
    signal.throwIfAborted();
  } catch {
    if (stopping.aborted) return null;
    if (deadline.signal.aborted)
      throw new FixtureError('Pairing timed out. Run again for a fresh invite.');
    throw new FixtureError(
      session
        ? 'Pairing could not be completed.'
        : 'Could not register pairing with the local relay.'
    );
  } finally {
    session?.secretKey.fill(0);
    clearTimeout(timer);
    globalThis.fetch = originalFetch;
  }
}

function runSocket(pair, relayUrl, { pairId, hostToken, contentKey }, stopping) {
  const endpoint = `${pair.toWebSocketUrl(relayUrl)}/v1/pair/${encodeURIComponent(pairId)}?role=host&token=${encodeURIComponent(hostToken)}`;
  const ws = new WebSocket(endpoint);
  ws.binaryType = 'arraybuffer';
  const replay = pair.createFrameReplay(undefined, undefined, {
    role: 'host',
    requireModern: true,
  });
  return new Promise((resolve, reject) => {
    let done = false;
    let peerOnline = false;
    let peerGeneration = 0;
    let outgoing = Promise.resolve();
    let incoming = Promise.resolve();
    let forceExit;

    const finish = (error) => {
      if (done) return;
      done = true;
      heartbeat.stop();
      fixture.stop();
      clearTimeout(connectTimer);
      stopping.removeEventListener('abort', stop);
      ws.removeEventListener('open', onOpen);
      ws.removeEventListener('message', onMessage);
      ws.removeEventListener('error', onError);
      if (ws.readyState !== WebSocket.CLOSED) {
        // Native WebSocket has no terminate(). Bound exit even for half-open TCP.
        forceExit = setTimeout(() => process.exit(process.exitCode ?? 0), 1_000).unref();
        ws.close();
      }
      if (error) reject(new FixtureError(error));
      else resolve();
    };
    const stop = () => finish();
    const onError = () => finish('Could not use the local relay WebSocket.');
    const onOpen = () => {
      clearTimeout(connectTimer);
      console.log(
        'Fake host connected. Open the demo session to start the fixture; send /fail for an error.'
      );
    };

    function send(message) {
      const generation = peerGeneration;
      const current = () =>
        !done && peerOnline && peerGeneration === generation && ws.readyState === WebSocket.OPEN;
      outgoing = outgoing
        .then(async () => {
          if (!current()) return;
          const frame = await replay.seal(contentKey, message);
          if (current() && frame.byteLength <= MAX_FRAME_BYTES) ws.send(frame);
        })
        .catch(() => {
          if (current()) finish('Could not send a fixture frame.');
        });
    }

    const fixture = createFixture(send, pair.isPairSyncCursor);
    function sendHello() {
      if (replay.takeHello()) send({ type: 'replay-hello' });
    }

    function onMessage({ data }) {
      if (typeof data === 'string') {
        let control;
        try {
          control = JSON.parse(data)?.type;
        } catch {
          return; // pong or unknown relay text
        }
        if (control === 'revoked') return stop();
        if (control === 'peer-joined' || control === 'peer-left') {
          peerGeneration++;
          peerOnline = control === 'peer-joined';
          replay.peerReset();
          fixture.clearSubscription();
          if (replay.isFailed()) return finish('Replay protection exhausted.');
          if (peerOnline) {
            sendHello();
            fixture.sendMeta();
          }
        }
        return;
      }
      if (!(data instanceof ArrayBuffer) || data.byteLength > MAX_FRAME_BYTES) return;
      const generation = peerGeneration;
      const current = () => !done && peerOnline && peerGeneration === generation;
      incoming = incoming
        .then(async () => {
          const opened = await replay
            .open(contentKey, new Uint8Array(data), current)
            .catch(() => undefined);
          if (!current()) return;
          if (replay.isFailed()) return finish('Replay protection exhausted.');
          sendHello();
          if (!opened || pair.isReplayHello(opened.payload) || !pair.isPhoneCommand(opened.payload))
            return;
          const command = opened.payload;
          if (!opened.trusted && !pair.isReplayBootstrap(command.type)) return;
          if (command.type === 'snapshot') {
            send({ type: 'replay-hello' });
            fixture.sendMeta();
          } else {
            fixture.handle(command);
          }
        })
        .catch(() => finish('Could not handle a fixture frame.'));
    }

    const heartbeat = pair.attachHeartbeat(ws, () => finish('Local relay heartbeat timed out.'));
    const connectTimer = setTimeout(
      () => finish('Local relay WebSocket timed out.'),
      pair.RELAY_CONNECT_TIMEOUT_MS
    );
    ws.addEventListener('open', onOpen);
    ws.addEventListener('error', onError);
    ws.addEventListener('message', onMessage);
    ws.addEventListener(
      'close',
      ({ code }) => {
        clearTimeout(forceExit);
        if (code === 1000 || code === 1008) stop();
        else finish('Local relay WebSocket closed unexpectedly.');
      },
      { once: true }
    );
    stopping.addEventListener('abort', stop, { once: true });
    if (stopping.aborted) stop();
  });
}

async function main() {
  const settings = options();
  if (!settings) {
    console.log(`Usage: node scripts/pair-fake-host.mjs [--relay ${DEFAULT_RELAY}] [--pair-timeout ${MAX_PAIR_SECONDS}]
Use a local relay-go instance with a disposable database. No desktop profile or model is used.
The relay URL must be loopback. For an Android device/emulator, forward its loopback port with adb reverse.`);
    return;
  }
  const pair = await loadPair();
  const stopping = new AbortController();
  const stop = () => stopping.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  let credentials;
  try {
    credentials = await registerAndClaim(
      pair,
      settings.relayUrl,
      settings.timeoutMs,
      stopping.signal
    );
    if (credentials && !stopping.signal.aborted) {
      await runSocket(pair, settings.relayUrl, credentials, stopping.signal);
    }
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    credentials?.contentKey.fill(0);
  }
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    // Errors from HTTP, crypto or WebSocket can contain credentials or remote text.
    console.error(error instanceof FixtureError ? error.message : 'Fake host failed.');
    process.exitCode = 1;
  }
}
