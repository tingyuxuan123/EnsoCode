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
    const pending = port.load('s1', { kind: 'workspace', rel: 'shots/a.png' });
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
    await expect(port.load('s1', { kind: 'workspace', rel: 'shots/a.png' })).resolves.toEqual({
      dataUrl: DATA_URL,
    });
    expect(sent).toHaveLength(1);
  });

  it('目录外图片只上行工具调用 id，并用该 id 去重缓存', async () => {
    const { port, sent } = makePort();
    const target = { kind: 'tool-call' as const, id: 'read-1' };
    const pending = port.load('s1', target);
    expect(sent.at(-1)).toMatchObject({
      type: 'session-image',
      sessionId: 's1',
      toolCallId: 'read-1',
    });
    expect(JSON.stringify(sent)).not.toContain('/tmp/');

    port.receive({
      type: 'session-image-result',
      requestId: requestIdOf(sent),
      dataUrl: DATA_URL,
    });
    await expect(pending).resolves.toEqual({ dataUrl: DATA_URL });
    await expect(port.load('s1', target)).resolves.toEqual({ dataUrl: DATA_URL });
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

describe('SessionImagePort 的成功缓存失效与代次', () => {
  it('evict 后同一 key 会重新请求，并用新像素替换旧缓存', async () => {
    const { port, sent } = makePort();
    const first = port.load('s1', 'a.png');
    port.receive({ type: 'session-image-result', requestId: requestIdOf(sent), dataUrl: DATA_URL });
    await expect(first).resolves.toEqual({ dataUrl: DATA_URL });

    port.evict('s1', 'a.png');
    expect(port.peek('s1', 'a.png')).toBeUndefined();

    const second = port.load('s1', 'a.png');
    expect(sent).toHaveLength(2);
    port.receive({
      type: 'session-image-result',
      requestId: requestIdOf(sent),
      dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==',
    });
    await expect(second).resolves.toEqual({
      dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==',
    });
  });

  it('evict 时在途旧回包不能重新填进缓存', async () => {
    const { port, sent } = makePort();
    const slow = port.load('s1', 'a.png');
    const staleRequestId = requestIdOf(sent);
    port.evict('s1', 'a.png');
    // 旧请求的迟到应答
    port.receive({ type: 'session-image-result', requestId: staleRequestId, dataUrl: DATA_URL });
    await expect(slow).resolves.toEqual({ error: 'changed' });
    expect(port.peek('s1', 'a.png')).toBeUndefined();

    const again = port.load('s1', 'a.png');
    expect(sent).toHaveLength(2);
    port.receive({ type: 'session-image-result', requestId: requestIdOf(sent), dataUrl: DATA_URL });
    await expect(again).resolves.toEqual({ dataUrl: DATA_URL });
  });

  it('会话执行目录（scope）变化后不复用旧像素', async () => {
    const { port, sent } = makePort();
    const first = port.load('s1', 'a.png', '/work/old');
    port.receive({ type: 'session-image-result', requestId: requestIdOf(sent), dataUrl: DATA_URL });
    await expect(first).resolves.toEqual({ dataUrl: DATA_URL });

    const moved = port.load('s1', 'a.png', '/work/new');
    expect(sent).toHaveLength(2);
    expect(sent.at(-1)).toMatchObject({ type: 'session-image', rel: 'a.png' });
    port.receive({
      type: 'session-image-result',
      requestId: requestIdOf(sent),
      error: 'not-found',
    });
    await expect(moved).resolves.toEqual({ error: 'not-found' });
    // 旧 scope 的缓存仍然可用（各自独立）
    await expect(port.load('s1', 'a.png', '/work/old')).resolves.toEqual({ dataUrl: DATA_URL });
  });
});

describe('同 cwd 权威根换代与手动刷新', () => {
  it('刷新（evict→load）必定产生新的 host 请求，权限撤销时拿到错误而不是旧像素', async () => {
    const { port, sent } = makePort();
    const first = port.load('s1', 'a.png', '/work/proj');
    port.receive({ type: 'session-image-result', requestId: requestIdOf(sent), dataUrl: DATA_URL });
    await expect(first).resolves.toEqual({ dataUrl: DATA_URL });

    // 用户点「刷新图片」：先失效再取，绝不返回缓存
    port.evict('s1', 'a.png', '/work/proj');
    const refresh = port.load('s1', 'a.png', '/work/proj');
    expect(sent).toHaveLength(2);
    // Main 在根换代/权限撤销时重校后回 unavailable
    port.receive({
      type: 'session-image-result',
      requestId: requestIdOf(sent),
      error: 'unavailable',
    });
    await expect(refresh).resolves.toEqual({ error: 'unavailable' });
    // 失败不落缓存：不会把「权限已撤销」钉死，也不会冒充旧像素
    expect(port.peek('s1', 'a.png', '/work/proj')).toBeUndefined();
  });
});
