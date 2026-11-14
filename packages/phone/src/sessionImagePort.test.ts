import type { PhoneToHost } from '@enso/pair';
import { describe, expect, it, vi } from 'vitest';
import { SessionImagePort } from './sessionImagePort';

const DATA_URL = 'data:image/png;base64,iVBORw0KGgo=';

const makePort = (timeoutMs?: number) => {
  const sent: PhoneToHost[] = [];
  const port = new SessionImagePort((command) => {
    sent.push(command);
    return true;
  }, timeoutMs);
  return { port, sent };
};

const requestIdOf = (sent: PhoneToHost[]): string => {
  const command = sent.at(-1);
  if (command?.type !== 'session-image') throw new Error('no session-image sent');
  return command.requestId;
};

describe('SessionImagePort', () => {
  it('按会话 id + 相对路径上行，拿到 data URL 后缓存', async () => {
    const { port, sent } = makePort();
    const pending = port.load('s1', 'shots/a.png');
    expect(sent.at(-1)).toMatchObject({
      type: 'session-image',
      sessionId: 's1',
      rel: 'shots/a.png',
    });
    port.receive({
      type: 'session-image-result',
      requestId: requestIdOf(sent),
      dataUrl: DATA_URL,
    });
    await expect(pending).resolves.toEqual({ dataUrl: DATA_URL });
    await expect(port.load('s1', 'shots/a.png')).resolves.toEqual({ dataUrl: DATA_URL });
    expect(sent).toHaveLength(1);
  });

  it('同图并发只发一次请求；不同会话不串图', async () => {
    const { port, sent } = makePort();
    const first = port.load('s1', 'a.png');
    const second = port.load('s1', 'a.png');
    expect(sent).toHaveLength(1);
    port.receive({ type: 'session-image-result', requestId: requestIdOf(sent), dataUrl: DATA_URL });
    await expect(first).resolves.toEqual({ dataUrl: DATA_URL });
    await expect(second).resolves.toEqual({ dataUrl: DATA_URL });

    const other = port.load('s2', 'a.png');
    expect(sent.at(-1)).toMatchObject({ sessionId: 's2' });
    port.receive({
      type: 'session-image-result',
      requestId: requestIdOf(sent),
      error: 'not-found',
    });
    await expect(other).resolves.toEqual({ error: 'not-found' });
    await expect(port.load('s1', 'a.png')).resolves.toEqual({ dataUrl: DATA_URL });
  });

  it('未知错误码与非法 data URL 都按失败处理，并可重试', async () => {
    const { port, sent } = makePort();
    const bad = port.load('s1', 'a.png');
    port.receive({
      type: 'session-image-result',
      requestId: requestIdOf(sent),
      dataUrl: 'http://evil/x.png',
    });
    await expect(bad).resolves.toEqual({ error: 'failed' });

    const retry = port.load('s1', 'a.png');
    port.receive({
      type: 'session-image-result',
      requestId: requestIdOf(sent),
      error: 'weird',
    });
    await expect(retry).resolves.toEqual({ error: 'failed' });
    expect(sent).toHaveLength(2);
  });

  it('超时与断线都给出可重试的失败，不永久挂起', async () => {
    vi.useFakeTimers();
    try {
      const { port, sent } = makePort(1000);
      const slow = port.load('s1', 'a.png');
      vi.advanceTimersByTime(1000);
      await expect(slow).resolves.toEqual({ error: 'timeout' });
      port.receive({
        type: 'session-image-result',
        requestId: requestIdOf(sent),
        dataUrl: DATA_URL,
      });

      const offline = port.load('s1', 'b.png');
      port.reset();
      await expect(offline).resolves.toEqual({ error: 'offline' });
      // reset 之后缓存清空：同一张图会重新请求
      const again = port.load('s1', 'a.png');
      expect(sent).toHaveLength(3);
      port.receive({
        type: 'session-image-result',
        requestId: requestIdOf(sent),
        dataUrl: DATA_URL,
      });
      await expect(again).resolves.toEqual({ dataUrl: DATA_URL });
    } finally {
      vi.useRealTimers();
    }
  });
});
