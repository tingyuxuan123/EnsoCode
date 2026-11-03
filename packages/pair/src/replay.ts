import { openFrame, PairCryptoError, sealFrame, sealFrameWithNonce } from './crypto';
import { fromBase64Url, toBase64Url } from './encoding';

const PREFIX_BYTES = 8;
const WINDOW_BITS = 64;
const WINDOW_MASK = (1n << 64n) - 1n;
// Never evict a nonce domain: eviction would turn a recorded frame into a new frame.
const MAX_PREFIXES = 128;
type Seal = (key: Uint8Array, payload: unknown, nonce?: Uint8Array) => Promise<Uint8Array>;
type Open = typeof openFrame;

interface Stamp {
  r: 'h' | 'g';
  p: string;
  c: string;
  e?: string;
}
interface Window {
  high: number;
  bits: bigint;
  challenge: string;
}

export interface OpenedReplayFrame {
  payload: unknown;
  trusted: boolean;
}
export interface FrameReplay {
  seal(key: Uint8Array, payload: unknown): Promise<Uint8Array>;
  /** Decrypt errors throw. Stale generation, malformed stamp, reflection and replay drop. */
  open(
    key: Uint8Array,
    frame: Uint8Array,
    current?: () => boolean
  ): Promise<OpenedReplayFrame | undefined>;
  /** Fresh challenge only; retain authenticated identity, modern capability and every window. */
  peerReset(): void;
  takeHello(): boolean;
  /** Legacy becomes ready only after an encrypted response; modern needs a fresh echo. */
  isReady(): boolean;
  isFailed(): boolean;
}

export interface FrameReplayOptions {
  role?: 'host' | 'guest';
  announce?: boolean;
  /** Persisted per pair + contentKey after observing an opposite-role authenticated stamp. */
  requireModern?: boolean;
  /** Synchronous durable pin. Throw on persistence failure: the connection fails closed. */
  onModern?: () => void;
}

export function isReplayHello(value: unknown): boolean {
  return record(value)?.type === 'replay-hello';
}

// Finite bootstrap allowlist, NOT an alias for read scope (which also changes settings/presence).
// All future commands, remote invocation, approval and preview input are denied by default.
const BOOTSTRAP = new Set([
  'replay-hello',
  'snapshot',
  'subscribe',
  'history',
  'direct-offer',
  'direct-ice',
  'direct-close',
  'probe',
]);
export function isReplayBootstrap(type: string): boolean {
  return BOOTSTRAP.has(type);
}

/** Read-only replies to bootstrap requests; action/file/preview/voice/Bot results are excluded. */
export function isReplayBootstrapResponse(type: string): boolean {
  return [
    'replay-hello',
    'host-info',
    'catalog',
    'projects',
    'providers',
    'appearance',
    'push-config',
    'session-sync',
    'agent-event',
    'history',
    'direct-answer',
    'direct-ice',
    'probe-ack',
  ].includes(type);
}

export function nextReplayCounter(counter: number): number {
  if (!Number.isInteger(counter) || counter < 0 || counter >= 0xffffffff) {
    throw new PairCryptoError('replay counter exhausted');
  }
  return counter + 1;
}

/**
 * Frame v1 remains compatible with old hosts' strict file/preview validators: only hosts
 * announce proactively; guests stamp after seeing a valid host stamp. Legacy is best effort,
 * without full replay protection. Once modern was observed it can never fall back to legacy.
 * Initial unpinned peers are TOFU: a relay can suppress all modern announcements and keep an
 * old-looking peer in legacy mode. onModern durably pins the role-bound protocol for reloads;
 * unauthenticated relay controls cannot erase that pin. Upstream stamps without r are NOT
 * this protocol and are rejected (only truly unstamped legacy peers are supported).
 * Early upstream replay peers must upgrade BOTH endpoints; never delete a known modern pin
 * to "fix" compatibility. Pin persistence failure disconnects instead of falling back.
 * At most 128 sender prefixes are retained; exhaustion disconnects via isFailed, never LRU.
 * A new instance may discard windows only with a fresh challenge and the persisted modern pin.
 * This state belongs to a content-key connection, shared by relay and direct transports.
 */
export function createFrameReplay(
  seal: Seal = (key, payload, nonce) =>
    nonce ? sealFrameWithNonce(key, payload, nonce) : sealFrame(key, payload),
  open: Open = openFrame,
  options: FrameReplayOptions = {}
): FrameReplay {
  const role = (options.role ?? (options.announce ? 'host' : 'guest')) === 'host' ? 'h' : 'g';
  const prefix = random();
  const prefixId = toBase64Url(prefix);
  let challenge = toBase64Url(random());
  const windows = new Map<string, Window>();
  let counter = 0;
  let epoch = 0;
  let modern = options.requireModern === true;
  let observedModern = false;
  let legacyReady = false;
  let failed = false;
  let peer: string | null = null;
  // A local challenge can authenticate only one prefix, even if another peer echoes it.
  let challengeOwner: string | null = null;
  let echo: string | undefined;
  let hello = options.announce === true || modern;

  function fail(): undefined {
    failed = true;
    return undefined;
  }

  return {
    peerReset() {
      epoch++;
      if (failed) return;
      const fresh = toBase64Url(random());
      if (fresh === challenge) {
        fail();
        return;
      }
      challenge = fresh;
      challengeOwner = null;
      legacyReady = false;
      hello = modern || options.announce === true;
      // Identity stays known, but writes wait for this challenge's fresh echo.
    },
    isReady: () => !failed && (challengeOwner !== null || (!modern && legacyReady)),
    isFailed: () => failed,
    takeHello() {
      const pending = hello && !failed;
      hello = false;
      return pending;
    },
    async seal(key, payload) {
      const started = epoch;
      if (failed) throw new PairCryptoError('replay state exhausted');
      const finish = async (pending: Promise<Uint8Array>): Promise<Uint8Array> => {
        const frame = await pending;
        if (started !== epoch || failed) throw new PairCryptoError('replay epoch changed');
        return frame;
      };
      if (!options.announce && !modern) return finish(seal(key, payload));
      if (counter === 0xffffffff) {
        fail();
        throw new PairCryptoError('replay counter exhausted');
      }
      counter = nextReplayCounter(counter); // synchronous reservation, BEFORE any crypto await
      const nonce = new Uint8Array(12);
      nonce.set(prefix);
      new DataView(nonce.buffer).setUint32(8, counter);
      const body = record(payload);
      if (!body) throw new PairCryptoError('replay payload must be an object');
      return finish(
        seal(
          key,
          { ...body, replay: { r: role, p: prefixId, c: challenge, ...(echo ? { e: echo } : {}) } },
          nonce
        )
      );
    },
    async open(key, frame, current = () => true) {
      const started = epoch;
      if (failed || !current()) return undefined;
      const payload = await open(key, frame);
      // Atomic synchronous validation/commit after decrypt. No old async result may mutate state.
      if (failed || started !== epoch || !current()) return undefined;
      const body = record(payload);
      if (!body || typeof body.type !== 'string') return undefined;
      if (!Object.hasOwn(body, 'replay')) {
        if (modern) return undefined;
        legacyReady = true;
        return { payload, trusted: true };
      }
      const stamp = readStamp(body.replay);
      if (
        !stamp ||
        stamp.r === role ||
        frame.length < 13 ||
        stamp.p === prefixId ||
        stamp.c === challenge
      )
        return undefined;
      const nonce = frame.subarray(1, 13);
      if (toBase64Url(nonce.subarray(0, 8)) !== stamp.p) return undefined;
      const n = new DataView(nonce.buffer, nonce.byteOffset + 8, 4).getUint32(0);
      if (n === 0) return undefined;
      const previous = windows.get(stamp.p);
      const bits = accept(previous, n);
      if (bits === undefined) return undefined;
      if (!previous && windows.size >= MAX_PREFIXES) return fail();
      // Old challenges may arrive out of order, but must never roll the outbound echo back.
      const newChallenge = !previous || (n > previous.high && stamp.c !== previous.challenge);
      const window: Window = previous ?? { high: 0, bits: 0n, challenge: stamp.c };
      window.bits = bits;
      window.high = Math.max(window.high, n);
      if (newChallenge) {
        window.challenge = stamp.c;
        if (peer === null || peer === stamp.p || challengeOwner === null) {
          echo = stamp.c;
          hello = true;
        }
      }
      windows.set(stamp.p, window);
      modern = true;
      if (!observedModern) {
        try {
          options.onModern?.();
        } catch {
          return fail();
        }
        observedModern = true;
      }
      if (stamp.e === challenge && challengeOwner === null) {
        challengeOwner = stamp.p;
        peer = stamp.p;
        // Echo the authenticated peer, not an unrelated candidate seen in between.
        echo = window.challenge;
        hello = true;
      }
      const { replay: _, ...stripped } = body;
      return { payload: stripped, trusted: challengeOwner === stamp.p && stamp.e === challenge };
    },
  };
}

function accept(window: Window | undefined, counter: number): bigint | undefined {
  if (!window) return 1n;
  if (counter > window.high) {
    const shift = counter - window.high;
    return shift >= WINDOW_BITS ? 1n : ((window.bits << BigInt(shift)) | 1n) & WINDOW_MASK;
  }
  const behind = window.high - counter;
  if (behind >= WINDOW_BITS) return undefined;
  const mask = 1n << BigInt(behind);
  return window.bits & mask ? undefined : window.bits | mask;
}
function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function readStamp(value: unknown): Stamp | null {
  const stamp = record(value);
  if (
    !stamp ||
    (stamp.r !== 'h' && stamp.r !== 'g') ||
    Object.keys(stamp).some((k) => k !== 'r' && k !== 'p' && k !== 'c' && k !== 'e')
  )
    return null;
  if (!bytes(stamp.p) || !bytes(stamp.c) || (stamp.e !== undefined && !bytes(stamp.e))) return null;
  return {
    r: stamp.r,
    p: stamp.p as string,
    c: stamp.c as string,
    ...(stamp.e === undefined ? {} : { e: stamp.e as string }),
  };
}
function bytes(value: unknown): boolean {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{11}$/.test(value)) return false;
  try {
    const decoded = fromBase64Url(value);
    return decoded.length === PREFIX_BYTES && toBase64Url(decoded) === value;
  } catch {
    return false;
  }
}
function random(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(PREFIX_BYTES));
}
