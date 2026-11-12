import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  truncate,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseImageGenerationResult } from '@shared/imageGeneration';
import { DEFAULT_IMAGE_PROVIDER } from '@shared/imageProvider';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateImage, type ImageProviderConfig } from './service';

const ioRace = vi.hoisted(() => ({
  beforeOpen: undefined as undefined | ((file: unknown) => void),
}));
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    openSync: (...args: Parameters<typeof actual.openSync>) => {
      ioRace.beforeOpen?.(args[0]);
      return actual.openSync(...args);
    },
  };
});

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(8),
]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(8)]);
const GIF = Buffer.concat([Buffer.from('GIF89a', 'latin1'), Buffer.alloc(8)]);
const WEBP = Buffer.concat([
  Buffer.from('RIFF', 'latin1'),
  Buffer.alloc(4),
  Buffer.from('WEBP', 'latin1'),
]);
const BMP = Buffer.concat([Buffer.from('BM', 'latin1'), Buffer.alloc(8)]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_BYTES = 32 * 1024 * 1024;

const CONFIG: ImageProviderConfig = {
  baseUrl: 'https://images.example.com/v1',
  apiKey: 'sk-super-secret-key',
  modelId: 'gpt-image-1',
};

const roots: string[] = [];

async function makeDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'xiaoman-image-'));
  roots.push(dir);
  return dir;
}

afterEach(async () => {
  ioRace.beforeOpen = undefined;
  vi.restoreAllMocks();
  for (const dir of roots.splice(0)) await rm(dir, { recursive: true, force: true });
});

interface CapturedCall {
  url: string;
  init: RequestInit;
}

type Responder = (url: string, init: RequestInit) => Response | Promise<Response>;

function fakeFetch(responder: Responder): { impl: typeof fetch; calls: CapturedCall[] } {
  const calls: CapturedCall[] = [];
  const impl = (async (input: unknown, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : String((input as { url?: unknown }).url ?? '');
    const requestInit = init ?? {};
    calls.push({ url, init: requestInit });
    return await responder(url, requestInit);
  }) as unknown as typeof fetch;
  return { impl, calls };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function b64Response(bytes: Buffer): Response {
  return jsonResponse({ data: [{ b64_json: bytes.toString('base64') }] });
}

async function outputFiles(cwd: string): Promise<string[]> {
  try {
    return await readdir(path.join(cwd, '.xiaoman', 'images'));
  } catch {
    return [];
  }
}

async function putSourceImage(cwd: string, name: string, bytes: Buffer): Promise<string> {
  const dir = path.join(cwd, '.xiaoman', 'images');
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, name);
  await writeFile(file, bytes);
  return file;
}

function headerOf(init: RequestInit, name: string): string | undefined {
  return new Headers(init.headers).get(name) ?? undefined;
}

async function waitFor(predicate: () => boolean, label: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

describe('generateImage · 请求形态', () => {
  it('独立输出设置对 JSON 和 multipart 都生效，额外参数不能覆盖必需字段', async () => {
    const cwd = await makeDir();
    const source = await putSourceImage(cwd, `${randomUUID()}.png`, PNG);
    const output = {
      ...DEFAULT_IMAGE_PROVIDER,
      sizeMode: '2k' as const,
      quality: 'high',
      extraParams:
        '{"output_format":"png","background":"auto","model":"evil","n":9,"prompt":"evil","image":"evil","meta":{"x":1}}',
    };
    const { impl, calls } = fakeFetch(() => b64Response(PNG));
    await generateImage(
      { prompt: 'cat', size: '1536x1024' },
      cwd,
      { ...CONFIG, output },
      undefined,
      { fetch: impl }
    );
    await generateImage(
      { prompt: 'cat', size: '1536x1024', sourceImagePath: source },
      cwd,
      { ...CONFIG, output },
      undefined,
      { fetch: impl }
    );
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      model: 'gpt-image-1',
      prompt: 'cat',
      n: 1,
      size: '2048x1360',
      quality: 'high',
      output_format: 'png',
      background: 'auto',
      meta: { x: 1 },
    });
    const form = calls[1].init.body as FormData;
    expect(form.get('size')).toBe('2048x1360');
    expect(form.get('quality')).toBe('high');
    expect(form.get('model')).toBe('gpt-image-1');
    expect(form.get('meta')).toBe('{"x":1}');
    expect(form.get('image')).toBeInstanceOf(Blob);
  });
  it('不传尺寸模式在两种请求中均删除 size 字段', async () => {
    const cwd = await makeDir();
    const source = await putSourceImage(cwd, `${randomUUID()}.png`, PNG);
    const output = { ...DEFAULT_IMAGE_PROVIDER, sizeMode: 'omit' as const };
    const { impl, calls } = fakeFetch(() => b64Response(PNG));
    await generateImage(
      { prompt: 'cat', size: '1536x1024' },
      cwd,
      { ...CONFIG, output },
      undefined,
      { fetch: impl }
    );
    await generateImage(
      { prompt: 'cat', sourceImagePath: source },
      cwd,
      { ...CONFIG, output },
      undefined,
      { fetch: impl }
    );
    expect(JSON.parse(String(calls[0].init.body))).not.toHaveProperty('size');
    expect((calls[1].init.body as FormData).has('size')).toBe(false);
  });
  it('文本生图走 JSON generations，并把图片落到 .xiaoman/images/<uuid>.png', async () => {
    const cwd = await makeDir();
    const { impl, calls } = fakeFetch(() => b64Response(PNG));

    const result = await generateImage({ prompt: '一只橘猫' }, cwd, CONFIG, undefined, {
      fetch: impl,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://images.example.com/v1/images/generations');
    expect(calls[0].init.method).toBe('POST');
    expect(headerOf(calls[0].init, 'authorization')).toBe('Bearer sk-super-secret-key');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      model: 'gpt-image-1',
      prompt: '一只橘猫',
      n: 1,
      size: '1024x1024',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.image.id).toMatch(UUID);
    expect(result.image.mimeType).toBe('image/png');
    expect(result.image.path).toBe(`.xiaoman/images/${result.image.id}.png`);
    expect(result.image.parentId).toBeUndefined();
    expect(await outputFiles(cwd)).toEqual([`${result.image.id}.png`]);
    expect(await readFile(path.join(cwd, result.image.path))).toEqual(PNG);
  });

  it('size 默认 1024x1024，自定义尺寸原样发给上游', async () => {
    const cwd = await makeDir();
    const { impl, calls } = fakeFetch(() => b64Response(PNG));
    await generateImage({ prompt: 'x', size: '512x768' }, cwd, CONFIG, undefined, { fetch: impl });
    expect(JSON.parse(String(calls[0].init.body)).size).toBe('512x768');
  });

  it('带 sourceImagePath 时走 multipart edits，图片来源是 cwd 内的绝对路径', async () => {
    const cwd = await makeDir();
    const source = path.join(cwd, 'ref.png');
    await writeFile(source, PNG);
    const { impl, calls } = fakeFetch(() => b64Response(PNG));

    const result = await generateImage(
      { prompt: '改成夜景', sourceImagePath: source },
      cwd,
      CONFIG,
      undefined,
      { fetch: impl }
    );

    expect(result.ok).toBe(true);
    expect(calls[0].url).toBe('https://images.example.com/v1/images/edits');
    expect(headerOf(calls[0].init, 'authorization')).toBe('Bearer sk-super-secret-key');
    // multipart 的 Content-Type（含 boundary）由 fetch 自己生成，我们只带 Authorization。
    expect(headerOf(calls[0].init, 'content-type')).toBeUndefined();

    const form = calls[0].init.body;
    expect(form).toBeInstanceOf(FormData);
    const formData = form as FormData;
    expect(formData.get('model')).toBe('gpt-image-1');
    expect(formData.get('prompt')).toBe('改成夜景');
    expect(formData.get('n')).toBe('1');
    expect(formData.get('size')).toBe('1024x1024');
    const image = formData.get('image') as File;
    expect(image.name).toBe('image.png');
    expect(image.type).toBe('image/png');
    expect(image.size).toBe(PNG.length);
    if (result.ok) expect(result.image.parentId).toBeUndefined();
  });

  it('sourceImageId 从固定输出目录按允许扩展名解析，并作为 parentId 回填', async () => {
    const cwd = await makeDir();
    const id = randomUUID();
    await putSourceImage(cwd, `${id}.png`, PNG);
    const { impl, calls } = fakeFetch(() => b64Response(JPEG));

    const result = await generateImage(
      { prompt: '加一顶帽子', sourceImageId: id },
      cwd,
      CONFIG,
      undefined,
      {
        fetch: impl,
      }
    );

    expect(calls[0].url).toBe('https://images.example.com/v1/images/edits');
    expect((calls[0].init.body as FormData).get('image')).toBeInstanceOf(Blob);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.image.parentId).toBe(id);
    expect(result.image.mimeType).toBe('image/jpeg');
    expect(result.image.path).toBe(`.xiaoman/images/${result.image.id}.jpg`);
  });

  it('本机 http 端点允许（用户自建服务），尾斜杠被归一化', async () => {
    const cwd = await makeDir();
    const { impl, calls } = fakeFetch(() => b64Response(PNG));
    const config = { ...CONFIG, baseUrl: 'http://127.0.0.1:8080/v1/' };
    const result = await generateImage({ prompt: 'x' }, cwd, config, undefined, { fetch: impl });
    expect(result.ok).toBe(true);
    expect(calls[0].url).toBe('http://127.0.0.1:8080/v1/images/generations');
  });
});

describe('generateImage · 结果解码', () => {
  it('url 结果交给注入的下载器（只发一次 POST，不额外请求 CDN），成功落盘', async () => {
    const cwd = await makeDir();
    const { impl, calls } = fakeFetch(() =>
      jsonResponse({ data: [{ url: 'https://cdn.example.com/a.png' }] })
    );
    const downloads: { url: string; signal: AbortSignal | undefined }[] = [];
    const download = async (url: string, signal: AbortSignal) => {
      downloads.push({ url, signal });
      return { ok: true as const, dataUrl: `data:image/png;base64,${PNG.toString('base64')}` };
    };

    const result = await generateImage({ prompt: 'x' }, cwd, CONFIG, undefined, {
      fetch: impl,
      download,
    });

    expect(calls).toHaveLength(1);
    expect(downloads).toHaveLength(1);
    expect(downloads[0].url).toBe('https://cdn.example.com/a.png');
    expect(downloads[0].signal).toBeInstanceOf(AbortSignal);
    expect(result.ok).toBe(true);
    expect(await outputFiles(cwd)).toHaveLength(1);
  });

  it('下载被公网代理拦下（blocked-address）时失败且不落盘、不重试', async () => {
    const cwd = await makeDir();
    const { impl, calls } = fakeFetch(() =>
      jsonResponse({ data: [{ url: 'http://169.254.169.254/a.png' }] })
    );
    const result = await generateImage({ prompt: 'x' }, cwd, CONFIG, undefined, {
      fetch: impl,
      download: async () => ({ ok: false as const, error: 'blocked-address' }),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.retryable).toBe(false);
    expect(result.error).toContain('blocked-address');
    expect(calls).toHaveLength(1);
    expect(await outputFiles(cwd)).toEqual([]);
  });

  it.each([
    ['data 数组为空', jsonResponse({ data: [] })],
    ['没有 b64_json 也没有 url', jsonResponse({ data: [{}] })],
    ['上游返回非 JSON', new Response('<html>oops</html>', { status: 200 })],
  ])('%s 时报「没有图片数据」并且不写文件', async (_label, response) => {
    const cwd = await makeDir();
    const { impl } = fakeFetch(() => response);
    const result = await generateImage({ prompt: 'x' }, cwd, CONFIG, undefined, { fetch: impl });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.retryable).toBe(false);
    expect(await outputFiles(cwd)).toEqual([]);
  });

  it.each([
    ['带换行', `${PNG.toString('base64').slice(0, 8)}\n${PNG.toString('base64').slice(8)}`],
    ['带 data URL 前缀', `data:image/png;base64,${PNG.toString('base64')}`],
    ['非法字符', `${PNG.toString('base64')}%%`],
    ['长度不是 4 的倍数', 'AAA'],
  ])('严格 base64：%s 直接拒绝', async (_label, b64) => {
    const cwd = await makeDir();
    const { impl } = fakeFetch(() => jsonResponse({ data: [{ b64_json: b64 }] }));
    const result = await generateImage({ prompt: 'x' }, cwd, CONFIG, undefined, { fetch: impl });
    expect(result.ok).toBe(false);
    expect(await outputFiles(cwd)).toEqual([]);
  });

  it('魔数只认 png/jpeg/webp/gif：bmp 拒绝且不落盘', async () => {
    const cwd = await makeDir();
    const { impl } = fakeFetch(() => b64Response(BMP));
    const result = await generateImage({ prompt: 'x' }, cwd, CONFIG, undefined, { fetch: impl });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('unsupported');
    expect(await outputFiles(cwd)).toEqual([]);
  });

  it.each([
    ['image/jpeg', JPEG, 'jpg'],
    ['image/webp', WEBP, 'webp'],
    ['image/gif', GIF, 'gif'],
  ])('%s 按魔数映射扩展名 .%s', async (_label, bytes, extension) => {
    const cwd = await makeDir();
    const { impl } = fakeFetch(() => b64Response(bytes));
    const result = await generateImage({ prompt: 'x' }, cwd, CONFIG, undefined, { fetch: impl });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.image.mimeType).toBe(_label);
    expect(result.image.path.endsWith(`.${extension}`)).toBe(true);
  });

  it('响应声明超过上限时拒绝读取，不落盘', async () => {
    const cwd = await makeDir();
    const { impl } = fakeFetch(
      () =>
        new Response('{}', {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'content-length': String(64 * 1024 * 1024),
          },
        })
    );
    const result = await generateImage({ prompt: 'x' }, cwd, CONFIG, undefined, { fetch: impl });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('too large');
    expect(await outputFiles(cwd)).toEqual([]);
  });
});

describe('generateImage · 入参校验', () => {
  it.each([
    ['空', ''],
    ['纯空白', '   '],
    ['超过 16000', 'x'.repeat(16_001)],
  ])('prompt %s 被拒绝且不发请求', async (_label, prompt) => {
    const cwd = await makeDir();
    const { impl, calls } = fakeFetch(() => b64Response(PNG));
    const result = await generateImage({ prompt }, cwd, CONFIG, undefined, { fetch: impl });
    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('prompt 恰好 16000 字符通过', async () => {
    const cwd = await makeDir();
    const { impl } = fakeFetch(() => b64Response(PNG));
    const result = await generateImage({ prompt: 'y'.repeat(16_000) }, cwd, CONFIG, undefined, {
      fetch: impl,
    });
    expect(result.ok).toBe(true);
  });

  it.each([
    'abc',
    '1024',
    '63x1024',
    '1024x4097',
    '0x1024',
    '1024x1024x2',
    ' 1024x1024 ',
    '1024X1024',
  ])('非法 size %s 被拒绝且不发请求', async (size) => {
    const cwd = await makeDir();
    const { impl, calls } = fakeFetch(() => b64Response(PNG));
    const result = await generateImage({ prompt: 'x', size }, cwd, CONFIG, undefined, {
      fetch: impl,
    });
    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it.each(['64x64', '4096x4096'])('边界 size %s 通过', async (size) => {
    const cwd = await makeDir();
    const { impl, calls } = fakeFetch(() => b64Response(PNG));
    const result = await generateImage({ prompt: 'x', size }, cwd, CONFIG, undefined, {
      fetch: impl,
    });
    expect(result.ok).toBe(true);
    expect(JSON.parse(String(calls[0].init.body)).size).toBe(size);
  });

  it('sourceImageId 必须是 UUID，非法值不发请求', async () => {
    const cwd = await makeDir();
    const { impl, calls } = fakeFetch(() => b64Response(PNG));
    for (const id of ['../../etc/passwd', 'not-a-uuid', '', randomUUID().replace(/-/g, '')]) {
      const result = await generateImage(
        { prompt: 'x', sourceImageId: id },
        cwd,
        CONFIG,
        undefined,
        {
          fetch: impl,
        }
      );
      expect(result.ok).toBe(false);
    }
    expect(calls).toHaveLength(0);
  });

  it('sourceImageId 与 sourceImagePath 不能并传', async () => {
    const cwd = await makeDir();
    const id = randomUUID();
    await putSourceImage(cwd, `${id}.png`, PNG);
    await writeFile(path.join(cwd, 'ref.png'), PNG);
    const { impl, calls } = fakeFetch(() => b64Response(PNG));
    const result = await generateImage(
      { prompt: 'x', sourceImageId: id, sourceImagePath: 'ref.png' },
      cwd,
      CONFIG,
      undefined,
      { fetch: impl }
    );
    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it.each([
    ['协议不支持', 'ftp://images.example.com/v1'],
    ['内嵌凭据', 'https://user:pass@images.example.com/v1'],
    ['带 query', 'https://images.example.com/v1?tenant=a'],
    ['带 hash', 'https://images.example.com/v1#x'],
    ['空', '   '],
  ])('baseUrl %s 被拒绝且不发请求', async (_label, baseUrl) => {
    const cwd = await makeDir();
    const { impl, calls } = fakeFetch(() => b64Response(PNG));
    const result = await generateImage({ prompt: 'x' }, cwd, { ...CONFIG, baseUrl }, undefined, {
      fetch: impl,
    });
    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('缺少 api key 或 model 时不发请求', async () => {
    const cwd = await makeDir();
    const { impl, calls } = fakeFetch(() => b64Response(PNG));
    expect(
      (
        await generateImage({ prompt: 'x' }, cwd, { ...CONFIG, apiKey: ' ' }, undefined, {
          fetch: impl,
        })
      ).ok
    ).toBe(false);
    expect(
      (
        await generateImage({ prompt: 'x' }, cwd, { ...CONFIG, modelId: '' }, undefined, {
          fetch: impl,
        })
      ).ok
    ).toBe(false);
    expect(calls).toHaveLength(0);
  });
});

describe('generateImage · 错误处理', () => {
  it('401 回显 key 时脱敏且不重试', async () => {
    const cwd = await makeDir();
    const { impl, calls } = fakeFetch(() =>
      jsonResponse({ error: { message: 'invalid key sk-super-secret-key' } }, 401)
    );
    const result = await generateImage({ prompt: 'x' }, cwd, CONFIG, undefined, { fetch: impl });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.retryable).toBe(false);
    expect(result.error).not.toContain('sk-super-secret-key');
    expect(result.error).toContain('***');
    expect(result.error).toContain('401');
    expect(calls).toHaveLength(1);
  });

  it('429 标记可重试但只请求一次（不自动重试）', async () => {
    const cwd = await makeDir();
    const { impl, calls } = fakeFetch(() =>
      jsonResponse({ error: { message: 'rate limited' } }, 429)
    );
    const result = await generateImage({ prompt: 'x' }, cwd, CONFIG, undefined, { fetch: impl });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.retryable).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it('上游超长错误文本被截断', async () => {
    const cwd = await makeDir();
    const { impl } = fakeFetch(() => jsonResponse({ error: { message: 'e'.repeat(2000) } }, 500));
    const result = await generateImage({ prompt: 'x' }, cwd, CONFIG, undefined, { fetch: impl });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.retryable).toBe(true);
    expect(result.error.length).toBeLessThanOrEqual(340);
  });

  it('HTML 错误页不回显原始正文', async () => {
    const cwd = await makeDir();
    const { impl } = fakeFetch(
      () =>
        new Response('<html><body>gateway secret sk-super-secret-key</body></html>', {
          status: 502,
        })
    );
    const result = await generateImage({ prompt: 'x' }, cwd, CONFIG, undefined, { fetch: impl });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('HTTP 502');
    expect(result.retryable).toBe(true);
  });

  it('超时映射成可重试的固定文案', async () => {
    const cwd = await makeDir();
    const { impl } = fakeFetch(() => {
      throw new DOMException('The operation timed out', 'TimeoutError');
    });
    const result = await generateImage({ prompt: 'x' }, cwd, CONFIG, undefined, { fetch: impl });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('Image request timed out');
    expect(result.retryable).toBe(true);
    expect(await outputFiles(cwd)).toEqual([]);
  });

  it('网络错误标记可重试', async () => {
    const cwd = await makeDir();
    const { impl } = fakeFetch(() => {
      throw new TypeError('fetch failed');
    });
    const result = await generateImage({ prompt: 'x' }, cwd, CONFIG, undefined, { fetch: impl });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.retryable).toBe(true);
    expect(result.error).not.toContain('sk-super-secret-key');
  });
});

describe('generateImage · 与共享 schema 一致', () => {
  it('成功结果能通过共享 parseImageGenerationResult 校验', async () => {
    const cwd = await makeDir();
    const { impl } = fakeFetch(() => b64Response(PNG));
    const result = await generateImage({ prompt: 'x' }, cwd, CONFIG, undefined, { fetch: impl });
    expect(parseImageGenerationResult(result)).toEqual(result);
  });

  it('失败结果（含超长上游错误）也能通过共享 parseImageGenerationResult 校验', async () => {
    const cwd = await makeDir();
    const { impl } = fakeFetch(() => jsonResponse({ error: { message: 'e'.repeat(2000) } }, 500));
    const result = await generateImage({ prompt: 'x' }, cwd, CONFIG, undefined, { fetch: impl });
    expect(result.ok).toBe(false);
    expect(parseImageGenerationResult(result)).toEqual(result);
  });
});

describe('generateImage · 路径安全', () => {
  it('输入图读取有 32MiB 上限，超限不发请求', async () => {
    const cwd = await makeDir();
    const source = path.join(cwd, 'huge.png');
    await writeFile(source, PNG);
    await truncate(source, MAX_BYTES + 1);
    const { impl, calls } = fakeFetch(() => b64Response(PNG));
    const result = await generateImage(
      { prompt: 'x', sourceImagePath: source },
      cwd,
      CONFIG,
      undefined,
      {
        fetch: impl,
      }
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('32 MiB');
    expect(calls).toHaveLength(0);
  });

  it.each(['../../etc/passwd', '/etc/passwd', 'sub/../../../outside.png', 'missing.png'])(
    '相对/绝对穿越与不存在的路径 %s 被拒绝且不发请求',
    async (sourceImagePath) => {
      const cwd = await makeDir();
      const { impl, calls } = fakeFetch(() => b64Response(PNG));
      const result = await generateImage({ prompt: 'x', sourceImagePath }, cwd, CONFIG, undefined, {
        fetch: impl,
      });
      expect(result.ok).toBe(false);
      expect(calls).toHaveLength(0);
    }
  );

  it('目录不能当作参考图', async () => {
    const cwd = await makeDir();
    await mkdir(path.join(cwd, 'folder'));
    const { impl, calls } = fakeFetch(() => b64Response(PNG));
    const result = await generateImage(
      { prompt: 'x', sourceImagePath: 'folder' },
      cwd,
      CONFIG,
      undefined,
      {
        fetch: impl,
      }
    );
    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('cwd 内的受控符号链接允许，指向 cwd 外的符号链接拒绝', async () => {
    const cwd = await makeDir();
    const outside = await makeDir();
    await writeFile(path.join(cwd, 'real.png'), PNG);
    await writeFile(path.join(outside, 'secret.png'), PNG);
    await symlink(path.join(cwd, 'real.png'), path.join(cwd, 'inside-link.png'));
    await symlink(path.join(outside, 'secret.png'), path.join(cwd, 'outside-link.png'));

    const ok = fakeFetch(() => b64Response(PNG));
    const inside = await generateImage(
      { prompt: 'x', sourceImagePath: 'inside-link.png' },
      cwd,
      CONFIG,
      undefined,
      {
        fetch: ok.impl,
      }
    );
    expect(inside.ok).toBe(true);
    expect(ok.calls).toHaveLength(1);

    const blocked = fakeFetch(() => b64Response(PNG));
    const escaped = await generateImage(
      { prompt: 'x', sourceImagePath: 'outside-link.png' },
      cwd,
      CONFIG,
      undefined,
      { fetch: blocked.impl }
    );
    expect(escaped.ok).toBe(false);
    expect(blocked.calls).toHaveLength(0);
  });

  it('.xiaoman 是指向 cwd 外的符号链接时拒绝生成，外部目录不落文件', async () => {
    const cwd = await makeDir();
    const outside = await makeDir();
    await symlink(outside, path.join(cwd, '.xiaoman'), 'dir');
    const { impl, calls } = fakeFetch(() => b64Response(PNG));
    const result = await generateImage({ prompt: 'x' }, cwd, CONFIG, undefined, { fetch: impl });
    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(0);
    expect(await readdir(outside)).toEqual([]);
  });

  it('.xiaoman/images 是指向 cwd 外的符号链接时拒绝生成', async () => {
    const cwd = await makeDir();
    const outside = await makeDir();
    await mkdir(path.join(cwd, '.xiaoman'));
    await symlink(outside, path.join(cwd, '.xiaoman', 'images'), 'dir');
    const { impl } = fakeFetch(() => b64Response(PNG));
    const result = await generateImage({ prompt: 'x' }, cwd, CONFIG, undefined, { fetch: impl });
    expect(result.ok).toBe(false);
    expect(await readdir(outside)).toEqual([]);
  });

  it('目标文件已存在时不覆盖（wx），保留原内容', async () => {
    const cwd = await makeDir();
    const id = randomUUID();
    const existing = await putSourceImage(cwd, `${id}.png`, Buffer.from('keep-me'));
    const { impl } = fakeFetch(() => b64Response(PNG));
    const result = await generateImage({ prompt: 'x' }, cwd, CONFIG, undefined, {
      fetch: impl,
      nextId: () => id,
    });
    expect(result.ok).toBe(false);
    expect(await readFile(existing)).toEqual(Buffer.from('keep-me'));
  });
});

describe('generateImage · 取消', () => {
  it('参考图在校验后被替换成外部链接时不会读取上传', async () => {
    const cwd = await makeDir();
    const outside = await makeDir();
    const source = path.join(cwd, 'source.png');
    const secret = path.join(outside, 'private.png');
    await writeFile(source, PNG);
    await writeFile(secret, JPEG);
    const canonicalSource = fs.realpathSync(source);
    let replaced = false;
    ioRace.beforeOpen = (file) => {
      if (String(file) === canonicalSource && !replaced) {
        replaced = true;
        fs.unlinkSync(source);
        fs.symlinkSync(secret, source);
      }
    };
    const { impl, calls } = fakeFetch(() => b64Response(PNG));
    const result = await generateImage(
      { prompt: 'cat', sourceImagePath: source },
      cwd,
      CONFIG,
      undefined,
      { fetch: impl }
    );
    expect(replaced).toBe(true);
    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });
  it('等待上游时产物目录被替换为外部链接，不能写出工作区', async () => {
    const cwd = await makeDir();
    const outside = await makeDir();
    const { impl } = fakeFetch(async () => {
      await rm(path.join(cwd, '.xiaoman', 'images'), { recursive: true });
      await symlink(outside, path.join(cwd, '.xiaoman', 'images'), 'dir');
      return b64Response(PNG);
    });
    const result = await generateImage({ prompt: 'cat' }, cwd, CONFIG, undefined, { fetch: impl });
    expect(result.ok).toBe(false);
    expect(await readdir(outside)).toEqual([]);
  });
  it('POST 中途取消：抛 AbortError 且不落盘', async () => {
    const cwd = await makeDir();
    const controller = new AbortController();
    const { impl, calls } = fakeFetch(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init.signal as AbortSignal;
          signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        })
    );
    const pending = generateImage({ prompt: 'x' }, cwd, CONFIG, controller.signal, { fetch: impl });
    await waitFor(() => calls.length === 1, 'POST 发出');
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(await outputFiles(cwd)).toEqual([]);
  });

  it('调用前就已取消：不发请求', async () => {
    const cwd = await makeDir();
    const controller = new AbortController();
    controller.abort();
    const { impl, calls } = fakeFetch(() => b64Response(PNG));
    await expect(
      generateImage({ prompt: 'x' }, cwd, CONFIG, controller.signal, { fetch: impl })
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(calls).toHaveLength(0);
    expect(await outputFiles(cwd)).toEqual([]);
  });

  it('下载阶段取消：抛 AbortError 且不落盘', async () => {
    const cwd = await makeDir();
    const controller = new AbortController();
    const { impl, calls } = fakeFetch(() =>
      jsonResponse({ data: [{ url: 'https://cdn.example.com/a.png' }] })
    );
    const download = (_url: string, signal: AbortSignal) =>
      new Promise<{ ok: false; error: string }>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    const pending = generateImage({ prompt: 'x' }, cwd, CONFIG, controller.signal, {
      fetch: impl,
      download,
    });
    await waitFor(() => calls.length === 1, 'POST 发出');
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(await outputFiles(cwd)).toEqual([]);
  });
});
