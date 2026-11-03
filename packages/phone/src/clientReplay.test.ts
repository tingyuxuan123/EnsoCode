import { createFrameReplay, openFrame, type PairedDevice, toBase64Url } from '@enso/pair';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sealFrameWithNonce } from '../../pair/src/crypto';
import { type ClientEvents, PairClient } from './client';
import { loadDevices, saveDevices } from './storage';

const direct = vi.hoisted(() => ({
  receive: null as ((frame: Uint8Array) => void) | null,
  attempts: [] as Uint8Array[],
  alive: false,
}));
vi.mock('@enso/pair', async (original) => {
  const actual = await original<typeof import('@enso/pair')>();
  return {
    ...actual,
    DirectLink: class extends actual.DirectLink {
      constructor(deps: import('@enso/pair').DirectLinkDeps) {
        super(deps);
        direct.receive = deps.onFrame;
      }
      send(frame: Uint8Array): boolean {
        direct.attempts.push(frame);
        return direct.alive;
      }
      transport() {
        return direct.alive ? ('direct' as const) : super.transport();
      }
      peerGone() {
        direct.alive = false;
        super.peerGone();
      }
    },
  };
});

vi.mock('./theme', () => ({ setHostTheme: vi.fn() }));
vi.mock('./stubs/settings-store', () => ({
  setCompactReadOnlyTools: vi.fn(),
  setExpandLiveEdits: vi.fn(),
  setTerminalAppearance: vi.fn(),
  setTimelinePrefs: vi.fn(),
}));

class Socket {
  static all: Socket[] = [];
  readyState = 0;
  binaryType = '';
  onopen?: () => void;
  onclose?: (event: { code: number; reason: string }) => void;
  onmessage?: (event: { data: ArrayBuffer | string }) => void;
  sent: Uint8Array[] = [];
  constructor() {
    Socket.all.push(this);
  }
  addEventListener() {}
  removeEventListener() {}
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  send(frame: ArrayBuffer | string) {
    if (typeof frame !== 'string') this.sent.push(new Uint8Array(frame));
  }
  receive(frame: Uint8Array) {
    this.onmessage?.({ data: frame.slice().buffer as ArrayBuffer });
  }
  close() {
    this.readyState = 3;
    this.onclose?.({ code: 1006, reason: '' });
  }
}

const key = new Uint8Array(32).fill(31);
const device: PairedDevice = {
  pairId: 'host',
  token: 't',
  contentKey: toBase64Url(key),
  relayUrl: 'https://relay.test',
  deviceName: 'phone',
  pairedAt: 1,
};
const cache = { load: async () => null, save: async () => {}, clear: async () => {} };
let client: PairClient;
let events: ClientEvents;

beforeEach(() => {
  Socket.all = [];
  direct.attempts = [];
  direct.alive = false;
  const storage = new Map<string, string>();
  vi.stubGlobal('WebSocket', Socket);
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => storage.set(k, v),
    removeItem: (k: string) => storage.delete(k),
  });
  saveDevices([{ ...device, label: 'host' }]);
  events = {
    onState: vi.fn(),
    onCatalog: vi.fn(),
    onProjects: vi.fn(),
    onProviders: vi.fn(),
    onSession: vi.fn(),
    onCommandRejected: vi.fn(),
    onFileReply: vi.fn(),
  };
  client = new PairClient({ ...device }, events, null, cache);
});
afterEach(() => {
  client.close();
  vi.unstubAllGlobals();
});

async function start() {
  client.connect();
  await vi.waitFor(() => expect(Socket.all).toHaveLength(1));
  const socket = Socket.all[0];
  socket.open();
  await vi.waitFor(() => expect(socket.sent.length).toBeGreaterThan(0));
  return socket;
}
async function payloads(socket: Socket) {
  return Promise.all(
    socket.sent.map((frame) => openFrame(key, frame) as Promise<Record<string, unknown>>)
  );
}

describe('phone 真 crypto 防重放接线', () => {
  it('relay 长时间不可用但 direct 活着，既有可信收发不中断且不等待 WS onopen', async () => {
    const socket = await start();
    const host = createFrameReplay(undefined, undefined, { role: 'host', announce: true });
    socket.receive(await host.seal(key, { type: 'replay-hello' }));
    await vi.waitFor(async () =>
      expect((await payloads(socket)).some((p) => p.type === 'replay-hello')).toBe(true)
    );
    const i = (await payloads(socket)).findIndex((p) => p.type === 'replay-hello');
    await host.open(key, socket.sent[i]);
    socket.receive(await host.seal(key, { type: 'replay-hello' }));
    client.send({ type: 'abort', sessionId: 's' });
    await vi.waitFor(async () =>
      expect((await payloads(socket)).some((p) => p.type === 'abort')).toBe(true)
    );
    direct.alive = true;
    client.nudge('network-change');
    await vi.waitFor(() => expect(Socket.all).toHaveLength(2));
    // New relay stays CONNECTING; traffic still flows over the existing direct generation.
    const before = direct.attempts.length;
    client.send({ type: 'prompt', sessionId: 's', text: 'through-direct' });
    await vi.waitFor(() => expect(direct.attempts.length).toBeGreaterThan(before));
    const last = direct.attempts.at(-1)!;
    expect((await host.open(key, last))?.trusted).toBe(true);
    direct.receive?.(await host.seal(key, { type: 'catalog', entries: [] }));
    await vi.waitFor(() => expect(events.onCatalog).toHaveBeenCalledTimes(1));
    expect(events.onCommandRejected).not.toHaveBeenCalled();
  });
  it('写与文件请求不抢跑；fresh echo 完成后原请求仅发一次，能力立即落盘', async () => {
    const socket = await start();
    const host = createFrameReplay(undefined, undefined, { role: 'host', announce: true });
    expect((await payloads(socket))[0]).not.toHaveProperty('replay');
    client.send({ type: 'prompt', sessionId: 's', text: 'queued' });
    client.send({ type: 'file-list', requestId: 'r', target: { sessionId: 's' } });
    socket.receive(await host.seal(key, { type: 'replay-hello' }));
    await vi.waitFor(async () =>
      expect((await payloads(socket)).some((p) => p.type === 'replay-hello')).toBe(true)
    );
    expect(loadDevices()[0].replayVersion).toBe(1);
    expect(
      (await payloads(socket)).some((p) => p.type === 'prompt' || p.type === 'file-list')
    ).toBe(false);
    const response = (await payloads(socket)).findIndex((p) => p.type === 'replay-hello');
    expect((await host.open(key, socket.sent[response]))?.trusted).toBe(true);
    socket.receive(await host.seal(key, { type: 'replay-hello' }));
    await vi.waitFor(async () =>
      expect((await payloads(socket)).some((p) => p.type === 'file-list')).toBe(true)
    );
    expect((await payloads(socket)).filter((p) => p.type === 'prompt')).toHaveLength(1);
    const file = socket.sent[(await payloads(socket)).findIndex((p) => p.type === 'file-list')];
    expect((await host.open(key, file))?.trusted).toBe(true);
    expect(await host.open(key, file)).toBeUndefined();

    const oldCatalog = await host.seal(key, { type: 'catalog', entries: [] });
    const live = await host.seal(key, { type: 'catalog', entries: [] });
    socket.receive(live);
    direct.receive?.(live);
    await vi.waitFor(() => expect(events.onCatalog).toHaveBeenCalledTimes(1));
    expect(direct.attempts.some((f) => Buffer.from(f).equals(Buffer.from(file)))).toBe(true);
    vi.mocked(events.onCatalog).mockClear();
    client.nudge('network-change');
    await vi.waitFor(() => expect(Socket.all).toHaveLength(2));
    const next = Socket.all[1];
    next.open();
    host.peerReset();
    next.receive(await host.seal(key, { type: 'replay-hello' }));
    await vi.waitFor(async () =>
      expect((await payloads(next)).some((p) => p.type === 'replay-hello')).toBe(true)
    );
    const helloIndex = (await payloads(next)).findIndex((p) => p.type === 'replay-hello');
    await host.open(key, next.sent[helloIndex]);
    next.receive(await host.seal(key, { type: 'replay-hello' }));
    // Wait for a trusted round trip before replaying a withheld old bootstrap response.
    client.send({ type: 'abort', sessionId: 's' });
    await vi.waitFor(async () =>
      expect((await payloads(next)).some((p) => p.type === 'abort')).toBe(true)
    );
    next.receive(oldCatalog);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(events.onCatalog).not.toHaveBeenCalled();
  });

  it('重载从持久化钉读取 requireModern，旧无 stamp 应答不能派发或解开写队列', async () => {
    saveDevices([{ ...device, label: 'host', replayVersion: 1 }]);
    client.close();
    client = new PairClient({ ...device }, events, null, cache); // deliberately stale prop
    const socket = await start();
    expect((await payloads(socket))[0]).toHaveProperty('replay.r', 'g');
    const { sealFrame } = await import('@enso/pair');
    socket.receive(await sealFrame(key, { type: 'catalog', entries: [] }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(events.onCatalog).not.toHaveBeenCalled();
  });

  it('prefix 预算耗尽结算等待者，已持久化 modern 才 fresh 重建并重连，不永久关闭', async () => {
    const socket = await start();
    client.send({ type: 'prompt', sessionId: 's', text: 'queued' });
    for (let p = 1; p <= 129; p++) {
      const nonce = new Uint8Array(12);
      nonce.fill(p, 0, 8);
      nonce[11] = 1;
      socket.receive(
        await sealFrameWithNonce(
          key,
          {
            type: 'replay-hello',
            replay: {
              r: 'h',
              p: toBase64Url(nonce.subarray(0, 8)),
              c: toBase64Url(new Uint8Array(8).fill(240)),
            },
          },
          nonce
        )
      );
    }
    await vi.waitFor(() =>
      expect(events.onCommandRejected).toHaveBeenCalledWith('prompt', 'replay state exhausted')
    );
    expect(socket.readyState).toBe(3);
    await vi.waitFor(() => expect(Socket.all).toHaveLength(2));
    const next = Socket.all[1];
    next.open();
    await vi.waitFor(() => expect(next.sent.length).toBeGreaterThan(0));
    expect((await payloads(next))[0]).toHaveProperty('replay.r', 'g');
  });
});
