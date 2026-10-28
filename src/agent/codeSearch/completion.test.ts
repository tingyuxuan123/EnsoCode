import { describe, expect, it, vi } from 'vitest';
import { WindsurfCompletion } from './completion';
import { Writer } from './protobuf';
import { frame, JWT_PATH, STREAM_PATH } from './protocol';

const jwtBody = new Writer().string(1, 'jwt-token').build();
const streamBody = Buffer.concat([
  frame(new Writer().string(2, 'search answer').build()),
  frame(Buffer.from('{}'), 2),
]);

const session = (token = 'raw-token', signal = new AbortController().signal) => ({
  access: vi.fn(async () => ({ token, signal })),
});

describe('WindsurfCompletion', () => {
  it('复用现有 token 归一化形式并返回模型文本', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), init: init ?? {} });
      return new Response(new Uint8Array(String(input).endsWith(JWT_PATH) ? jwtBody : streamBody), {
        status: 200,
      });
    });
    const completion = new WindsurfCompletion(session(), { fetch: fetcher });
    const controller = new AbortController();
    await expect(completion.complete('system', [], '[]', controller.signal)).resolves.toBe(
      'search answer'
    );
    expect(calls).toHaveLength(2);
    expect(calls[0]!.url).toContain(JWT_PATH);
    expect(Buffer.from(calls[0]!.init.body as Uint8Array).toString('utf8')).toContain(
      'devin-session-token$raw-token'
    );
    expect(calls[1]!.url).toContain(STREAM_PATH);
  });

  it('401 时直接抛脱敏错误，不删除共享凭据', async () => {
    const revoke = vi.fn(async () => {});
    const shared = { ...session('secret-token'), revoke };
    const unauthorized = vi.fn(async () => new Response(null, { status: 401 }));
    const completionUnauthorized = new WindsurfCompletion(shared, { fetch: unauthorized });
    let message = '';
    try {
      await completionUnauthorized.complete('system', [], '[]', new AbortController().signal);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/rejected|login/i);
    expect(message).not.toContain('secret-token');
    expect(revoke).not.toHaveBeenCalled();
    expect(unauthorized).toHaveBeenCalledTimes(1);
  });

  it('403 同样不触碰共享凭据', async () => {
    const revoke = vi.fn(async () => {});
    const completion = new WindsurfCompletion(Object.assign(session(), { revoke }), {
      fetch: vi.fn(async () => new Response(null, { status: 403 })),
    });
    await expect(
      completion.complete('system', [], '[]', new AbortController().signal)
    ).rejects.toThrow(/rejected/i);
    expect(revoke).not.toHaveBeenCalled();
  });

  it('调用方取消后不再发请求', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetcher = vi.fn(async () => new Response(new Uint8Array(jwtBody)));
    const completion = new WindsurfCompletion(session('raw', controller.signal), {
      fetch: fetcher,
    });
    await expect(completion.complete('system', [], '[]', controller.signal)).rejects.toMatchObject({
      code: 'cancelled',
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('429/503 限流时返回独立的 ratelimit 错误，不重试', async () => {
    for (const status of [429, 503]) {
      const fetcher = vi.fn(async () => new Response(null, { status }));
      const completion = new WindsurfCompletion(session(), { fetch: fetcher });
      await expect(
        completion.complete('system', [], '[]', new AbortController().signal)
      ).rejects.toMatchObject({ code: 'ratelimit', message: expect.stringMatching(/throttl/i) });
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });

  it.each([
    ['网络异常', () => Promise.reject(new TypeError('fetch failed'))],
    ['5xx', async () => new Response(null, { status: 502 })],
  ])('流式请求遇到瞬时%s时重试一次', async (_label, transient) => {
    let streamCalls = 0;
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith(JWT_PATH)) return new Response(new Uint8Array(jwtBody));
      streamCalls += 1;
      if (streamCalls === 1) return transient();
      return new Response(new Uint8Array(streamBody));
    });
    const completion = new WindsurfCompletion(session(), { fetch: fetcher, retryDelayMs: 0 });
    await expect(
      completion.complete('system', [], '[]', new AbortController().signal)
    ).resolves.toBe('search answer');
    expect(streamCalls).toBe(2);
  });

  it('连续两次网络失败才报 network 错误', async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) =>
      String(input).endsWith(JWT_PATH)
        ? new Response(new Uint8Array(jwtBody))
        : new Response(null, { status: 500 })
    );
    const completion = new WindsurfCompletion(session(), { fetch: fetcher, retryDelayMs: 0 });
    await expect(
      completion.complete('system', [], '[]', new AbortController().signal)
    ).rejects.toMatchObject({ code: 'network' });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});
