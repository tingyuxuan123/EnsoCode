import { type ImageProviderResult, normalizeImageProviderBaseUrl } from '@shared/imageProvider';

/**
 * 图片服务的「探测连通性 / 拉模型列表」共用入口：只发一次 `GET {baseUrl}/models`。
 *
 * 边界：
 * - 只读不写，绝不调用生图 / 编辑 / 聊天接口（都按次收费）。
 * - Bearer 认证，`redirect: 'error'`，15s 超时，响应体上限 1MiB，不重试。
 * - 错误一律抹掉 API Key、不回显上游原始正文（HTML 或凭证），长度有界。
 * - 脏响应只返回真实解析结果，解析不出就是空列表，绝不伪造模型名。
 */

const TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_MODELS = 256;
const MAX_MODEL_CHARS = 256;
const MAX_ERROR_CHARS = 300;

export interface ImageProviderConnection {
  baseUrl: string;
  apiKey: string;
}

export interface ImageProviderModelsDeps {
  fetch?: typeof fetch;
  /** Host proxy readiness shares the same deadline; abort must stop any queued follow-up. */
  prepare?: () => Promise<void>;
}

const ok = <T>(value: T): ImageProviderResult<T> => ({ ok: true, value });

function scrub(message: string, apiKey: string): string {
  let text = message;
  for (const variant of [apiKey, encodeURIComponent(apiKey)]) {
    if (variant) text = text.split(variant).join('***');
  }
  text = [...text.replace(/<[^>]*>/g, ' ')]
    .map((char) => (char.charCodeAt(0) < 0x20 || char.charCodeAt(0) === 0x7f ? ' ' : char))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) text = '图片服务请求失败。';
  return text.slice(0, MAX_ERROR_CHARS);
}

function modelId(entry: unknown, allowName: boolean): string | null {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
  const row = entry as Record<string, unknown>;
  if (typeof row.id === 'string') return row.id;
  return allowName && typeof row.name === 'string' ? row.name : null;
}

function collectModels(payload: unknown): string[] {
  // 官方 OpenAI 形状是 `{data:[{id}]}`，部分兼容实现用 `{models:[{id|name}]}` 或裸字符串数组。
  const plain = Array.isArray(payload);
  const row =
    plain || !payload || typeof payload !== 'object' ? {} : (payload as Record<string, unknown>);
  const candidates: unknown[] = plain
    ? (payload as unknown[])
    : Array.isArray(row.data)
      ? row.data
      : Array.isArray(row.models)
        ? row.models
        : [];
  const allowName = !plain && !Array.isArray(row.data) && Array.isArray(row.models);
  const models: string[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const id = typeof candidate === 'string' ? candidate : modelId(candidate, allowName);
    if (!id) continue;
    const trimmed = id.trim();
    if (!trimmed || trimmed.length > MAX_MODEL_CHARS || seen.has(trimmed)) continue;
    seen.add(trimmed);
    models.push(trimmed);
    if (models.length >= MAX_MODELS) break;
  }
  return models;
}

async function readBounded(response: Response): Promise<ImageProviderResult<string>> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    await response.body?.cancel().catch(() => {});
    return { ok: false, error: '图片服务返回内容过大，已放弃解析。' };
  }
  const body = response.body;
  if (!body) {
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) {
      return { ok: false, error: '图片服务返回内容过大，已放弃解析。' };
    }
    return ok(text);
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel().catch(() => {});
      return { ok: false, error: '图片服务返回内容过大，已放弃解析。' };
    }
    chunks.push(value);
  }
  return ok(Buffer.concat(chunks).toString('utf8'));
}

export async function queryImageProviderModels(
  connection: ImageProviderConnection,
  deps: ImageProviderModelsDeps = {}
): Promise<ImageProviderResult<{ models: string[] }>> {
  const base = normalizeImageProviderBaseUrl(connection.baseUrl);
  if (!base) return { ok: false, error: '图片服务地址无效。' };
  const apiKey = typeof connection.apiKey === 'string' ? connection.apiKey.trim() : '';
  if (!apiKey) return { ok: false, error: '请先填写图片服务 API Key。' };
  const url = `${base}/models`;
  const fetchImpl = deps.fetch ?? fetch;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<{ timedOut: true }>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve({ timedOut: true });
    }, TIMEOUT_MS);
    timer.unref?.();
  });
  try {
    const request = (async (): Promise<ImageProviderResult<{ models: string[] }>> => {
      await deps.prepare?.();
      if (controller.signal.aborted) return { ok: false, error: '图片服务请求超时。' };
      const response = await fetchImpl(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey}`, accept: 'application/json' },
        redirect: 'error',
        signal: controller.signal,
      });
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        return {
          ok: false,
          error:
            response.status === 401 || response.status === 403
              ? `认证失败（HTTP ${response.status}），请检查 API Key。`
              : `图片服务返回 HTTP ${response.status}。`,
        };
      }
      const body = await readBounded(response);
      if (!body.ok) return body;
      let payload: unknown;
      try {
        payload = JSON.parse(body.value);
      } catch {
        return ok({ models: [] });
      }
      return ok({ models: collectModels(payload) });
    })();
    const raced = await Promise.race([request, timeout]);
    if ('timedOut' in raced) return { ok: false, error: '图片服务请求超时。' };
    return raced;
  } catch (error) {
    return {
      ok: false,
      error: scrub(error instanceof Error ? error.message : String(error), apiKey),
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
