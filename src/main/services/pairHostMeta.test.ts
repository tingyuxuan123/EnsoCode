import { openFrame, sealFrame, toBase64Url } from '@enso/pair';
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

const hostMocks = vi.hoisted(() => ({
  socket: null as TestSocket | null,
  loadDevices: vi.fn(),
  sealPreview: null as (() => Promise<void>) | null,
}));

vi.mock('@enso/pair', async (importOriginal) => {
  const original = await importOriginal<typeof import('@enso/pair')>();
  return {
    ...original,
    attachHeartbeat: () => ({ stop: vi.fn(), probe: vi.fn() }),
    sealFrame: async (key: Uint8Array, payload: unknown) => {
      if (
        payload &&
        typeof payload === 'object' &&
        'type' in payload &&
        payload.type === 'preview-result'
      )
        await hostMocks.sealPreview?.();
      return original.sealFrame(key, payload);
    },
  };
});
vi.mock('electron', () => ({
  app: { getVersion: () => 'test' },
  powerMonitor: { on: vi.fn() },
  powerSaveBlocker: { start: vi.fn(() => 1), stop: vi.fn() },
}));
vi.mock('./agentHost', () => ({
  requestSnapshot: vi.fn(),
  setPinnedSessions: vi.fn(),
}));
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
vi.mock('./pairNetworkWatch', () => ({ startPairNetworkWatch: () => vi.fn() }));
vi.mock('./pairRelayLookup', () => ({ seedRelayHostCache: vi.fn() }));
vi.mock('./pairRelayOpen', () => ({
  openPairRelayWebSocket: () => Promise.resolve(hostMocks.socket),
}));
vi.mock('./pairStore', () => ({
  isSecureStorageAvailable: () => true,
  loadDevices: hostMocks.loadDevices,
  loadRelayHostCache: () => null,
  loadRelayUrl: () => null,
  renameDevice: (devices: unknown) => devices,
  saveDevices: vi.fn(),
  saveRelayUrl: vi.fn(),
  upsertDevice: (devices: unknown) => devices,
}));
vi.mock('./pushNotifier', () => ({
  buildPushPayload: () => null,
  clearPushSubscription: vi.fn(),
  getVapidPublicKey: () => '',
  hasPushSubscription: () => false,
  sendPush: vi.fn(),
  setPushSubscription: vi.fn(),
}));

import type { PairReply } from './pairHost';
import {
  broadcastPairFrame,
  setDeviceScope,
  setPairBotPort,
  setPairFilePort,
  setPairPreviewPort,
  startPairHost,
  stopPairHost,
  updatePairCatalog,
} from './pairHost';

describe('pairHost 目录下发', () => {
  const contentKey = new Uint8Array(32).fill(7);

  beforeEach(async () => {
    hostMocks.sealPreview = null;
    setPairFilePort(null);
    setPairPreviewPort(null);
    setPairBotPort(null);
    hostMocks.socket = {
      readyState: 1,
      binaryType: '',
      onopen: null,
      onmessage: null,
      onclose: null,
      onerror: null,
      send: vi.fn(),
      close: vi.fn(),
    };
    hostMocks.loadDevices.mockReturnValue([
      {
        pairId: 'pair-1',
        token: 'token-1',
        contentKey: toBase64Url(contentKey),
        deviceName: 'guest-desktop',
        relayUrl: 'https://relay.example.com',
        pairedAt: 1,
      },
    ]);
    startPairHost();
    await vi.waitFor(() => expect(hostMocks.socket?.onmessage).toBeTypeOf('function'));
    hostMocks.socket?.onopen?.();
  });

  afterEach(() => {
    stopPairHost();
    setPairPreviewPort(null);
    setPairFilePort(null);
    setPairBotPort(null);
  });

  const control = (type: 'peer-joined' | 'peer-left'): void => {
    hostMocks.socket?.onmessage?.({ data: JSON.stringify({ type }) });
  };

  async function sentPayloads(): Promise<Record<string, unknown>[]> {
    const calls = hostMocks.socket?.send.mock.calls ?? [];
    return Promise.all(
      calls.map(
        async ([data]) =>
          (await openFrame(contentKey, new Uint8Array(data))) as Record<string, unknown>
      )
    );
  }

  async function sentTypes(): Promise<unknown[]> {
    return (await sentPayloads()).map((payload) => payload.type);
  }

  async function receive(command: unknown): Promise<void> {
    const frame = await sealFrame(contentKey, command);
    hostMocks.socket?.onmessage?.({
      data: frame.buffer.slice(
        frame.byteOffset,
        frame.byteOffset + frame.byteLength
      ) as ArrayBuffer,
    });
  }

  function fileCatalog(): void {
    updatePairCatalog({
      catalog: [{ id: 's', title: 'Code', projectId: 'p', projectName: 'Project', status: 'idle' }],
      projects: [],
      providers: [],
      projectPaths: [],
      theme: 'dark',
    });
  }

  it('advertises preview only with its injected service and gates Code previews by current subscription/catalog', async () => {
    const handle = vi.fn(async (_pairId: string) => {});
    const release = vi.fn();
    setPairPreviewPort({ handle, release });
    fileCatalog();
    control('peer-joined');
    await vi.waitFor(async () =>
      expect((await sentPayloads()).find((frame) => frame.type === 'host-info')).toMatchObject({
        preview: true,
      })
    );
    await receive({
      type: 'preview-list',
      requestId: 'not-subscribed',
      target: { sessionId: 's' },
    });
    await vi.waitFor(async () =>
      expect(
        (await sentPayloads()).find((frame) => frame.requestId === 'not-subscribed')
      ).toMatchObject({ error: 'unavailable' })
    );
    expect(handle).not.toHaveBeenCalled();
    await receive({ type: 'subscribe', sessionId: 's' });
    await receive({ type: 'preview-list', requestId: 'allowed', target: { sessionId: 's' } });
    await vi.waitFor(() => expect(handle).toHaveBeenCalledOnce());
    expect(handle.mock.calls[0]?.[0]).toBe('pair-1');
  });

  it('releases preview on subscribe changes, peer-left and stop; rejects old async replies after reconnect', async () => {
    let pending: PairReply | undefined;
    let guard: ((target: { sessionId: string }) => boolean) | undefined;
    const release = vi.fn();
    const handle = vi.fn(async (_pair, _command, reply: PairReply, allowed) => {
      pending = reply;
      guard = allowed;
    });
    setPairPreviewPort({ handle, release });
    fileCatalog();
    control('peer-joined');
    await receive({ type: 'subscribe', sessionId: 's' });
    await receive({ type: 'preview-list', requestId: 'pending', target: { sessionId: 's' } });
    await vi.waitFor(() => expect(pending).toBeTypeOf('function'));
    release.mockClear();
    await receive({ type: 'subscribe', sessionId: 's', sync: { requestId: 'sync' } });
    await receive({ type: 'preview-frame', requestId: 'barrier', previewId: 'p' });
    await vi.waitFor(() => expect(handle).toHaveBeenCalledTimes(2));
    expect(guard?.({ sessionId: 's' })).toBe(true);
    expect(release).not.toHaveBeenCalled();
    const old = pending!;
    await receive({ type: 'subscribe', sessionId: null });
    await vi.waitFor(() => expect(release).toHaveBeenCalledWith('pair-1'));
    expect(guard?.({ sessionId: 's' })).toBe(false);
    control('peer-left');
    control('peer-joined');
    expect(await old({ type: 'preview-result', requestId: 'pending' })).toBe(false);
    stopPairHost();
    expect(release.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it('releases on scope change, relay close, catalog removal, Bot disable and unpair', async () => {
    const release = vi.fn();
    setPairPreviewPort({ handle: async () => {}, release });
    control('peer-joined');
    release.mockClear();
    expect(setDeviceScope('pair-1', 'read')).toEqual({ ok: true });
    expect(release).toHaveBeenCalledOnce();
    fileCatalog();
    await receive({ type: 'subscribe', sessionId: 's' });
    await receive({ type: 'preview-list', requestId: 'before', target: { sessionId: 's' } });
    await vi.waitFor(() => expect(release.mock.calls.length).toBeGreaterThanOrEqual(2));
    const beforeRemoval = release.mock.calls.length;
    updatePairCatalog({
      catalog: [],
      projects: [],
      providers: [],
      projectPaths: [],
      theme: 'dark',
    });
    expect(release.mock.calls.length).toBe(beforeRemoval + 1);
    broadcastPairFrame({ type: 'bot-catalog', enabled: false, bots: [] });
    expect(release.mock.calls.length).toBe(beforeRemoval + 2);
    hostMocks.socket?.onclose?.({ code: 1006 });
    expect(release.mock.calls.length).toBeGreaterThan(beforeRemoval + 1);
    hostMocks.socket?.onmessage?.({ data: JSON.stringify({ type: 'revoked' }) });
    expect(release).toHaveBeenCalledWith('pair-1');
  });

  it('checks the service authority guard after encryption and failed sends revoke the preview', async () => {
    let finish!: () => void;
    let started = false;
    let authorized = true;
    hostMocks.sealPreview = () =>
      new Promise<void>((resolve) => {
        started = true;
        finish = resolve;
      });
    const release = vi.fn();
    setPairPreviewPort({
      handle: async (_pair, _command, reply) => {
        await reply(
          { type: 'preview-result', requestId: 'encrypted', previewId: 'p' },
          () => authorized
        );
      },
      release,
    });
    control('peer-joined');
    await receive({ type: 'preview-frame', requestId: 'encrypted', previewId: 'p' });
    await vi.waitFor(() => expect(started).toBe(true));
    release.mockClear();
    authorized = false;
    finish();
    await vi.waitFor(() => expect(release).toHaveBeenCalledOnce());
    expect((await sentPayloads()).some((frame) => frame.requestId === 'encrypted')).toBe(false);
  });

  it('advertises file support only with an injected file service', async () => {
    setPairFilePort({ handle: async () => {} });
    control('peer-joined');
    await vi.waitFor(async () =>
      expect((await sentPayloads()).find((frame) => frame.type === 'host-info')).toMatchObject({
        files: true,
      })
    );
  });

  it('omits the file capability when no service is registered', async () => {
    control('peer-joined');
    await vi.waitFor(async () => expect(await sentTypes()).toContain('host-info'));
    expect((await sentPayloads()).find((frame) => frame.type === 'host-info')).not.toHaveProperty(
      'files'
    );
  });

  it('requires a known currently subscribed Code session, but Bot group files need no subscription', async () => {
    const handle = vi.fn(async () => {});
    setPairFilePort({ handle });
    fileCatalog();
    control('peer-joined');
    await receive({ type: 'file-list', requestId: 'not-subscribed', target: { sessionId: 's' } });
    await vi.waitFor(async () =>
      expect(
        (await sentPayloads()).find((frame) => frame.requestId === 'not-subscribed')
      ).toMatchObject({ error: 'unavailable' })
    );
    expect(handle).not.toHaveBeenCalled();
    await receive({ type: 'subscribe', sessionId: 'unknown' });
    await receive({ type: 'file-list', requestId: 'unknown', target: { sessionId: 'unknown' } });
    await vi.waitFor(async () =>
      expect((await sentPayloads()).find((frame) => frame.requestId === 'unknown')).toMatchObject({
        error: 'unavailable',
      })
    );
    expect(handle).not.toHaveBeenCalled();
    await receive({ type: 'subscribe', sessionId: 's' });
    await receive({ type: 'file-list', requestId: 'allowed', target: { sessionId: 's' } });
    await vi.waitFor(() => expect(handle).toHaveBeenCalledTimes(1));
    handle.mockClear();
    setPairBotPort({
      handle: async () => {},
      resync: () => {},
      sessionAccess: () => 'deny',
      coldSnapshot: async () => null,
      sessionTitle: () => undefined,
      observe: () => {},
    });
    await receive({ type: 'file-list', requestId: 'denied', target: { sessionId: 's' } });
    await vi.waitFor(async () =>
      expect((await sentPayloads()).find((frame) => frame.requestId === 'denied')).toMatchObject({
        error: 'unavailable',
      })
    );
    expect(handle).not.toHaveBeenCalled();
    await receive({
      type: 'file-list',
      requestId: 'bot',
      target: { bot: { chatId: '11111111-1111-4111-8111-111111111111', entryId: 'entry' } },
    });
    await vi.waitFor(() => expect(handle).toHaveBeenCalledTimes(1));
  });

  it('does not block incoming frames and drops stale replies after subscription changes or disconnect', async () => {
    const replies: PairReply[] = [];
    let finish: (() => void) | undefined;
    const handle = vi.fn(async (_command, reply: PairReply) => {
      replies.push(reply);
      if (replies.length === 1)
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
    });
    setPairFilePort({ handle });
    fileCatalog();
    control('peer-joined');
    await receive({ type: 'subscribe', sessionId: 's' });
    await receive({ type: 'file-list', requestId: 'first', target: { sessionId: 's' } });
    await vi.waitFor(() => expect(handle).toHaveBeenCalledTimes(1));
    await receive({ type: 'subscribe', sessionId: null });
    await receive({
      type: 'file-list',
      requestId: 'bot',
      target: { bot: { chatId: '11111111-1111-4111-8111-111111111111', entryId: 'entry' } },
    });
    await vi.waitFor(async () =>
      expect((await sentPayloads()).find((frame) => frame.requestId === 'bot')).toMatchObject({
        error: 'busy',
      })
    );
    expect(handle).toHaveBeenCalledTimes(1);
    await receive({ type: 'subscribe', sessionId: 's' });
    expect(await replies[0]({ type: 'file-list-result', requestId: 'first', files: [] })).toBe(
      false
    );
    finish?.();
    await receive({ type: 'file-list', requestId: 'second', target: { sessionId: 's' } });
    await vi.waitFor(() => expect(handle).toHaveBeenCalledTimes(2));
    control('peer-left');
    expect(await replies[1]({ type: 'file-list-result', requestId: 'second', files: [] })).toBe(
      false
    );
    expect(
      (await sentPayloads()).some(
        (frame) =>
          frame.type === 'file-list-result' && ['first', 'second'].includes(String(frame.requestId))
      )
    ).toBe(false);
  });

  it('keeps pending file replies valid when the same session resubscribes for cursor sync', async () => {
    let pending: PairReply | undefined;
    const handle = vi.fn(async (_command, reply: PairReply) => {
      pending = reply;
    });
    setPairFilePort({ handle });
    fileCatalog();
    control('peer-joined');
    await receive({ type: 'subscribe', sessionId: 's' });
    await receive({
      type: 'file-read',
      requestId: 'chunk',
      target: { sessionId: 's' },
      fileId: 'a'.repeat(64),
      offset: 0,
    });
    await vi.waitFor(() => expect(pending).toBeTypeOf('function'));
    const firstReply = pending;
    await receive({ type: 'subscribe', sessionId: 's', sync: { requestId: 'resync' } });
    await receive({ type: 'file-list', requestId: 'after-sync', target: { sessionId: 's' } });
    await vi.waitFor(() => expect(handle).toHaveBeenCalledTimes(2));
    expect(
      await firstReply?.({
        type: 'file-read-result',
        requestId: 'chunk',
        data: '',
        offset: 0,
        size: 0,
        name: 'empty',
      })
    ).toBe(true);
  });

  it('caps file work to one operation and old connection completion cannot unlock a newer operation', async () => {
    const finishes: Array<() => void> = [];
    const handle = vi.fn(async () => {
      await new Promise<void>((resolve) => finishes.push(resolve));
    });
    setPairFilePort({ handle });
    fileCatalog();
    control('peer-joined');
    const target = { bot: { chatId: '11111111-1111-4111-8111-111111111111', entryId: 'entry' } };
    await receive({ type: 'file-list', requestId: 'old', target });
    await vi.waitFor(() => expect(handle).toHaveBeenCalledTimes(1));
    await receive({ type: 'file-list', requestId: 'flood', target });
    await vi.waitFor(async () =>
      expect((await sentPayloads()).find((frame) => frame.requestId === 'flood')).toMatchObject({
        error: 'busy',
      })
    );
    expect(handle).toHaveBeenCalledTimes(1);
    control('peer-left');
    control('peer-joined');
    await receive({ type: 'file-list', requestId: 'new', target });
    await vi.waitFor(() => expect(handle).toHaveBeenCalledTimes(2));
    finishes[0]();
    await receive({ type: 'file-list', requestId: 'still-busy', target });
    await vi.waitFor(async () =>
      expect(
        (await sentPayloads()).find((frame) => frame.requestId === 'still-busy')
      ).toMatchObject({ error: 'busy' })
    );
    expect(handle).toHaveBeenCalledTimes(2);
    finishes[1]();
  });

  it('rechecks Main target authority after async work, including root changes while the target remains accessible', async () => {
    let key = 'root-and-owner-v1';
    let pending: PairReply | undefined;
    setPairFilePort({
      handle: async (_command, reply) => {
        pending = reply;
      },
      canAccess: () => true,
      accessKey: () => key,
    });
    fileCatalog();
    control('peer-joined');
    await receive({ type: 'subscribe', sessionId: 's' });
    await receive({ type: 'file-list', requestId: 'old-root', target: { sessionId: 's' } });
    await vi.waitFor(() => expect(pending).toBeTypeOf('function'));
    key = 'root-and-owner-v2';
    expect(await pending?.({ type: 'file-list-result', requestId: 'old-root', files: [] })).toBe(
      false
    );
  });

  it('authorization I/O failures return unavailable without wedging file admission', async () => {
    const handle = vi.fn(async () => {});
    const accessKey = vi.fn(() => 'available');
    accessKey.mockImplementationOnce(() => {
      throw new Error('offline');
    });
    setPairFilePort({ handle, canAccess: () => true, accessKey });
    fileCatalog();
    control('peer-joined');
    const target = { bot: { chatId: '11111111-1111-4111-8111-111111111111', entryId: 'entry' } };
    await receive({ type: 'file-list', requestId: 'offline', target });
    await vi.waitFor(async () =>
      expect((await sentPayloads()).find((frame) => frame.requestId === 'offline')).toMatchObject({
        error: 'unavailable',
      })
    );
    await receive({ type: 'file-list', requestId: 'online', target });
    await vi.waitFor(() => expect(handle).toHaveBeenCalledTimes(1));
  });

  it('对端刷新后重新进房，模型表必须重发（内存已空，不能按上次进房的指纹跳过）', async () => {
    control('peer-joined');
    const providers = [{ id: 'p1', name: 'Provider', models: [{ id: 'm1', label: 'Model' }] }];
    updatePairCatalog({
      catalog: [],
      projects: [{ id: 'proj-1', name: 'demo', path: '/tmp/demo' }],
      providers,
      projectPaths: [{ id: 'proj-1', path: '/tmp/demo' }],
      theme: 'dark',
    });
    await vi.waitFor(async () => expect(await sentTypes()).toContain('appearance'));
    expect(await sentTypes()).toContain('providers');
    await new Promise((resolve) => setTimeout(resolve, 20));

    hostMocks.socket?.send.mockClear();
    control('peer-left');
    control('peer-joined');

    await vi.waitFor(async () => expect(await sentTypes()).toContain('host-info'));
    expect(await sentTypes()).toContain('projects');
    expect((await sentPayloads()).find((payload) => payload.type === 'providers')).toMatchObject({
      providers,
    });
  });

  it('同一次进房内对端再要目录，不重打模型表', async () => {
    control('peer-joined');
    updatePairCatalog({
      catalog: [],
      projects: [],
      providers: [{ id: 'p1', name: 'Provider', models: [{ id: 'm1' }] }],
      projectPaths: [],
      theme: 'dark',
    });
    await vi.waitFor(async () => expect(await sentTypes()).toContain('providers'));
    await new Promise((resolve) => setTimeout(resolve, 20));

    hostMocks.socket?.send.mockClear();
    const frame = await sealFrame(contentKey, { type: 'snapshot' });
    hostMocks.socket?.onmessage?.({
      data: frame.buffer.slice(
        frame.byteOffset,
        frame.byteOffset + frame.byteLength
      ) as ArrayBuffer,
    });
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(await sentTypes()).not.toContain('providers');
  });
});
