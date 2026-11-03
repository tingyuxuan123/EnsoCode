import { describe, expect, it, vi } from 'vitest';
import { generateContentKey, openFrame, sealFrame, sealFrameWithNonce } from './crypto';
import { toBase64Url } from './encoding';
import { createFrameReplay, nextReplayCounter } from './replay';

const key = generateContentKey();
const hello = { type: 'replay-hello' };
const write = { type: 'prompt', sessionId: 's', text: 'once' };
const host = () => createFrameReplay(undefined, openFrame, { announce: true });

async function handshake(a = host(), b = createFrameReplay()) {
  await b.open(key, await a.seal(key, hello));
  await a.open(key, await b.seal(key, hello));
  await b.open(key, await a.seal(key, hello));
  return { a, b };
}

async function stampFrame(prefix: number, challenge: string, counter: number, echo?: string) {
  const nonce = new Uint8Array(12);
  nonce.fill(prefix, 0, 8);
  new DataView(nonce.buffer).setUint32(8, counter);
  return sealFrameWithNonce(
    key,
    {
      ...write,
      replay: {
        r: 'g',
        p: toBase64Url(nonce.subarray(0, 8)),
        c: challenge,
        ...(echo ? { e: echo } : {}),
      },
    },
    nonce
  );
}

describe('pair 帧防重放', () => {
  it('跨进程自己的旧帧仍按角色拒绝，不能把本端旧业务当对端或钉能力', async () => {
    const oldHost = host();
    const frame = await oldHost.seal(key, hello);
    const observe = vi.fn();
    const restartedHost = createFrameReplay(undefined, undefined, {
      role: 'host',
      announce: true,
      onModern: observe,
    });
    expect(await restartedHost.open(key, frame)).toBeUndefined();
    expect(observe).not.toHaveBeenCalled();
    expect(restartedHost.takeHello()).toBe(true); // its own proactive announcement only
    expect(restartedHost.takeHello()).toBe(false);
  });

  it('能力钉住后新实例要求 modern，不接受去 stamp/旧无方向 stamp 降级', async () => {
    const observe = vi.fn();
    const guest = createFrameReplay(undefined, undefined, { onModern: observe });
    await guest.open(key, await host().seal(key, hello));
    expect(observe).toHaveBeenCalledTimes(1);
    const restarted = createFrameReplay(undefined, undefined, { requireModern: true });
    expect(await restarted.open(key, await sealFrame(key, write))).toBeUndefined();
    expect(restarted.isReady()).toBe(false);
    expect(
      ((await openFrame(key, await restarted.seal(key, hello))) as { replay: { r: string } }).replay
        .r
    ).toBe('g');
  });

  it('peerReset 主动补 hello，正常多次重连不累计挑战内存或突然耗尽', async () => {
    const { a } = await handshake();
    a.takeHello();
    a.peerReset();
    expect(a.takeHello()).toBe(true);
    for (let i = 0; i < 257; i++) a.peerReset();
    expect(a.isFailed()).toBe(false);
    expect(a.isReady()).toBe(false);
    expect(a.takeHello()).toBe(true);
  });
  it('guest 首帧不加 replay 字段；旧端兼容只是尽力接收，不提供完整防重放', async () => {
    const guest = createFrameReplay();
    const request = { type: 'file-list', requestId: 'r', target: { projectId: 'p' } };
    expect(await openFrame(key, await guest.seal(key, request))).toEqual(request);
    const legacy = await sealFrame(key, { type: 'catalog', entries: [] });
    expect(await guest.open(key, legacy)).toEqual({
      payload: { type: 'catalog', entries: [] },
      trusted: true,
    });
    expect(await guest.open(key, legacy)).toBeDefined();
  });

  it('握手前 stamp 不可信，回声匹配 fresh challenge 后才 ready', async () => {
    const a = host();
    const b = createFrameReplay();
    expect(b.isReady()).toBe(false);
    expect(await b.open(key, await a.seal(key, hello))).toEqual({ payload: hello, trusted: false });
    expect(b.isReady()).toBe(false);
    expect(await a.open(key, await b.seal(key, hello))).toEqual({ payload: hello, trusted: true });
    expect(await b.open(key, await a.seal(key, hello))).toEqual({ payload: hello, trusted: true });
    expect(b.isReady()).toBe(true);
  });

  it('明文 peerReset 不清窗口、不降级 legacy，同一帧不能重投递', async () => {
    const { a, b } = await handshake();
    const frame = await b.seal(key, write);
    expect((await a.open(key, frame))?.trusted).toBe(true);
    a.peerReset();
    expect(await a.open(key, frame)).toBeUndefined();
    expect(await a.open(key, await sealFrame(key, write))).toBeUndefined();
  });

  it('reset 后同 prefix 重新证明也不能把扣留的旧 echo 写帧变为 trusted', async () => {
    const { a, b } = await handshake();
    const withheld = await b.seal(key, write);
    a.peerReset();
    await handshake(a, b);
    expect((await a.open(key, withheld))?.trusted).toBe(false);
    expect((await a.open(key, await b.seal(key, write)))?.trusted).toBe(true);
  });

  it('64 位窗口允许乱序一次，窗口外丢弃', async () => {
    const { a, b } = await handshake();
    const frames = await Promise.all(Array.from({ length: 66 }, () => b.seal(key, write)));
    expect(await a.open(key, frames[65])).toBeDefined();
    expect(await a.open(key, frames[2])).toBeDefined();
    expect(await a.open(key, frames[2])).toBeUndefined();
    expect(await a.open(key, frames[1])).toBeUndefined();
  });

  it('反射自己的 prefix 或 challenge 不启动握手、不影响已认证 peer', async () => {
    const a = host();
    a.takeHello();
    const own = await a.seal(key, hello);
    expect(await a.open(key, own)).toBeUndefined();
    expect(a.takeHello()).toBe(false);
    const ownBody = (await openFrame(key, own)) as { replay: { c: string } };
    expect(await a.open(key, await stampFrame(33, ownBody.replay.c, 1))).toBeUndefined();
    const { b } = await handshake(a);
    expect((await a.open(key, await b.seal(key, write)))?.trusted).toBe(true);
  });

  it('同一 challenge 不能切换 peer；A→B→A 各窗口保留，旧计数不能复活', async () => {
    const { a, b } = await handshake();
    const old = await b.seal(key, write);
    await a.open(key, old);
    const c = createFrameReplay();
    await c.open(key, await a.seal(key, hello));
    expect((await a.open(key, await c.seal(key, hello)))?.trusted).toBe(false);
    a.peerReset();
    await handshake(a, c);
    a.peerReset();
    await handshake(a, b);
    expect(await a.open(key, old)).toBeUndefined();
  });

  it('重复/乱序旧 challenge 不回滚正在发送的 echo，未知 prefix 不改变已认证身份', async () => {
    const { a, b } = await handshake();
    const old = await b.seal(key, hello);
    b.peerReset();
    await a.open(key, await b.seal(key, hello));
    const echo = ((await openFrame(key, await a.seal(key, hello))) as { replay: { e: string } })
      .replay.e;
    await a.open(key, old);
    expect(
      ((await openFrame(key, await a.seal(key, hello))) as { replay: { e: string } }).replay.e
    ).toBe(echo);
    await a.open(key, await stampFrame(34, toBase64Url(new Uint8Array(8).fill(35)), 1));
    expect((await a.open(key, await b.seal(key, write)))?.trusted).toBe(true);
  });

  it('见过 stamp 后 reset 也不能把未认证 stamp 的业务当 legacy 写入', async () => {
    const a = host();
    const announced = await stampFrame(40, toBase64Url(new Uint8Array(8).fill(41)), 1);
    expect((await a.open(key, announced))?.trusted).toBe(false);
    a.peerReset();
    expect(await a.open(key, await sealFrame(key, write))).toBeUndefined();
  });

  it('坏 stamp、解密失败与重复帧不污染能力/hello/窗口', async () => {
    const a = host();
    a.takeHello();
    const bad = await sealFrame(key, { ...write, replay: { p: 'bad', c: null } });
    expect(await a.open(key, bad)).toBeUndefined();
    expect(a.takeHello()).toBe(false);
    expect(await a.open(key, await sealFrame(key, write))).toBeDefined();
    const { b } = await handshake(a);
    a.takeHello();
    const frame = await b.seal(key, write);
    const tampered = frame.slice();
    tampered[tampered.length - 1] ^= 1;
    await expect(a.open(key, tampered)).rejects.toThrow();
    expect((await a.open(key, frame))?.trusted).toBe(true);
    expect(await a.open(key, frame)).toBeUndefined();
    expect(a.takeHello()).toBe(false);
  });

  it('并发 open 去重；await 跨 peerReset/current guard 的结果不更新状态', async () => {
    const { a, b } = await handshake();
    const frame = await b.seal(key, write);
    expect(
      (await Promise.all([a.open(key, frame), a.open(key, frame)])).filter(Boolean)
    ).toHaveLength(1);
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slow = createFrameReplay(undefined, async (k, f) => {
      await gate;
      return openFrame(k, f);
    });
    const pending = slow.open(key, await b.seal(key, hello));
    slow.peerReset();
    release();
    expect(await pending).toBeUndefined();
    expect(slow.takeHello()).toBe(false);
    expect(await slow.open(key, await b.seal(key, hello), () => false)).toBeUndefined();
    expect(slow.takeHello()).toBe(false);
  });

  it('发送 counter 在 await 前分配且 reset 不回头，32bit 耗尽 fail closed', async () => {
    const seal = vi.fn((k: Uint8Array, p: unknown, n?: Uint8Array) =>
      n ? sealFrameWithNonce(k, p, n) : sealFrame(k, p)
    );
    const a = createFrameReplay(seal, openFrame, { announce: true });
    const frames = await Promise.all([a.seal(key, hello), a.seal(key, hello)]);
    a.peerReset();
    frames.push(await a.seal(key, hello));
    expect(frames.map((f) => new DataView(f.buffer, f.byteOffset + 9, 4).getUint32(0))).toEqual([
      1, 2, 3,
    ]);
    expect(nextReplayCounter(0xfffffffe)).toBe(0xffffffff);
    expect(() => nextReplayCounter(0xffffffff)).toThrow();
  });

  it('prefix 状态预算耗尽后 fail closed，不淘汰窗口重新接收旧帧', async () => {
    const a = host();
    const first = await stampFrame(1, toBase64Url(new Uint8Array(8).fill(201)), 1);
    await a.open(key, first);
    for (let p = 2; p <= 129; p++)
      await a.open(key, await stampFrame(p, toBase64Url(new Uint8Array(8).fill(201)), 1));
    expect(await a.open(key, first)).toBeUndefined();
    expect(a.isFailed()).toBe(true);
    await expect(a.seal(key, hello)).rejects.toThrow();
  });
});
