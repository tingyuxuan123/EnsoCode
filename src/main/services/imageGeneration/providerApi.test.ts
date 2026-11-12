import { describe, expect, it, vi } from 'vitest';
import { queryImageProviderModels } from './providerApi';

const KEY = 'sk-test-secret-abcdef';
const BASE = 'https://images.example.com/v1';

type Call = [string, RequestInit];

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function fetchStub(response: Response | (() => Promise<Response>)) {
  return vi.fn(async (_url: string, _init: RequestInit) =>
    typeof response === 'function' ? await response() : response
  );
}

describe('图片服务模型列表查询', () => {
  it('代理准备也受15秒限制，迟到准备完成不会再发送请求', async () => {
    vi.useFakeTimers();
    try {
      let ready!: () => void;
      const prepare = () =>
        new Promise<void>((resolve) => {
          ready = resolve;
        });
      const fetch = vi.fn();
      const pending = queryImageProviderModels({ baseUrl: BASE, apiKey: KEY }, { prepare, fetch });
      await vi.advanceTimersByTimeAsync(15_000);
      expect((await pending).ok).toBe(false);
      ready();
      await Promise.resolve();
      await Promise.resolve();
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
  it('15 秒期限也覆盖响应正文，不能收到响应头后无限挂起', async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    let signal: AbortSignal | undefined;
    const response = new Response(
      new ReadableStream({
        start(controller) {
          finish = () => controller.close();
        },
      })
    );
    try {
      const pending = queryImageProviderModels(
        { baseUrl: BASE, apiKey: KEY },
        {
          fetch: (async (_input, init) => {
            signal = init?.signal ?? undefined;
            return response;
          }) as typeof fetch,
        }
      );
      await vi.advanceTimersByTimeAsync(15_000);
      const aborted = signal?.aborted;
      finish();
      await pending;
      expect(aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
  it('只发一次 GET {baseUrl}/models，带 Bearer 且禁止重定向', async () => {
    const fetch = fetchStub(jsonResponse({ data: [{ id: 'gpt-image-1' }] }));
    const result = await queryImageProviderModels(
      { baseUrl: `${BASE}/`, apiKey: KEY },
      { fetch: fetch as unknown as typeof globalThis.fetch }
    );
    expect(result).toEqual({ ok: true, value: { models: ['gpt-image-1'] } });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as Call;
    expect(url).toBe(`${BASE}/models`);
    expect(init.method).toBe('GET');
    expect(init.redirect).toBe('error');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(headers.accept).toBe('application/json');
    expect(init.body).toBeUndefined();
  });

  it('兼容 data/models/字符串数组三种脏响应并去重截断', async () => {
    const cases: Array<[unknown, string[]]> = [
      [{ data: [{ id: 'a' }, { id: ' a ' }] }, ['a']],
      [{ models: [{ id: 'b' }, { name: 'c' }, { id: 42 }] }, ['b', 'c']],
      [
        ['d', 'd', '', '  ', 'e'],
        ['d', 'e'],
      ],
      [{ data: [{ name: 'only-name' }] }, []],
    ];
    for (const [payload, expected] of cases) {
      const result = await queryImageProviderModels(
        { baseUrl: BASE, apiKey: KEY },
        { fetch: fetchStub(jsonResponse(payload)) as unknown as typeof globalThis.fetch }
      );
      expect(result).toEqual({ ok: true, value: { models: expected } });
    }
  });

  it('取消重名并限制 256 条、单条 256 字符', async () => {
    const many = Array.from({ length: 300 }, (_, index) => ({ id: `model-${index}` }));
    const first = await queryImageProviderModels(
      { baseUrl: BASE, apiKey: KEY },
      { fetch: fetchStub(jsonResponse({ data: many })) as unknown as typeof globalThis.fetch }
    );
    expect(first.ok && first.value.models).toHaveLength(256);

    const wide = await queryImageProviderModels(
      { baseUrl: BASE, apiKey: KEY },
      {
        fetch: fetchStub(
          jsonResponse({ data: [{ id: 'x'.repeat(257) }, { id: 'ok' }] })
        ) as unknown as typeof globalThis.fetch,
      }
    );
    expect(wide).toEqual({ ok: true, value: { models: ['ok'] } });
  });

  it('无效响应返回真实空列表而不伪造模型', async () => {
    for (const payload of [null, 42, 'text', {}, { data: 'x' }, { data: [null, {}] }]) {
      const result = await queryImageProviderModels(
        { baseUrl: BASE, apiKey: KEY },
        { fetch: fetchStub(jsonResponse(payload)) as unknown as typeof globalThis.fetch }
      );
      expect(result).toEqual({ ok: true, value: { models: [] } });
    }
  });

  it('非法地址和空 key 在发请求前就拒绝', async () => {
    const fetch = vi.fn();
    for (const baseUrl of ['file:///tmp/x', 'https://user:pw@host/v1', 'https://host/v1?k=1']) {
      const result = await queryImageProviderModels(
        { baseUrl, apiKey: KEY },
        { fetch: fetch as unknown as typeof globalThis.fetch }
      );
      expect(result.ok).toBe(false);
    }
    const noKey = await queryImageProviderModels(
      { baseUrl: BASE, apiKey: '  ' },
      { fetch: fetch as unknown as typeof globalThis.fetch }
    );
    expect(noKey.ok).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('401 错误不带 key、不回显原始正文、不重试', async () => {
    const fetch = fetchStub(new Response(`<html>invalid key ${KEY}</html>`, { status: 401 }));
    const result = await queryImageProviderModels(
      { baseUrl: BASE, apiKey: KEY },
      { fetch: fetch as unknown as typeof globalThis.fetch }
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('401');
    expect(result.error).not.toContain(KEY);
    expect(result.error).not.toContain('<html>');
    expect(result.error.length).toBeLessThanOrEqual(300);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('网络异常里的凭证与 HTML 都被遮掉，错误长度有界', async () => {
    const fetch = vi.fn(async () => {
      throw new Error(`proxy boom key=${KEY} ${'<b>x</b>'.repeat(200)}`);
    });
    const result = await queryImageProviderModels(
      { baseUrl: BASE, apiKey: KEY },
      { fetch: fetch as unknown as typeof globalThis.fetch }
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).not.toContain(KEY);
    expect(result.error).not.toContain('<b>');
    expect(result.error.length).toBeLessThanOrEqual(300);
  });

  it('响应体超过 1MiB 直接拒绝，不解析', async () => {
    const huge = JSON.stringify({ data: [{ id: 'x'.repeat(1024 * 1024 + 32) }] });
    const streamed = await queryImageProviderModels(
      { baseUrl: BASE, apiKey: KEY },
      { fetch: fetchStub(new Response(huge)) as unknown as typeof globalThis.fetch }
    );
    expect(streamed.ok).toBe(false);
    if (!streamed.ok) expect(streamed.error.length).toBeLessThanOrEqual(300);

    const bodyless = {
      ok: true,
      status: 200,
      headers: new Headers(),
      body: null,
      text: async () => huge,
    } as unknown as Response;
    const fallback = await queryImageProviderModels(
      { baseUrl: BASE, apiKey: KEY },
      { fetch: fetchStub(bodyless) as unknown as typeof globalThis.fetch }
    );
    expect(fallback.ok).toBe(false);
  });

  it('15 秒超时后放弃请求', async () => {
    vi.useFakeTimers();
    try {
      const fetch = vi.fn(() => new Promise<Response>(() => {}));
      const pending = queryImageProviderModels(
        { baseUrl: BASE, apiKey: KEY },
        { fetch: fetch as unknown as typeof globalThis.fetch }
      );
      const settled = pending.then((value) => value);
      await vi.advanceTimersByTimeAsync(15_000);
      const result = await settled;
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.length).toBeLessThanOrEqual(300);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
