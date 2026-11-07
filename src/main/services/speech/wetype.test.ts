import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createWetypeChannelPool,
  loadWetypeIdentity,
  openWetypeStream,
  saveWetypeIdentity,
  type WetypePooledChannel,
  type WetypeVoiceChannel,
  type WetypeVoicePacket,
} from './wetype';
import { fromUtf8 } from './wetypeProtocol';

const FRAME = 320;
const HEADER = '#!OPUS_RAW_V1';

function fakeChannel(
  replies: (
    packet: WetypeVoicePacket,
    index: number
  ) => {
    text?: string;
    polished?: string;
  }
) {
  const sent: WetypeVoicePacket[] = [];
  let closed = false;
  const channel: WetypeVoiceChannel = {
    send: async (packet) => {
      if (closed) throw new Error('closed');
      sent.push(packet);
      return { text: '', polished: '', ...replies(packet, sent.length - 1) };
    },
    close: () => {
      closed = true;
    },
  };
  return { channel, sent, isClosed: () => closed };
}

function fakeEncoder() {
  const state = { frames: 0, freed: false };
  return {
    state,
    create: async () => ({
      encode: (pcm: Float32Array) => {
        expect(pcm.length).toBe(FRAME);
        state.frames++;
        return Uint8Array.of(state.frames);
      },
      free: () => {
        state.freed = true;
      },
    }),
  };
}

const audio = (frames: number) => new Float32Array(frames * FRAME);

describe('wetype stream', () => {
  it('uploads six opus packets per request, headed on the first, and returns cumulative text', async () => {
    const { channel, sent } = fakeChannel((p) => (p.seq === 2 ? { text: '你好' } : {}));
    const encoder = fakeEncoder();
    const stream = openWetypeStream({
      openChannel: async () => channel,
      createEncoder: encoder.create,
      pollIntervalMs: 0,
    });
    await expect(stream.accept(audio(5))).resolves.toBe('');
    expect(sent).toHaveLength(0);
    await expect(stream.accept(audio(7))).resolves.toBe('你好');
    expect(sent.map((p) => [p.seq, p.isEnd])).toEqual([
      [1, false],
      [2, false],
    ]);
    const first = sent[0].opus!;
    expect(fromUtf8(first.subarray(0, HEADER.length))).toBe(HEADER);
    expect(first.length).toBe(HEADER.length + 3 + 6 * 3);
    expect(sent[1].opus!.length).toBe(6 * 3);
    expect(sent[1].totalBytes).toBe(first.length + 18);
  });

  it('pads the tail frame, ends the upload and polls until the polished text arrives', async () => {
    const { channel, sent, isClosed } = fakeChannel((p, i) =>
      p.seq === 0 ? (i >= 3 ? { text: '你好。', polished: '你好！' } : { text: '你好。' }) : {}
    );
    const encoder = fakeEncoder();
    const stream = openWetypeStream({
      openChannel: async () => channel,
      createEncoder: encoder.create,
      pollIntervalMs: 0,
    });
    await stream.accept(new Float32Array(FRAME + 10));
    await expect(stream.finish()).resolves.toBe('你好！');
    expect(encoder.state.frames).toBe(2);
    expect(sent.map((p) => [p.seq, p.isEnd, p.opus?.length ?? 0])).toEqual([
      [1, true, 16 + 6],
      [0, true, 0],
      [0, true, 0],
      [0, true, 0],
    ]);
    expect(isClosed()).toBe(true);
    expect(encoder.state.freed).toBe(true);
  });

  it('falls back to the streaming text when no polished text arrives', async () => {
    const { channel, sent } = fakeChannel(() => ({ text: '字' }));
    const stream = openWetypeStream({
      openChannel: async () => channel,
      createEncoder: fakeEncoder().create,
      pollIntervalMs: 0,
    });
    await stream.accept(audio(1));
    await expect(stream.finish()).resolves.toBe('字');
    expect(sent.filter((p) => p.seq === 0).length).toBeGreaterThan(1);
  });

  it('rejects accept and finish when the handshake fails', async () => {
    const stream = openWetypeStream({
      openChannel: () => Promise.reject(new Error('handshake failed')),
      createEncoder: fakeEncoder().create,
      pollIntervalMs: 0,
    });
    await expect(stream.accept(audio(6))).rejects.toThrow('handshake failed');
    await expect(stream.finish()).rejects.toThrow('handshake failed');
  });

  it('returns the channel when the encoder fails to start', async () => {
    const { channel, isClosed } = fakeChannel(() => ({}));
    const stream = openWetypeStream({
      openChannel: async () => channel,
      createEncoder: () => Promise.reject(new Error('no wasm')),
      pollIntervalMs: 0,
    });
    await expect(stream.finish()).rejects.toThrow('no wasm');
    await Promise.resolve();
    expect(isClosed()).toBe(true);
  });

  it('closes the channel on cancel and refuses further audio', async () => {
    const { channel, isClosed } = fakeChannel(() => ({}));
    const encoder = fakeEncoder();
    const stream = openWetypeStream({
      openChannel: async () => channel,
      createEncoder: encoder.create,
      pollIntervalMs: 0,
    });
    await stream.accept(audio(1));
    stream.cancel();
    await expect(stream.accept(audio(6))).rejects.toThrow('cancelled');
    expect(isClosed()).toBe(true);
    expect(encoder.state.freed).toBe(true);
  });
});

describe('wetype identity', () => {
  let dir = '';
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('persists the server-issued device and UIN and ignores malformed files', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wetype-'));
    const file = path.join(dir, 'nested', 'wetype.json');
    expect(loadWetypeIdentity(file)).toBeNull();
    saveWetypeIdentity(file, { device: 'MACdevice', uin: '8848109380590273' });
    expect(loadWetypeIdentity(file)).toEqual({ device: 'MACdevice', uin: '8848109380590273' });
    fs.writeFileSync(file, JSON.stringify({ device: 'x', uin: 'abc' }));
    expect(loadWetypeIdentity(file)).toBeNull();
    fs.writeFileSync(file, '{');
    expect(loadWetypeIdentity(file)).toBeNull();
  });
});

function pooledFake(id: number, failFirst = false) {
  const state = { id, alive: true, closed: false, sent: 0, notified: 0, notifyFails: false };
  let gate: (() => void) | null = null;
  const channel: WetypePooledChannel & { state: typeof state; hold(): void; releaseHold(): void } =
    {
      state,
      alive: () => state.alive && !state.closed,
      send: async () => {
        state.sent++;
        if (gate) await new Promise<void>((resolve) => (gate = resolve));
        if (failFirst && state.sent === 1) throw new Error('stale');
        return { text: `c${id}`, polished: '' };
      },
      notify: async () => {
        state.notified++;
        if (gate) await new Promise<void>((resolve) => (gate = resolve));
        if (state.notifyFails) throw new Error('notify failed');
      },
      close: () => {
        state.closed = true;
      },
      hold: () => {
        gate = () => {};
      },
      releaseHold: () => {
        const open = gate;
        gate = null;
        open?.();
      },
    };
  return channel;
}

function poolWith(factory: (n: number) => ReturnType<typeof pooledFake>, keepaliveMs = 60_000) {
  const opened: ReturnType<typeof pooledFake>[] = [];
  const pool = createWetypeChannelPool({
    keepaliveMs,
    open: async () => {
      const channel = factory(opened.length);
      opened.push(channel);
      return channel;
    },
  });
  return { pool, opened };
}

const packet: WetypeVoicePacket = { voiceId: 'v', seq: 1, totalBytes: 1, isEnd: false };
const tick = (ms = 0) => vi.advanceTimersByTimeAsync(ms);

describe('wetype channel pool', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  it('hands a prewarmed channel to the next lease and keeps it for reuse after close', async () => {
    const { pool, opened } = poolWith((n) => pooledFake(n));
    pool.prewarm();
    pool.prewarm();
    const first = await pool.lease();
    expect(opened).toHaveLength(1);
    await expect(first.send(packet)).resolves.toMatchObject({ text: 'c0' });
    first.close();
    await expect(first.send(packet)).rejects.toThrow('released');
    const second = await pool.lease();
    await expect(second.send(packet)).resolves.toMatchObject({ text: 'c0' });
    expect(opened).toHaveLength(1);
    expect(opened[0].state.closed).toBe(false);
  });

  it('opens a fresh channel when the spare died while idle', async () => {
    const { pool, opened } = poolWith((n) => pooledFake(n));
    pool.prewarm();
    await Promise.resolve();
    (await pool.lease()).close();
    opened[0].state.alive = false;
    const lease = await pool.lease();
    await expect(lease.send(packet)).resolves.toMatchObject({ text: 'c1' });
    expect(opened[0].state.closed).toBe(true);
  });

  it('retries the first packet on a fresh channel when the reused one fails', async () => {
    const { pool, opened } = poolWith((n) => pooledFake(n, n === 0));
    pool.prewarm();
    const lease = await pool.lease();
    await expect(lease.send(packet)).resolves.toMatchObject({ text: 'c1' });
    expect(opened[0].state.closed).toBe(true);
    lease.close();
    expect(opened[1].state.closed).toBe(false);
  });

  it('does not retry on a channel opened on demand', async () => {
    const { pool, opened } = poolWith((n) => pooledFake(n, true));
    const lease = await pool.lease();
    await expect(lease.send(packet)).rejects.toThrow('stale');
    lease.close();
    expect(opened).toHaveLength(1);
    expect(opened[0].state.closed).toBe(true);
  });

  it('closes instead of pooling a channel released mid-request', async () => {
    const { pool, opened } = poolWith((n) => pooledFake(n));
    const lease = await pool.lease();
    opened[0].hold();
    const inFlight = lease.send(packet);
    lease.close();
    expect(opened[0].state.closed).toBe(true);
    opened[0].releaseHold();
    await inFlight.catch(() => {});
    await pool.lease();
    expect(opened).toHaveLength(2);
  });

  it('keeps the idle spare alive with a notify every interval, and stops once leased', async () => {
    const { pool, opened } = poolWith((n) => pooledFake(n), 5);
    pool.prewarm();
    await tick(18);
    const beats = opened[0].state.notified;
    expect(beats).toBeGreaterThanOrEqual(2);
    const lease = await pool.lease();
    await tick(15);
    expect(opened[0].state.notified).toBe(beats);
    await expect(lease.send(packet)).resolves.toMatchObject({ text: 'c0' });
  });

  it('drops the spare when a keepalive notify fails', async () => {
    const { pool, opened } = poolWith((n) => pooledFake(n), 5);
    pool.prewarm();
    await tick();
    opened[0].state.notifyFails = true;
    await tick(10);
    expect(opened[0].state.closed).toBe(true);
    await expect((await pool.lease()).send(packet)).resolves.toMatchObject({ text: 'c1' });
  });

  it('waits for an in-flight keepalive before handing the spare out', async () => {
    const { pool, opened } = poolWith((n) => pooledFake(n), 5);
    pool.prewarm();
    await tick();
    opened[0].hold();
    await tick(8);
    expect(opened[0].state.notified).toBe(1);
    let leased = false;
    const pending = pool.lease().then((lease) => {
      leased = true;
      return lease;
    });
    await tick();
    expect(leased).toBe(false);
    opened[0].releaseHold();
    await expect((await pending).send(packet)).resolves.toMatchObject({ text: 'c0' });
  });

  it('closes the spare on dispose', async () => {
    const { pool, opened } = poolWith((n) => pooledFake(n));
    pool.prewarm();
    pool.dispose();
    await tick();
    expect(opened[0].state.closed).toBe(true);
    pool.prewarm();
    expect(opened).toHaveLength(1);
  });
});
