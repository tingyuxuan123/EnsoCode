import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { attachHeartbeat, VISIBILITY_PROBE_MS } from './heartbeat';

class FakeWs extends EventTarget {
  readyState = 1;
  sent: string[] = [];
  send(data: string) {
    this.sent.push(data);
  }
}

describe('attachHeartbeat RTT', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
  });
  afterEach(() => vi.useRealTimers());

  it('pong 回报从 ping 发出起的往返时延', () => {
    const ws = new FakeWs();
    const rtts: number[] = [];
    attachHeartbeat(
      ws as unknown as WebSocket,
      () => {},
      (ms) => rtts.push(ms)
    );
    expect(ws.sent).toEqual(['ping']);

    vi.setSystemTime(1_048);
    ws.dispatchEvent(Object.assign(new Event('message'), { data: 'pong' }));
    expect(rtts).toEqual([48]);
  });

  it('业务帧不算 RTT', () => {
    const ws = new FakeWs();
    const rtts: number[] = [];
    attachHeartbeat(
      ws as unknown as WebSocket,
      () => {},
      (ms) => rtts.push(ms)
    );
    vi.setSystemTime(1_020);
    ws.dispatchEvent(Object.assign(new Event('message'), { data: new ArrayBuffer(4) }));
    expect(rtts).toEqual([]);
  });
});

describe('attachHeartbeat 周期探测容错', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup() {
    const ws = new FakeWs();
    const onDead = vi.fn();
    const heartbeat = attachHeartbeat(ws as unknown as WebSocket, onDead);
    return { ws, onDead, heartbeat };
  }

  it('周期探测单次超时不判死，立刻用同一超时再探一次', () => {
    const { ws, onDead } = setup();
    expect(ws.sent).toEqual(['ping']);

    vi.advanceTimersByTime(8_000);
    expect(onDead).not.toHaveBeenCalled();
    expect(ws.sent).toEqual(['ping', 'ping']);
  });

  it('连续两次超时才 onDead', () => {
    const { onDead } = setup();

    vi.advanceTimersByTime(8_000);
    expect(onDead).not.toHaveBeenCalled();
    vi.advanceTimersByTime(8_000);
    expect(onDead).toHaveBeenCalledOnce();
  });

  it('15 秒周期不打断正在等待的第二次 deadline', () => {
    const { ws, onDead } = setup();
    vi.advanceTimersByTime(8_000);
    expect(ws.sent).toEqual(['ping', 'ping']);

    // 周期探测到点，但第二次探测的 8 秒还没走完：不能插队发 ping，也不能提前判死
    vi.advanceTimersByTime(7_000);
    expect(ws.sent).toEqual(['ping', 'ping']);
    expect(onDead).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1_000);
    expect(onDead).toHaveBeenCalledOnce();
  });

  it('中途来一条业务帧清零超时计数', () => {
    const { ws, onDead } = setup();

    vi.advanceTimersByTime(8_000);
    expect(onDead).not.toHaveBeenCalled();
    ws.dispatchEvent(Object.assign(new Event('message'), { data: new ArrayBuffer(4) }));
    // 计数已清零，不是「再加一次就满 2」
    vi.advanceTimersByTime(7_000);
    vi.advanceTimersByTime(8_000);
    expect(onDead).not.toHaveBeenCalled();

    vi.advanceTimersByTime(8_000);
    expect(onDead).toHaveBeenCalledOnce();
  });

  it('onDead 之后即使调用方不 stop 也不再 ping、不重复判死', () => {
    const { ws, onDead } = setup();
    vi.advanceTimersByTime(16_000);
    expect(onDead).toHaveBeenCalledOnce();
    const sent = ws.sent.length;

    vi.advanceTimersByTime(60_000);
    expect(onDead).toHaveBeenCalledOnce();
    expect(ws.sent).toHaveLength(sent);
  });

  it('手动 probe 仍单次超时就判死', () => {
    const { ws, onDead, heartbeat } = setup();
    heartbeat.probe(VISIBILITY_PROBE_MS);
    expect(ws.sent).toEqual(['ping', 'ping']);

    vi.advanceTimersByTime(VISIBILITY_PROBE_MS);
    expect(onDead).toHaveBeenCalledOnce();
  });

  it('stop() 之后不再 ping 也不再 onDead', () => {
    const { ws, onDead, heartbeat } = setup();
    vi.advanceTimersByTime(8_000);
    expect(ws.sent).toHaveLength(2);
    heartbeat.stop();

    vi.advanceTimersByTime(60_000);
    expect(onDead).not.toHaveBeenCalled();
    expect(ws.sent).toHaveLength(2);
  });
});
