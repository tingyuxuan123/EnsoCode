import { createFrameReplay, openFrame, toBase64Url } from '@enso/pair';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface TestSocket {
  readyState: number;
  binaryType: string;
  onopen: (() => void) | null;
  onmessage: ((event: { data: string | ArrayBuffer }) => void) | null;
  onclose: ((event: { code: number }) => void) | null;
  onerror: (() => void) | null;
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}

const mocks = vi.hoisted(() => ({
  sockets: [] as TestSocket[],
  networkChange: null as (() => void) | null,
  device: null as Record<string, unknown> | null,
  directAlive: false,
  directFrames: [] as Uint8Array[],
  directReceive: null as ((frame: Uint8Array) => void) | null,
}));

function makeSocket(): TestSocket {
  // close() 只进 CLOSING，不触发 onclose：模拟半开链关闭握手永远等不到回应
  const socket: TestSocket = {
    readyState: 0,
    binaryType: '',
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
    send: vi.fn(),
    close: vi.fn(() => {
      socket.readyState = 2;
    }),
  };
  return socket;
}

vi.mock('@enso/pair', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@enso/pair')>();
  return {
    ...actual,
    attachHeartbeat: () => ({ stop: vi.fn(), probe: vi.fn() }),
    DirectLink: class extends actual.DirectLink {
      constructor(deps: import('@enso/pair').DirectLinkDeps) {
        super(deps);
        mocks.directReceive = deps.onFrame;
      }
      transport() {
        return mocks.directAlive ? ('direct' as const) : super.transport();
      }
      send(frame: Uint8Array) {
        if (!mocks.directAlive) return false;
        mocks.directFrames.push(frame);
        return true;
      }
      peerGone() {
        mocks.directAlive = false;
        super.peerGone();
      }
    },
  };
});
vi.mock('electron', () => ({
  app: { getVersion: () => 'test', getPath: () => '/tmp' },
  powerMonitor: { on: vi.fn() },
  powerSaveBlocker: { start: vi.fn(() => 1), stop: vi.fn() },
  safeStorage: { isEncryptionAvailable: () => true },
}));
vi.mock('./agentHost', () => ({ requestSnapshot: vi.fn(), setPinnedSessions: vi.fn() }));
vi.mock('./macosSystemSleepAssertion', () => ({
  MacosSystemSleepAssertion: class {
    start(): void {}
    stop(): void {}
  },
}));
vi.mock('./notifications', () => ({ readNotifyMainAgentOnly: () => false }));
vi.mock('./pairDirectConfig', () => ({ PAIR_DIRECT_ENABLED: false, PAIR_STUN_SERVERS: [] }));
vi.mock('./pairDirectPeer', () => ({
  isDirectPeerAvailable: () => false,
  mainDirectPeerFactory: null,
  preloadDirectPeer: () => Promise.resolve(),
}));
vi.mock('./pairMetaFlush', () => ({
  bumpPairMetaEpoch: vi.fn(),
  flushChangedMeta: vi.fn(async () => ({})),
  requestPairMeta: vi.fn(),
}));
vi.mock('./pairNetworkWatch', () => ({
  startPairNetworkWatch: ({ onChange }: { onChange: () => void }) => {
    mocks.networkChange = onChange;
    return vi.fn();
  },
}));
vi.mock('./pairRelayLookup', () => ({ seedRelayHostCache: vi.fn() }));
vi.mock('./pairRelayOpen', () => ({
  openPairRelayWebSocket: () => {
    const socket = makeSocket();
    mocks.sockets.push(socket);
    return Promise.resolve(socket);
  },
}));
vi.mock('./pairStore', () => ({
  isSecureStorageAvailable: () => true,
  loadDevices: () => [mocks.device],
  loadRelayHostCache: () => null,
  loadRelayUrl: () => null,
  renameDevice: (devices: unknown) => devices,
  saveDevices: vi.fn(),
  saveRelayUrl: vi.fn(),
  upsertDevice: (devices: unknown) => devices,
}));
vi.mock('./nodeStore', () => ({
  adoptHostname: vi.fn(),
  loadNodes: () => [{ ...mocks.device, nodeId: mocks.device?.pairId, label: 'node' }],
  removeNode: (nodes: unknown) => nodes,
  renameNode: (nodes: unknown) => nodes,
  saveNodes: vi.fn(),
  upsertNode: (nodes: unknown) => nodes,
}));
vi.mock('./pushNotifier', () => ({
  buildPushPayload: () => null,
  clearPushSubscription: vi.fn(),
  getVapidPublicKey: () => '',
  hasPushSubscription: () => false,
  sendPush: vi.fn(),
  setPushSubscription: vi.fn(),
}));

import { startPairGuest, stopPairGuest } from './pairGuest';
import { startPairHost, stopPairHost } from './pairHost';

const sides = [
  { name: 'pairHost', start: startPairHost, stop: stopPairHost },
  { name: 'pairGuest', start: startPairGuest, stop: stopPairGuest },
];

describe('pairGuest replay 接线', () => {
  const key = new Uint8Array(32).fill(7);
  let guest: typeof import('./pairGuest');
  beforeEach(async () => {
    vi.resetModules();
    guest = await import('./pairGuest');
    mocks.sockets = [];
    mocks.device = {
      pairId: 'pair-1',
      token: 't',
      contentKey: toBase64Url(key),
      relayUrl: 'https://relay.test',
      pairedAt: 1,
    };
    guest.startPairGuest();
    await vi.waitFor(() => expect(mocks.sockets).toHaveLength(1));
    mocks.sockets[0].readyState = 1;
    mocks.sockets[0].onopen?.();
    mocks.sockets[0].onmessage?.({ data: JSON.stringify({ type: 'host-online' }) });
  });
  afterEach(() => {
    guest.stopPairGuest();
    vi.useRealTimers();
  });

  async function payloads() {
    return Promise.all(
      mocks.sockets[0].send.mock.calls.map(
        async ([data]) => openFrame(key, new Uint8Array(data)) as Promise<Record<string, unknown>>
      )
    );
  }

  it('初始请求无 stamp，写请求等真实 fresh echo 后只发一次，重复下行不重派发', async () => {
    const socket = mocks.sockets[0];
    const peer = createFrameReplay(undefined, undefined, { announce: true });
    const message = vi.fn();
    guest.setNodesMessageListener(message);
    const pending = guest.sendToNode('pair-1', { type: 'prompt', sessionId: 's', text: 'queued' });
    await vi.waitFor(async () =>
      expect((await payloads()).some((p) => p.type === 'snapshot')).toBe(true)
    );
    expect((await payloads()).find((p) => p.type === 'snapshot')).not.toHaveProperty('replay');
    expect((await payloads()).some((p) => p.type === 'prompt')).toBe(false);
    socket.onmessage?.({
      data: (await peer.seal(key, { type: 'replay-hello' })).slice().buffer as ArrayBuffer,
    });
    await vi.waitFor(async () =>
      expect((await payloads()).some((p) => p.type === 'replay-hello')).toBe(true)
    );
    const helloIndex = (await payloads()).findIndex((p) => p.type === 'replay-hello');
    expect(
      (await peer.open(key, new Uint8Array(socket.send.mock.calls[helloIndex][0])))?.trusted
    ).toBe(true);
    socket.onmessage?.({
      data: (await peer.seal(key, { type: 'replay-hello' })).slice().buffer as ArrayBuffer,
    });
    expect(await pending).toEqual({ ok: true });
    expect((await payloads()).filter((p) => p.type === 'prompt')).toHaveLength(1);
    const catalog = await peer.seal(key, { type: 'catalog', entries: [] });
    socket.onmessage?.({ data: catalog.slice().buffer as ArrayBuffer });
    socket.onmessage?.({ data: catalog.slice().buffer as ArrayBuffer });
    await vi.waitFor(() => expect(message).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(message).toHaveBeenCalledTimes(1);
  });

  it('握手队列容量、超时与连接失效都结算 Promise，不跨代发送', async () => {
    vi.useFakeTimers();
    const writes = Array.from({ length: 64 }, () =>
      guest.sendToNode('pair-1', { type: 'abort', sessionId: 's' })
    );
    expect(await guest.sendToNode('pair-1', { type: 'abort', sessionId: 's' })).toEqual({
      ok: false,
      error: 'handshake queue full',
    });
    await vi.advanceTimersByTimeAsync(10_001);
    expect(await Promise.all(writes)).toEqual(
      Array.from({ length: 64 }, () => ({ ok: false, error: 'handshake timeout' }))
    );
    const pending = guest.sendToNode('pair-1', { type: 'abort', sessionId: 's' });
    mocks.sockets[0].onmessage?.({ data: JSON.stringify({ type: 'host-offline' }) });
    expect(await pending).toEqual({ ok: false, error: 'connection changed' });
  });
});

describe.each(['host', 'guest'] as const)('pair %s direct 在 relay 重连期间保持认证', (role) => {
  const key = new Uint8Array(32).fill(7);
  let hostModule: typeof import('./pairHost');
  let guestModule: typeof import('./pairGuest');
  beforeEach(async () => {
    vi.resetModules();
    hostModule = await import('./pairHost');
    guestModule = await import('./pairGuest');
    mocks.directAlive = false;
    mocks.directFrames = [];
    mocks.sockets = [];
    mocks.device = {
      pairId: 'pair-1',
      token: 't',
      contentKey: toBase64Url(key),
      relayUrl: 'https://relay.test',
      pairedAt: 1,
      replayVersion: 1,
    };
    if (role === 'host') hostModule.startPairHost();
    else guestModule.startPairGuest();
    await vi.waitFor(() => expect(mocks.sockets).toHaveLength(1));
    mocks.sockets[0].readyState = 1;
    mocks.sockets[0].onopen?.();
  });
  afterEach(() => {
    mocks.directAlive = false;
    hostModule.stopPairHost();
    guestModule.stopPairGuest();
  });

  it('新 relay 一直 CONNECTING，direct 新帧仍可信处理且上行不等待 relay', async () => {
    const socket = mocks.sockets[0];
    const peer = createFrameReplay(undefined, undefined, {
      role: role === 'host' ? 'guest' : 'host',
      announce: role === 'guest',
      requireModern: true,
    });
    let consumed = 0;
    async function readSent() {
      for (; consumed < socket.send.mock.calls.length; consumed++)
        await peer.open(key, new Uint8Array(socket.send.mock.calls[consumed][0]));
    }
    await vi.waitFor(() => expect(socket.send.mock.calls.length).toBeGreaterThan(0));
    await readSent();
    socket.onmessage?.({
      data: (await peer.seal(key, { type: 'replay-hello' })).slice().buffer as ArrayBuffer,
    });
    await vi.waitFor(() => expect(socket.send.mock.calls.length).toBeGreaterThan(consumed));
    await readSent();
    socket.onmessage?.({
      data: (await peer.seal(key, { type: 'replay-hello' })).slice().buffer as ArrayBuffer,
    });
    const effect = vi.fn();
    hostModule.setPairAgentBridge({
      prompt: effect,
      steer: vi.fn(),
      abort: vi.fn(),
      respondApproval: vi.fn(),
      respondAsk: vi.fn(),
      spawn: vi.fn(),
    });
    guestModule.setNodesMessageListener(effect);
    await new Promise((resolve) => setTimeout(resolve, 20));
    mocks.directAlive = true;
    socket.readyState = 3;
    socket.onclose?.({ code: 1006 });
    await vi.waitFor(() => expect(mocks.sockets).toHaveLength(2));
    const inbound =
      role === 'host'
        ? { type: 'prompt', sessionId: 's', text: 'over-direct' }
        : { type: 'catalog', entries: [] };
    mocks.directReceive?.(await peer.seal(key, inbound));
    await vi.waitFor(() => expect(effect).toHaveBeenCalledTimes(1));
    if (role === 'guest') {
      expect(
        await guestModule.sendToNode('pair-1', {
          type: 'prompt',
          sessionId: 's',
          text: 'over-direct',
        })
      ).toEqual({ ok: true });
      expect((await peer.open(key, mocks.directFrames.at(-1)!))?.trusted).toBe(true);
    }
  });
});

describe.each(sides)('$name 中继重连', ({ start, stop }) => {
  beforeEach(async () => {
    vi.useFakeTimers();
    mocks.sockets = [];
    mocks.device = {
      pairId: 'pair-1',
      token: 'token-1',
      contentKey: toBase64Url(new Uint8Array(32).fill(7)),
      deviceName: 'device',
      relayUrl: 'https://relay.example.com',
      pairedAt: 1,
    };
    start();
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.sockets).toHaveLength(1);
  });

  afterEach(() => {
    stop();
    vi.useRealTimers();
  });

  it('握手一直卡在 CONNECTING 时超时拆链并重连', async () => {
    await vi.advanceTimersByTimeAsync(10_000);
    expect(mocks.sockets[0]?.close).toHaveBeenCalled();
    expect(mocks.sockets.length).toBeGreaterThanOrEqual(2);
  });

  it('握手成功后不触发连接超时', async () => {
    const socket = mocks.sockets[0] as TestSocket;
    socket.readyState = 1;
    socket.onopen?.();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(socket.close).not.toHaveBeenCalled();
    expect(mocks.sockets).toHaveLength(1);
  });

  it('网络变化替换旧链时不等 close 事件就重连', async () => {
    const socket = mocks.sockets[0] as TestSocket;
    socket.readyState = 1;
    socket.onopen?.();
    mocks.networkChange?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(socket.close).toHaveBeenCalled();
    expect(mocks.sockets).toHaveLength(2);
  });
});
