import { IPC_CHANNELS } from '@shared/types/ipc';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type DesignRuntimeSink, DesignToolBroker } from './toolBroker';

interface Sent {
  channel: string;
  payload: Record<string, unknown>;
}

function sink(id: number) {
  const sent: Sent[] = [];
  let destroyed = false;
  const value: DesignRuntimeSink = {
    id,
    send: (channel, payload) => sent.push({ channel, payload: payload as Record<string, unknown> }),
    isDestroyed: () => destroyed,
  };
  return { value, sent, destroy: () => (destroyed = true) };
}

function setup(fallbackId: number | null = null) {
  const sinks = new Map<number, ReturnType<typeof sink>>();
  const add = (id: number) => {
    const s = sink(id);
    sinks.set(id, s);
    return s;
  };
  const broker = new DesignToolBroker({
    find: (id) => sinks.get(id)?.value ?? null,
    fallbackId: () => fallbackId,
  });
  return { broker, add };
}

const base = {
  sessionId: 's1',
  cwd: '/work/p',
  tool: 'vetd_status' as const,
  params: { a: 1 },
  timeoutMs: 1000,
};

const okResult = { content: [{ type: 'text', text: 'done' }] };

afterEach(() => vi.useRealTimers());

describe('DesignToolBroker', () => {
  it('rejects with NO_RUNTIME when no window registered a runtime', async () => {
    const { broker } = setup();
    await expect(broker.request(base)).rejects.toMatchObject({ code: 'NO_RUNTIME' });
  });

  it('routes to the runtime viewing the session and resolves its response', async () => {
    const { broker, add } = setup();
    const a = add(1);
    const b = add(2);
    broker.register(1, { viewingSessionId: 'other' });
    broker.register(2, { viewingSessionId: 's1' });
    const pending = broker.request(base);
    expect(a.sent).toHaveLength(0);
    const req = b.sent[0];
    expect(req.channel).toBe(IPC_CHANNELS.DESIGN_TOOL_REQUEST);
    expect(req.payload).toMatchObject({
      tool: 'vetd_status',
      params: { a: 1 },
      session: { sessionId: 's1', cwd: '/work/p' },
    });
    broker.respond(2, { requestId: req.payload.requestId, ok: true, result: okResult });
    await expect(pending).resolves.toEqual(okResult);
  });

  it('falls back to the main window runtime when nobody views the session', async () => {
    const { broker, add } = setup(7);
    const other = add(3);
    const main = add(7);
    broker.register(3, { viewingSessionId: 'x' });
    broker.register(7, { viewingSessionId: null });
    void broker.request(base).catch(() => {});
    expect(other.sent).toHaveLength(0);
    expect(main.sent).toHaveLength(1);
  });

  it('ignores responses from a different window than the one asked', async () => {
    const { broker, add } = setup();
    const a = add(1);
    add(2);
    broker.register(1, { viewingSessionId: 's1' });
    broker.register(2, { viewingSessionId: null });
    const pending = broker.request({ ...base, timeoutMs: 50 });
    const requestId = a.sent[0].payload.requestId;
    broker.respond(2, { requestId, ok: true, result: okResult });
    await expect(pending).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('times out, then tells the runtime to cancel', async () => {
    const { broker, add } = setup();
    const a = add(1);
    broker.register(1, { viewingSessionId: 's1' });
    await expect(broker.request({ ...base, timeoutMs: 20 })).rejects.toMatchObject({
      code: 'TIMEOUT',
    });
    expect(a.sent.map((s) => s.channel)).toEqual([
      IPC_CHANNELS.DESIGN_TOOL_REQUEST,
      IPC_CHANNELS.DESIGN_TOOL_CANCEL,
    ]);
  });

  it('aborts via signal and cancels remotely', async () => {
    const { broker, add } = setup();
    const a = add(1);
    broker.register(1, { viewingSessionId: 's1' });
    const controller = new AbortController();
    const pending = broker.request({ ...base, signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'ABORTED' });
    expect(a.sent.at(-1)?.channel).toBe(IPC_CHANNELS.DESIGN_TOOL_CANCEL);
  });

  it('rejects pending calls when the owning window goes away', async () => {
    const { broker, add } = setup();
    add(1);
    broker.register(1, { viewingSessionId: 's1' });
    const pending = broker.request(base);
    broker.releaseOwner(1);
    await expect(pending).rejects.toMatchObject({ code: 'NO_RUNTIME' });
    await expect(broker.request(base)).rejects.toMatchObject({ code: 'NO_RUNTIME' });
  });

  it('skips destroyed windows when routing', async () => {
    const { broker, add } = setup();
    const dead = add(1);
    const live = add(2);
    broker.register(1, { viewingSessionId: 's1' });
    broker.register(2, { viewingSessionId: null });
    dead.destroy();
    void broker.request(base).catch(() => {});
    expect(live.sent).toHaveLength(1);
  });

  it('turns a malformed tool result into a failure instead of passing it through', async () => {
    const { broker, add } = setup();
    const a = add(1);
    broker.register(1, { viewingSessionId: 's1' });
    const pending = broker.request(base);
    const requestId = a.sent[0].payload.requestId;
    broker.respond(1, { requestId, ok: true, result: { content: [{ type: 'html', x: 1 }] } });
    await expect(pending).rejects.toMatchObject({ code: 'FAILED' });
  });

  it('passes runtime errors through as FAILED with the message', async () => {
    const { broker, add } = setup();
    const a = add(1);
    broker.register(1, { viewingSessionId: 's1' });
    const pending = broker.request(base);
    const requestId = a.sent[0].payload.requestId;
    broker.respond(1, { requestId, ok: false, error: 'engine crashed' });
    await expect(pending).rejects.toMatchObject({ code: 'FAILED', message: 'engine crashed' });
  });

  it('delivers hooks to exactly one runtime, routed like tool calls', () => {
    const { broker, add } = setup();
    const a = add(1);
    const b = add(2);
    broker.register(1, { viewingSessionId: 's1' });
    broker.register(2, { viewingSessionId: 's1' });
    expect(broker.emitHook({ event: 'stop', sessionId: 's1', cwd: '/work/p' })).toBe(true);
    expect(a.sent.length + b.sent.length).toBe(1);
    expect([...a.sent, ...b.sent][0].channel).toBe(IPC_CHANNELS.DESIGN_HOOK);
  });

  describe('dedicated design windows', () => {
    it('win over a main window viewing the same session, regardless of registration order', () => {
      const { broker, add } = setup(7);
      const main = add(7);
      const dedicated = add(9);
      broker.register(9, { viewingSessionId: 's1' }, true);
      // The main window re-registers on every session switch and becomes "newest".
      broker.register(7, { viewingSessionId: 's1' });
      void broker.request(base).catch(() => {});
      expect(main.sent).toHaveLength(0);
      expect(dedicated.sent[0]?.channel).toBe(IPC_CHANNELS.DESIGN_TOOL_REQUEST);
      expect(broker.emitHook({ event: 'stop', sessionId: 's1', cwd: '/work/p' })).toBe(true);
      expect(dedicated.sent.at(-1)?.channel).toBe(IPC_CHANNELS.DESIGN_HOOK);
      expect(main.sent).toHaveLength(0);
    });

    it('never receive calls for other sessions, even as the only or newest runtime', async () => {
      const { broker, add } = setup(null);
      const dedicated = add(9);
      broker.register(9, { viewingSessionId: 'other' }, true);
      await expect(broker.request(base)).rejects.toMatchObject({ code: 'NO_RUNTIME' });
      expect(broker.emitHook({ event: 'stop', sessionId: 's1', cwd: '/work/p' })).toBe(false);
      const main = add(3);
      broker.register(3, { viewingSessionId: null });
      broker.register(9, { viewingSessionId: 'other' }, true);
      void broker.request(base).catch(() => {});
      expect(main.sent).toHaveLength(1);
      expect(dedicated.sent).toHaveLength(0);
    });

    it('lets the session fall back to the main window once its window closes', () => {
      const { broker, add } = setup(7);
      const main = add(7);
      add(9);
      broker.register(7, { viewingSessionId: null });
      broker.register(9, { viewingSessionId: 's1' }, true);
      broker.releaseOwner(9);
      void broker.request(base).catch(() => {});
      expect(main.sent).toHaveLength(1);
    });
  });
});
