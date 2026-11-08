/**
 * Cross-language protocol fixtures, generated ONLY through the real pair TS implementation.
 * Node >=22.22 (native type stripping):
 *   node scripts/pair-vectors.mjs             # write UTF-8, LF, final newline
 *   node scripts/pair-vectors.mjs --check     # compare bytes; never write
 * --out-dir <directory> is available for isolated CLI regression tests.
 *
 * No tsx install or Node flags are needed. The narrowly scoped resolve hook below supplies
 * .ts for pair's existing extensionless relative imports; it never changes package imports.
 * Seeds/keys/nonces here are PUBLIC TEST DATA, never suitable for a real connection.
 */
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import nacl from 'tweetnacl';

const source = new URL('../packages/pair/src/', import.meta.url);
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      context.parentURL?.startsWith(source.href) &&
      specifier.startsWith('.') &&
      !path.extname(specifier)
    ) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const encoding = await import(new URL('encoding.ts', source).href);
const crypt = await import(new URL('crypto.ts', source).href);
const handshake = await import(new URL('handshake.ts', source).href);
const replay = await import(new URL('replay.ts', source).href);
const sync = await import(new URL('sessionSync.ts', source).href);
const chunk = await import(new URL('direct/chunk.ts', source).href);
const voice = await import(new URL('voice.ts', source).href);
const { fromBase64Url: unb64, toBase64Url: b64 } = encoding;
const { openFrame, sealFrameWithNonce } = crypt;

// A language-independent recipe keeps megabyte inputs out of the fixture files.
const recipe = 'byte[i] = (seed + 31 * i) mod 256, for 0 <= i < length';
function bytes(length, seed) {
  return Uint8Array.from({ length }, (_, i) => (seed + 31 * i) & 255);
}
function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}
function summary(value) {
  return value === null ? null : { length: value.length, sha256: digest(value) };
}
function withRandom(values, fn) {
  const original = crypto.getRandomValues;
  crypto.getRandomValues = (array) => {
    const next = values.shift();
    assert.equal(array.byteLength, next?.length, 'unexpected random draw');
    new Uint8Array(array.buffer, array.byteOffset, array.byteLength).set(next);
    return array;
  };
  try {
    const result = fn();
    assert.equal(values.length, 0, 'unused deterministic random draw');
    return result;
  } finally {
    crypto.getRandomValues = original;
  }
}

async function primitives() {
  const base64 = [[], [0], [255], [0, 255], [251, 255, 255], [0, 1, 2, 127, 128, 255]].map(
    (value) => {
      const input = Uint8Array.from(value);
      const encoded = b64(input);
      const standard = Buffer.from(input).toString('base64');
      const accepted = [...new Set([encoded, standard, ` \t${standard}\r\n`])];
      for (const text of accepted) assert.deepEqual(unb64(text), input);
      return { hex: Buffer.from(input).toString('hex'), encoded, accepted };
    }
  );
  for (const length of [31, 32, 33]) {
    const input = bytes(length, length);
    base64.push({ hex: Buffer.from(input).toString('hex'), encoded: b64(input) });
  }
  const invalidBase64 = ['A', 'A===', 'AA=A', '!!!!', 'a.b', '💧', 'AA\u0000'];
  for (const value of invalidBase64) assert.throws(() => unb64(value));

  const publicKey = b64(nacl.box.keyPair.fromSecretKey(bytes(32, 7)).publicKey);
  const otherKey = b64(nacl.box.keyPair.fromSecretKey(bytes(32, 9)).publicKey);
  const invite = { relay: 'https://relay.example.test', publicKey: unb64(publicKey) };
  const uris = [
    encoding.buildPairUri(invite),
    encoding.buildPairLink(invite),
    `  enso://pair?relay=https%3A%2F%2Frelay.example.test%2F&pk=${publicKey}  `,
    `https://relay.example.test/#pk=${publicKey}`,
    `https://relay.example.test:443/path?pk=${publicKey}`,
    `https://relay.example.test:8443/path?pk=${publicKey}`,
    `http://localhost:80/?pk=${publicKey}`,
    `http://localhost:8787/#pk=${publicKey}`,
    `https://web.example.test/?relay=https%3A%2F%2Fquery.test&pk=${otherKey}#relay=https%3A%2F%2Ffirst.test%3A8443%2Fa%2F&relay=https%3A%2F%2Fsecond.test&pk=${publicKey}&pk=${otherKey}`,
    `https://web.example.test/?relay=https%3A%2F%2Ffirst.test&relay=https%3A%2F%2Fsecond.test&pk=${publicKey}&pk=${otherKey}`,
    `https://web.example.test/?pk=${otherKey}#pk=${publicKey}&pk=${otherKey}`,
    `https://web.example.test/?pk=${publicKey}#`,
    `enso://pair?relay=https%3A%2F%2Ffirst.test&relay=https%3A%2F%2Fsecond.test&pk=${publicKey}&pk=${otherKey}`,
  ];
  const invites = uris.map((uri) => {
    const parsed = encoding.parsePairUri(uri);
    assert.equal(parsed.publicKey.length, 32);
    return { uri, relay: parsed.relay, publicKey: b64(parsed.publicKey) };
  });
  // parsePairUri intentionally does not validate key length or relay schemes. Do not invent
  // stricter shared expectations: only truly rejected TS inputs belong in this array.
  const invalidInvites = [
    '',
    'not a pair uri',
    `ftp://relay.example.test/?pk=${publicKey}`,
    `enso://other?relay=https%3A%2F%2Frelay.test&pk=${publicKey}`,
    `ENSO://pair?relay=https%3A%2F%2Frelay.test&pk=${publicKey}`,
    `enso://pair?pk=${publicKey}`,
    'enso://pair?relay=https%3A%2F%2Frelay.test',
    `enso://pair?relay=&pk=${publicKey}`,
    'https://relay.example.test/#pk=',
    'https://relay.example.test/#pk=!!!!',
    `https://relay.example.test/?pk=${publicKey}#unrelated=1`,
    `https://relay.example.test/?pk=${publicKey}#relay=https%3A%2F%2Frelay.test`,
    `https://[invalid/?pk=${publicKey}`,
  ];
  for (const uri of invalidInvites) assert.throws(() => encoding.parsePairUri(uri));

  const payloads = [
    { type: 'probe', id: 'fixed-1', at: 0 },
    { type: 'prompt', sessionId: '会话-一', text: '檐下 🌧️ café\n第二行', nested: { yes: true } },
    { type: 'snapshot', empty: [], nil: null, number: -0.5 },
    ['JSON', 42, false, null],
  ];
  const frames = [];
  for (const [i, payload] of payloads.entries()) {
    const key = bytes(32, i + 11);
    const nonce = bytes(12, i + 53);
    const frame = await sealFrameWithNonce(key, payload, nonce);
    assert.deepEqual(await openFrame(key, frame), payload);
    frames.push({
      key: b64(key),
      nonce: b64(nonce),
      plaintext: JSON.stringify(payload),
      frame: b64(frame),
    });
  }
  return { version: 1, base64, invalidBase64, invites, invalidInvites, frames };
}

async function cryptoVectors(primitive) {
  const host = nacl.box.keyPair.fromSecretKey(bytes(32, 7));
  const ephSecretKey = bytes(32, 71);
  const nonce = bytes(24, 101);
  const contentKey = bytes(32, 151);
  // Exercise boxContentKey itself, not a copied NaCl implementation. Its two random draws
  // are a fixed ephemeral secret and a fixed nonce. Restore secure randomness immediately.
  const draws = [ephSecretKey, nonce];
  nacl.setPRNG((target, size) => {
    const next = draws.shift();
    assert.equal(size, next?.length);
    target.set(next);
  });
  let boxed;
  try {
    boxed = crypt.boxContentKey(contentKey, host.publicKey);
    assert.equal(draws.length, 0);
  } finally {
    nacl.setPRNG((target, size) => target.set(randomBytes(size)));
  }
  const boxedKey = handshake.encodeBoxedKey(boxed);
  assert.deepEqual(
    crypt.openBoxedContentKey(handshake.decodeBoxedKey(boxedKey), host.secretKey),
    contentKey
  );
  const box = {
    hostSecretKey: b64(host.secretKey),
    hostPublicKey: b64(host.publicKey),
    ephSecretKey: b64(ephSecretKey),
    ephPublicKey: b64(boxed.ephPublicKey),
    nonce: b64(boxed.nonce),
    contentKey: b64(contentKey),
    boxed: b64(boxed.boxed),
    boxedKey,
  };
  const original = unb64(primitive.frames[0].frame);
  const key = unb64(primitive.frames[0].key);
  const tampered = original.slice();
  tampered[tampered.length - 1] ^= 1;
  const version = original.slice();
  version[0] = 2;
  const badNonce = original.slice();
  badNonce[1] ^= 1;
  const invalidJsonNonce = bytes(12, 199);
  const aesKey = await crypto.subtle.importKey('raw', key, 'AES-GCM', false, ['encrypt']);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: invalidJsonNonce },
      aesKey,
      new TextEncoder().encode('not JSON: 檐下')
    )
  );
  const invalidJson = new Uint8Array(13 + ciphertext.length);
  invalidJson[0] = 1;
  invalidJson.set(invalidJsonNonce, 1);
  invalidJson.set(ciphertext, 13);
  const invalidFrames = [
    { name: 'empty', key: b64(key), frame: '' },
    { name: 'below-minimum', key: b64(key), frame: b64(original.subarray(0, 28)) },
    { name: 'version', key: b64(key), frame: b64(version) },
    { name: 'tag-tampered', key: b64(key), frame: b64(tampered) },
    { name: 'nonce-tampered', key: b64(key), frame: b64(badNonce) },
    { name: 'wrong-key', key: b64(bytes(32, 12)), frame: b64(original) },
    { name: 'key-length', key: b64(bytes(31, 11)), frame: b64(original) },
    { name: 'authenticated-non-json', key: b64(key), frame: b64(invalidJson) },
  ];
  for (const value of invalidFrames)
    await assert.rejects(() => openFrame(unb64(value.key), unb64(value.frame)));
  const invalidBoxedKeys = ['', 'a.b', 'a.b.c.d', '!!!!.AA.AA'];
  for (const value of invalidBoxedKeys) assert.throws(() => handshake.decodeBoxedKey(value));
  return { version: 1, box, invalidBoxedKeys, invalidFrames };
}

function peerPrefix(index) {
  const value = new Uint8Array(8);
  const view = new DataView(value.buffer);
  view.setUint32(0, 0x70656572); // ASCII "peer"
  view.setUint32(4, index);
  return value;
}
function nonceFor(prefix, counter) {
  const nonce = new Uint8Array(12);
  nonce.set(prefix);
  new DataView(nonce.buffer).setUint32(8, counter);
  return nonce;
}

async function replayVectors() {
  const key = bytes(32, 173);
  const legacyNonce = bytes(12, 229);
  const sequences = [];
  const localPrefix = bytes(8, 13);
  const localChallenge = b64(bytes(8, 37));
  const nextChallenge = b64(bytes(8, 61));
  const peerChallenge = b64(bytes(8, 89));
  const message = { type: 'probe', id: 'vector' };

  async function sequence(name, config, build) {
    const local = {
      role: 'host',
      announce: true,
      requireModern: false,
      prefix: b64(localPrefix),
      challenge: localChallenge,
      ...config,
    };
    let pins = 0;
    const state = withRandom([unb64(local.prefix), unb64(local.challenge)], () =>
      replay.createFrameReplay(
        (k, payload, nonce) => sealFrameWithNonce(k, payload, nonce ?? legacyNonce),
        openFrame,
        {
          ...local,
          onModern() {
            pins++;
            if (local.pinFails) throw new Error('fixture pin failure');
          },
        }
      )
    );
    const steps = [];
    const status = () => ({ ready: state.isReady(), failed: state.isFailed(), pins });
    const incoming = async (prefixIndex, counter, echo, extra = {}, nonceOverride) => {
      const prefix = peerPrefix(prefixIndex);
      return sealFrameWithNonce(
        key,
        {
          ...message,
          replay: {
            r: local.role === 'host' ? 'g' : 'h',
            p: b64(prefix),
            c: peerChallenge,
            ...(echo ? { e: echo } : {}),
            ...extra,
          },
        },
        nonceOverride ?? nonceFor(prefix, counter)
      );
    };
    const receive = async (frame) => {
      let opened;
      let error = false;
      try {
        opened = await state.open(key, frame);
      } catch {
        error = true;
      }
      const expected = {
        accepted: opened !== undefined,
        trusted: opened?.trusted ?? false,
        error,
        ...(opened ? { payload: opened.payload } : {}),
        ...status(),
      };
      steps.push({ op: 'receive', frame: b64(frame), expected });
      return expected;
    };
    const seal = async (payload = { type: 'replay-hello' }) => {
      try {
        const frame = await state.seal(key, payload);
        steps.push({
          op: 'seal',
          payload,
          expected: { error: false, frame: b64(frame), ...status() },
        });
        return frame;
      } catch {
        steps.push({ op: 'seal', payload, expected: { error: true, ...status() } });
      }
    };
    const reset = () => {
      withRandom([unb64(nextChallenge)], () => state.peerReset());
      steps.push({ op: 'reset', challenge: nextChallenge, expected: status() });
    };
    const hello = () =>
      steps.push({ op: 'takeHello', expected: { hello: state.takeHello(), ...status() } });
    const range = async (first, count) => {
      const inputs = [];
      const outcomes = [];
      for (let index = first; index < first + count; index++) {
        const frame = await incoming(index, 1);
        inputs.push(frame);
        const opened = await state.open(key, frame);
        outcomes.push({
          index,
          accepted: !!opened,
          trusted: opened?.trusted ?? false,
          ...status(),
        });
      }
      steps.push({
        op: 'prefixRange',
        first,
        count,
        counter: 1,
        challenge: peerChallenge,
        payload: message,
        expected: {
          accepted: outcomes.filter((v) => v.accepted).length,
          trusted: outcomes.filter((v) => v.trusted).length,
          framesSha256: digest(Buffer.concat(inputs)),
          first: outcomes[0],
          last: outcomes.at(-1),
          ...status(),
        },
      });
    };
    await build({ incoming, receive, seal, reset, hello, range });
    sequences.push({ name, local, steps });
  }

  await sequence(
    'window-64-reset-and-no-downgrade',
    {},
    async ({ incoming, receive, seal, reset, hello }) => {
      hello();
      hello();
      const ownFrame = await seal();
      assert.equal((await receive(ownFrame)).accepted, false);
      const initial = await incoming(1, 1);
      assert.equal((await receive(initial)).trusted, false);
      await seal();
      const trusted = await incoming(1, 2, localChallenge);
      assert.equal((await receive(trusted)).trusted, true);
      await receive(trusted);
      const high = await incoming(1, 70, localChallenge);
      await receive(high);
      assert.equal((await receive(await incoming(1, 7, localChallenge))).accepted, true); // 63 behind
      assert.equal((await receive(await incoming(1, 6, localChallenge))).accepted, false); // 64 behind
      await receive(await incoming(1, 7, localChallenge));
      reset();
      hello();
      await receive(high);
      assert.equal((await receive(await incoming(1, 71, localChallenge))).trusted, false);
      assert.equal((await receive(await incoming(1, 72, nextChallenge))).trusted, true);
      await receive(await sealFrameWithNonce(key, message, legacyNonce));
      await seal();
    }
  );
  await sequence(
    'malformed-reflected-and-tampered',
    { role: 'guest', announce: false, requireModern: true },
    async ({ incoming, receive, seal }) => {
      const prefix = peerPrefix(3);
      for (const body of [null, [], 42, { replay: {} }, { type: 'probe', replay: null }]) {
        await receive(await sealFrameWithNonce(key, body, nonceFor(prefix, 1)));
      }
      await receive(await incoming(3, 1, undefined, { r: 'g' }));
      await receive(await incoming(3, 1, undefined, { r: undefined }));
      await receive(await incoming(3, 1, undefined, { extra: true }));
      await receive(
        await incoming(3, 1, undefined, { p: b64(localPrefix) }, nonceFor(localPrefix, 1))
      );
      await receive(await incoming(3, 1, undefined, { c: localChallenge }));
      await receive(await incoming(3, 1, undefined, { p: b64(peerPrefix(4)) }));
      await receive(await incoming(3, 0));
      await receive(await incoming(3, 1, undefined, { p: `${b64(prefix).slice(0, -1)}J` }));
      await receive(await incoming(3, 1, undefined, { c: 'bad' }));
      await receive(await incoming(3, 1, undefined, { e: 'bad' }));
      await receive(await sealFrameWithNonce(key, message, legacyNonce));
      const good = await incoming(3, 1, localChallenge);
      const bad = good.slice();
      bad[bad.length - 1] ^= 1;
      assert.equal((await receive(bad)).error, true);
      assert.equal((await receive(good)).trusted, true); // bad inputs did not consume the counter
      await receive(good);
      await seal();
    }
  );
  await sequence(
    'legacy-to-modern',
    { role: 'guest', announce: false },
    async ({ incoming, receive, seal, reset, hello }) => {
      hello();
      await seal({ type: 'snapshot' });
      const legacy = await sealFrameWithNonce(key, { type: 'catalog', entries: [] }, legacyNonce);
      await receive(legacy);
      await receive(legacy);
      await receive(await incoming(5, 1));
      await receive(legacy);
      await seal();
      await receive(await incoming(5, 2, localChallenge));
      reset();
      await receive(legacy);
      hello();
    }
  );
  await sequence(
    'prefix-budget-127-128-129-no-eviction',
    {},
    async ({ incoming, receive, range, seal }) => {
      await range(1, 127);
      await range(128, 1);
      const duplicate = await receive(await incoming(1, 1));
      assert.equal(duplicate.accepted, false);
      assert.equal(duplicate.failed, false);
      await range(129, 1);
      const failed = await receive(await incoming(1, 2));
      assert.equal(failed.failed, true);
      await seal();
    }
  );
  await sequence(
    'challenge-has-one-prefix-owner',
    {},
    async ({ incoming, receive, reset, seal }) => {
      assert.equal((await receive(await incoming(10, 1, localChallenge))).trusted, true);
      assert.equal((await receive(await incoming(11, 1, localChallenge))).trusted, false);
      await seal();
      reset();
      assert.equal((await receive(await incoming(11, 2, nextChallenge))).trusted, true);
      assert.equal((await receive(await incoming(10, 2, nextChallenge))).trusted, false);
      await seal();
    }
  );
  await sequence(
    'pin-persistence-fails-closed',
    { pinFails: true },
    async ({ incoming, receive, seal }) => {
      const result = await receive(await incoming(12, 1));
      assert.equal(result.failed, true);
      await receive(await incoming(12, 2, localChallenge));
      await seal();
    }
  );
  const counterCases = [0, 1, 0xfffffffe, 0xffffffff, -1, 1.5, Number.MAX_SAFE_INTEGER].map(
    (value) => {
      try {
        return { value, next: replay.nextReplayCounter(value) };
      } catch {
        return { value, error: true };
      }
    }
  );
  const bootstrap = [
    'replay-hello',
    'snapshot',
    'subscribe',
    'history',
    'direct-offer',
    'direct-ice',
    'direct-close',
    'probe',
    'prompt',
    'approval-respond',
    'presence',
    'voice-chunk',
    'file-list',
    'diff-request',
    'unknown',
  ].map((type) => ({
    type,
    command: replay.isReplayBootstrap(type),
    response: replay.isReplayBootstrapResponse(type),
  }));
  return {
    version: 1,
    key: b64(key),
    legacyNonce: b64(legacyNonce),
    prefixRecipe:
      '8 bytes: uint32_be(0x70656572) || uint32_be(index); nonce = prefix || uint32_be(counter)',
    sequences,
    counterCases,
    bootstrap,
  };
}

function sessionVectors() {
  const sessionId = 'session-檐下';
  const snapshot = {
    type: 'session-sync',
    sessionId,
    requestId: 'request-1',
    cursor: { epoch: 'epoch-1', seq: 0 },
    mode: 'snapshot',
    snapshot: {
      type: 'snapshot',
      sessions: [
        {
          sessionId,
          identity: { sessionId, generation: 'generation-1' },
          messages: [{ role: 'user', content: [] }],
          baseIndex: 4,
        },
      ],
    },
  };
  const replayInput = {
    type: 'session-sync',
    sessionId,
    requestId: 'request-2',
    cursor: { epoch: 'epoch-1', seq: 2 },
    mode: 'replay',
    fromSeq: 1,
    events: [{ type: 'status', sessionId, status: 'idle' }],
  };
  const inputs = [
    ['snapshot', snapshot],
    ['replay', replayInput],
    ['zero-event-replay', { ...replayInput, fromSeq: 2, events: [] }],
    [
      'unknown-event-fields-preserved',
      { ...replayInput, events: [{ type: 'future-event', sessionId, future: 42 }] },
    ],
    [
      'bounded-identities',
      {
        ...snapshot,
        requestId: 'r'.repeat(512),
        cursor: { epoch: 'e'.repeat(512), seq: Number.MAX_SAFE_INTEGER },
      },
    ],
    ['null', null],
    ['array', []],
    ['number', 42],
    ['unknown-type', { ...snapshot, type: 'other' }],
    ['unknown-mode', { ...snapshot, mode: 'other' }],
    ['empty-session', { ...snapshot, sessionId: '' }],
    ['empty-request', { ...snapshot, requestId: '' }],
    ['long-request', { ...snapshot, requestId: 'r'.repeat(513) }],
    ['long-session', { ...snapshot, sessionId: 's'.repeat(513) }],
    ['outer-extra', { ...snapshot, extra: true }],
    ['wrong-branch', { ...snapshot, fromSeq: 0 }],
  ];
  for (const cursor of [
    null,
    [],
    { epoch: '', seq: 0 },
    { epoch: 'e'.repeat(513), seq: 0 },
    { epoch: 'e', seq: -1 },
    { epoch: 'e', seq: 0.5 },
    { epoch: 'e', seq: Number.MAX_SAFE_INTEGER + 1 },
    { epoch: 'e', seq: 0, extra: true },
  ]) {
    inputs.push(['invalid-cursor', { ...snapshot, cursor }]);
  }
  const session = snapshot.snapshot.sessions[0];
  for (const inner of [
    null,
    { type: 'wrong', sessions: [session] },
    { type: 'snapshot', sessions: [] },
    { type: 'snapshot', sessions: [session, session] },
  ]) {
    inputs.push(['invalid-snapshot-container', { ...snapshot, snapshot: inner }]);
  }
  for (const dirty of [
    { sessionId: 'other' },
    { identity: { sessionId: 'other' } },
    { identity: null },
    { messages: null },
    { messages: {} },
    { baseIndex: -1 },
    { baseIndex: 0.5 },
    { baseIndex: Number.MAX_SAFE_INTEGER + 1 },
  ]) {
    inputs.push([
      'invalid-session-snapshot',
      { ...snapshot, snapshot: { type: 'snapshot', sessions: [{ ...session, ...dirty }] } },
    ]);
  }
  inputs.push([
    'optional-identity-and-extra-inner-fields',
    {
      ...snapshot,
      snapshot: {
        type: 'snapshot',
        future: true,
        sessions: [{ sessionId, messages: [], baseIndex: 0, future: true }],
      },
    },
  ]);
  for (const events of [
    [],
    [null],
    [[]],
    [{ type: '', sessionId }],
    [{ type: 'status' }],
    [{ type: 'status', sessionId: 'other' }],
    [{ type: 'x'.repeat(513), sessionId }],
  ]) {
    inputs.push(['invalid-replay-events', { ...replayInput, events }]);
  }
  for (const fromSeq of [-1, 0.5, 3, Number.MAX_SAFE_INTEGER + 1])
    inputs.push(['invalid-fromSeq', { ...replayInput, fromSeq }]);
  inputs.push(['replay-extra-key', { ...replayInput, snapshot: {} }]);
  const cases = inputs.map(([name, input]) => ({
    name,
    input,
    accepted: sync.parsePairSessionSync(input) !== null,
  }));
  assert.equal(cases.filter((value) => value.accepted).length, 6);
  return { version: 1, cases };
}

function chunkVectors() {
  const roundTrips = [0, 1, 13, 16383, 16384, 16385, 32768, 1048576, 1048577].map(
    (length, index) => {
      const seed = index + 3;
      const frame = bytes(length, seed);
      const chunks = chunk.encodeChunks(frame);
      const reassembler = chunk.createReassembler();
      let result = null;
      for (const part of chunks) result = reassembler.push(part) ?? result;
      const parts = chunks.map((part) => ({
        flag: part[0],
        ...summary(part),
        ...(part.length <= 32 ? { encoded: b64(part) } : {}),
      }));
      return { length, seed, chunks: parts, result: summary(result) };
    }
  );
  const specs = [
    {
      name: 'invalid-header-clears-partial',
      steps: [
        { flag: 0, length: 5, seed: 3 },
        { encoded: 'fwEC' },
        { flag: 1, length: 3, seed: 9 },
      ],
    },
    {
      name: 'overflow-skips-through-last-then-recovers',
      steps: [
        { flag: 0, length: 16384, seed: 7, repeat: 65 },
        { flag: 0, length: 2, seed: 2 },
        { flag: 1, length: 2, seed: 2 },
        { flag: 1, length: 5, seed: 9 },
      ],
    },
    {
      name: 'invalid-header-leaves-skip-mode',
      steps: [
        { flag: 0, length: 1048577, seed: 7 },
        { encoded: '' },
        { flag: 1, length: 2, seed: 11 },
      ],
    },
    {
      name: 'controls-are-not-data-chunks',
      steps: [
        { encoded: 'Ag' },
        { encoded: 'Aw' },
        { flag: 1, length: 0, seed: 0 },
        { flag: 1, length: 3, seed: 8 },
      ],
    },
    {
      name: 'consecutive-multipart-and-single',
      steps: [
        { flag: 0, length: 3, seed: 1 },
        { flag: 1, length: 2, seed: 2 },
        { flag: 1, length: 1, seed: 3 },
      ],
    },
  ];
  const sequences = specs.map((spec) => {
    const r = chunk.createReassembler();
    let pushes = 0;
    const completed = [];
    for (const step of spec.steps) {
      let part;
      if (step.encoded === undefined) {
        part = new Uint8Array(1 + step.length);
        part[0] = step.flag;
        part.set(bytes(step.length, step.seed), 1);
      } else part = unb64(step.encoded);
      for (let i = 0; i < (step.repeat ?? 1); i++) {
        pushes++;
        const result = r.push(part);
        if (result !== null) completed.push({ push: pushes, ...summary(result) });
      }
    }
    return { ...spec, expected: { pushes, completed } };
  });
  return {
    version: 1,
    recipe,
    payloadBytes: chunk.CHUNK_PAYLOAD_BYTES,
    maxBytes: chunk.MAX_REASSEMBLED_BYTES,
    roundTrips,
    sequences,
  };
}

function sample(value) {
  return typeof value === 'number'
    ? value
    : { NaN: Number.NaN, '+Infinity': Infinity, '-Infinity': -Infinity }[value];
}
function pcmBytes(pcm) {
  const value = new Uint8Array(pcm.length * 2);
  const view = new DataView(value.buffer);
  for (let i = 0; i < pcm.length; i++) view.setInt16(i * 2, pcm[i], true);
  return value;
}
function voiceVectors() {
  const cases = [
    { name: 'empty', samples: [], samplesPerChunk: 4 },
    {
      name: 'clipping-nan-and-endianness',
      samples: [0, 1, -1, 2, -2, 0.5, -0.5, 'NaN', '+Infinity', '-Infinity'],
      samplesPerChunk: 20,
    },
    {
      name: 'rounding-asymmetry',
      samples: [0.1, -0.1, 0.3, -0.3, 0.0000152587890625, -0.0000152587890625, 0.99999, -0.99999],
      samplesPerChunk: 3,
    },
    {
      name: 'short-final-chunk',
      samples: [0, 0.25, 0.5, 0.75, 1, -0.25, -0.5, -0.75, -1, 0],
      samplesPerChunk: 4,
    },
  ].map((value) => {
    const encoded = voice.encodeVoiceChunks(
      Float32Array.from(value.samples, sample),
      value.samplesPerChunk
    );
    return {
      ...value,
      encoded,
      pcm: encoded.map((text) => Array.from(voice.decodeVoiceChunk(text))),
    };
  });
  const boundaries = [191999, 192000, 192001].map((length) => {
    const pattern = [0, 0.3, -0.3, 1, -1];
    const input = Float32Array.from({ length }, (_, i) => pattern[i % pattern.length]);
    const chunks = voice.encodeVoiceChunks(input).map((text) => {
      const decoded = voice.decodeVoiceChunk(text);
      return {
        chars: text.length,
        sha256: digest(text),
        samples: decoded.length,
        pcmSha256: digest(pcmBytes(decoded)),
      };
    });
    return { length, pattern, chunks };
  });
  const invalid = ['', 'AA', 'AAAA', '!!!!', 'A', 'AA=A'].map((encoded) => {
    assert.equal(voice.decodeVoiceChunk(encoded), null);
    return encoded;
  });
  return {
    version: 1,
    maxSamples: voice.VOICE_CHUNK_MAX_SAMPLES,
    maxChars: voice.VOICE_CHUNK_MAX_CHARS,
    cases,
    boundaries,
    invalid,
  };
}

async function main(args) {
  let check = false;
  let output = fileURLToPath(new URL('../packages/pair/vectors/', import.meta.url));
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--check') check = true;
    else if (args[i] === '--out-dir' && args[i + 1]) output = path.resolve(args[++i]);
    else throw new Error(`unknown or incomplete argument: ${args[i]}`);
  }
  const primitive = await primitives();
  const files = {
    'primitives.json': primitive,
    'crypto.json': await cryptoVectors(primitive),
    'replay.json': await replayVectors(),
    'session-sync.json': sessionVectors(),
    'chunks.json': chunkVectors(),
    'voice.json': voiceVectors(),
  };
  if (!check) await mkdir(output, { recursive: true });
  const stale = [];
  for (const [name, value] of Object.entries(files)) {
    const expected = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
    const target = path.join(output, name);
    if (check) {
      let actual;
      try {
        actual = await readFile(target);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      if (!actual?.equals(expected)) stale.push(name);
    } else await writeFile(target, expected);
  }
  if (check) {
    const names = await readdir(output).catch((error) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
    for (const name of names)
      if (name.endsWith('.json') && !Object.hasOwn(files, name)) stale.push(`${name} (unexpected)`);
    if (stale.length)
      throw new Error(
        `pair vectors missing or stale: ${stale.join(', ')}; run node scripts/pair-vectors.mjs`
      );
  }
  console.log(
    `pair vectors ${check ? 'checked' : 'wrote'}: ${Object.keys(files).length} files (${output})`
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
