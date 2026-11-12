import { randomUUID } from 'node:crypto';
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { mkdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  GENERATED_IMAGE_DIR,
  IMAGE_PROMPT_MAX,
  IMAGE_REQUEST_TIMEOUT_MS,
  type ImageGenerationInput,
  type ImageGenerationResult,
  isGeneratedImageId,
} from '@shared/imageGeneration';
import {
  type ImageProviderSettings,
  imageOutputParams,
  parseImageProviderSettings,
} from '@shared/imageProvider';
import { sniffImageMime } from '@shared/imageSniff';
import {
  fetchRemoteImageDataUrl,
  type RemoteImageFetchOptions,
  type RemoteImageFetchResult,
} from '../remoteImageFetch';

/**
 * 用户自配「OpenAI 兼容」图片服务的生图/改图实现（对齐 open-vetta 的上游协议）。
 *
 * 只讲一种协议：
 * - 文生图 `POST {baseUrl}/images/generations`（JSON）
 * - 图生图 `POST {baseUrl}/images/edits`（multipart，单个 `image` 字段）
 *
 * 边界：
 * - API key 只来自调用方传入的 config，只在发请求那一刻写进 `Authorization`；
 *   错误回显先抹 key 再截断，且不回显上游原始正文（只取结构化 message 字段）。
 * - endpoint 允许用户本机 http 服务，但禁止内嵌凭据 / query / hash；POST 不跟随重定向
 *   （由 `fetch` 默认行为 + `redirect: 'error'` 保证）。URL 结果一律走现有公网图片代理
 *   （`fetchRemoteImageDataUrl`），复用它的 SSRF/重定向/DNS rebinding 防护，也不向 CDN 带 key。
 * - 不自动重试（上游按次收费）；429 / 5xx / 超时 / 网络错误只把 `retryable` 报给调用方。
 * - 产物固定落 `cwd/.xiaoman/images/<uuid>.<png|jpg|webp|gif>`，返回 cwd 相对路径。
 * - 参考图只允许 cwd 内的普通文件（含解析后仍在 cwd 内的符号链接）；
 *   `.xiaoman` / `images` 本身不允许是符号链接，避免写出工作区。
 */

export interface ImageProviderConfig {
  baseUrl: string;
  apiKey: string;
  modelId: string;
  output?: ImageProviderSettings;
}

export interface ImageGenerationDeps {
  /** 只用于模拟上游 POST；下载走 `download`。 */
  fetch?: typeof fetch;
  /** 默认实现是公网图片代理 `fetchRemoteImageDataUrl`；测试注入用。 */
  download?: (url: string, signal: AbortSignal) => Promise<RemoteImageFetchResult>;
  /** 仅测试用：固定产物 id，验证不覆盖已有文件。 */
  nextId?: () => string;
}

const DEFAULT_SIZE = '1024x1024';
const MIN_EDGE = 64;
const MAX_EDGE = 4096;
/** 解码后的图片字节上限（响应 b64、下载、参考图共用）。 */
const MAX_IMAGE_BYTES = 32 * 1024 * 1024;
/** 32MiB 图片转 base64 约 44.7MB，JSON 外壳再留一点余量。 */
const MAX_RESPONSE_BYTES = 48 * 1024 * 1024;
const MAX_UPSTREAM_ERROR_BYTES = 64 * 1024;
const ERROR_MAX_LENGTH = 300;
const MAX_SOURCE_PATH_LENGTH = 4096;
const OUTPUT_SEGMENTS = GENERATED_IMAGE_DIR.split('/');
const ALLOWED_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};
/** sourceImageId 解析时按固定顺序找这些扩展名。 */
const ALLOWED_EXTENSIONS = ['png', 'jpg', 'webp', 'gif'] as const;
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;
const DATA_URL_PATTERN = /^data:([a-z]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/]+={0,2})$/;

/** 服务内部的一次性失败；顶层统一转成 `{ ok: false, error, retryable }`。 */
class GenerationError extends Error {
  readonly retryable: boolean;

  constructor(message: string, retryable = false) {
    super(message);
    this.name = 'GenerationError';
    this.retryable = retryable;
  }
}

interface ParsedInput {
  prompt: string;
  size: string;
  sourceImageId?: string;
  sourceImagePath?: string;
}

interface Workspace {
  root: string;
  outputDir: string;
}

interface ImageBytes {
  bytes: Buffer;
  mimeType: string;
}

export async function generateImage(
  input: ImageGenerationInput,
  cwd: string,
  config: ImageProviderConfig,
  signal?: AbortSignal,
  deps: ImageGenerationDeps = {}
): Promise<ImageGenerationResult> {
  try {
    return await run(input, cwd, config, signal, deps);
  } catch (error) {
    // 取消是调用方的决定，不是失败：原样抛给调用方识别，绝不伪造 ok:false。
    if (signal?.aborted) throw error;
    const apiKey = typeof config?.apiKey === 'string' ? config.apiKey.trim() : '';
    if (error instanceof GenerationError) {
      return {
        ok: false,
        error: truncateError(redact(error.message, apiKey)),
        retryable: error.retryable,
      };
    }
    const timedOut = error instanceof Error && error.name === 'TimeoutError';
    const message = timedOut
      ? 'Image request timed out'
      : error instanceof Error
        ? error.message
        : 'Image request failed';
    return { ok: false, error: truncateError(redact(message, apiKey)), retryable: true };
  }
}

async function run(
  input: ImageGenerationInput,
  cwd: string,
  config: ImageProviderConfig,
  signal: AbortSignal | undefined,
  deps: ImageGenerationDeps
): Promise<ImageGenerationResult> {
  const { baseUrl, apiKey, modelId } = readConfig(config);
  const parsed = readInput(input);
  const output =
    config.output === undefined ? undefined : parseImageProviderSettings(config.output);
  if (config.output !== undefined && !output)
    throw new GenerationError('Invalid image output settings');
  const params = output ? imageOutputParams(output, input.size) : { size: parsed.size };
  const workspace = await resolveWorkspace(cwd);
  const source = await readSourceImage(parsed, workspace);

  const endpoint = `${baseUrl}/images/${source ? 'edits' : 'generations'}`;
  const requestSignal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(IMAGE_REQUEST_TIMEOUT_MS)])
    : AbortSignal.timeout(IMAGE_REQUEST_TIMEOUT_MS);
  const fetchImpl = deps.fetch ?? fetch;
  throwIfAborted(signal);

  const response = await fetchImpl(endpoint, {
    method: 'POST',
    redirect: 'error',
    signal: requestSignal,
    ...(source
      ? {
          headers: { Authorization: `Bearer ${apiKey}` },
          body: buildEditForm(modelId, parsed, source, params),
        }
      : {
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...params, model: modelId, prompt: parsed.prompt, n: 1 }),
        }),
  });

  if (!response.ok) {
    const detail = await readUpstreamError(response, apiKey);
    throw new GenerationError(detail, isRetryableStatus(response.status));
  }

  const image = await readResultImage(response, requestSignal, deps);
  throwIfAborted(signal);

  const extension = EXTENSIONS[image.mimeType];
  const id = (deps.nextId ?? randomUUID)().toLowerCase();
  if (!isGeneratedImageId(id)) throw new GenerationError('Generated image id is not a UUID');
  const fileName = `${id}.${extension}`;
  writeGeneratedImage(workspace, fileName, image.bytes, requestSignal);
  const parentId = parsed.sourceImageId?.toLowerCase();

  return {
    ok: true,
    image: {
      id,
      path: `${GENERATED_IMAGE_DIR}/${fileName}`,
      mimeType: image.mimeType,
      ...(parentId ? { parentId } : {}),
    },
  };
}

function readConfig(config: ImageProviderConfig): {
  baseUrl: string;
  apiKey: string;
  modelId: string;
} {
  const baseUrl = normalizeBaseUrl(config?.baseUrl);
  if (!baseUrl) {
    throw new GenerationError('baseUrl must be an http(s) URL without credentials, query or hash');
  }
  const apiKey = typeof config.apiKey === 'string' ? config.apiKey.trim() : '';
  if (!apiKey) throw new GenerationError('The image service API key is missing');
  const modelId = typeof config.modelId === 'string' ? config.modelId.trim() : '';
  if (!modelId) throw new GenerationError('The image model id is missing');
  return { baseUrl, apiKey, modelId };
}

function normalizeBaseUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.includes('?') || trimmed.includes('#')) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  if (url.search || url.hash) return null;
  return trimmed.replace(/\/+$/, '');
}

function readInput(input: ImageGenerationInput): ParsedInput {
  const prompt = typeof input?.prompt === 'string' ? input.prompt : '';
  if (prompt.trim().length === 0) throw new GenerationError('prompt must be a non-empty string');
  if (prompt.length > IMAGE_PROMPT_MAX) {
    throw new GenerationError(`prompt must be at most ${IMAGE_PROMPT_MAX} characters`);
  }
  const size = normalizeSize(input?.size);
  if (!size)
    throw new GenerationError(`size must be WIDTHxHEIGHT between ${MIN_EDGE} and ${MAX_EDGE}`);

  const sourceImageId = readOptionalString(input?.sourceImageId);
  const sourceImagePath = readOptionalString(input?.sourceImagePath);
  if (sourceImageId === null || sourceImagePath === null) {
    throw new GenerationError('The image source must be a string id or path');
  }
  if (sourceImageId !== undefined && sourceImagePath !== undefined) {
    throw new GenerationError('Pass either sourceImageId or sourceImagePath, not both');
  }
  if (sourceImageId !== undefined && !isGeneratedImageId(sourceImageId.toLowerCase())) {
    throw new GenerationError('sourceImageId must be a UUID from the image output directory');
  }
  if (
    sourceImagePath !== undefined &&
    (sourceImagePath.length === 0 ||
      sourceImagePath.length > MAX_SOURCE_PATH_LENGTH ||
      sourceImagePath.includes('\u0000'))
  ) {
    throw new GenerationError('sourceImagePath is not a valid path');
  }
  return {
    prompt,
    size,
    ...(sourceImageId !== undefined ? { sourceImageId } : {}),
    ...(sourceImagePath !== undefined ? { sourceImagePath } : {}),
  };
}

/** `undefined` 表示没传；`null` 表示传了但不是字符串。 */
function readOptionalString(value: unknown): string | undefined | null {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') return null;
  return value;
}

function normalizeSize(raw: unknown): string | null {
  if (raw === undefined) return DEFAULT_SIZE;
  if (typeof raw !== 'string') return null;
  const match = /^(\d{1,4})x(\d{1,4})$/.exec(raw);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (width < MIN_EDGE || width > MAX_EDGE || height < MIN_EDGE || height > MAX_EDGE) return null;
  return `${width}x${height}`;
}

async function resolveWorkspace(cwd: string): Promise<Workspace> {
  if (typeof cwd !== 'string' || !cwd || !path.isAbsolute(cwd)) {
    throw new GenerationError('cwd must be an absolute workspace path');
  }
  const root = await realpath(cwd).catch(() => null);
  if (!root) throw new GenerationError('cwd is not accessible');
  const rootInfo = await stat(root).catch(() => null);
  if (!rootInfo?.isDirectory()) throw new GenerationError('cwd is not a directory');

  let outputDir = root;
  for (const segment of OUTPUT_SEGMENTS) {
    outputDir = path.join(outputDir, segment);
    const created = await mkdir(outputDir, { recursive: true }).then(
      () => true,
      () => false
    );
    if (!created) throw new GenerationError('Cannot create the image output directory');
    const canonical = await realpath(outputDir).catch(() => null);
    // 拒绝符号链接（含指向工作区外的 .xiaoman / images），避免产物写到工作区之外。
    if (canonical !== outputDir) {
      throw new GenerationError('The image output directory must not be a symlink');
    }
    const info = await stat(outputDir).catch(() => null);
    if (!info?.isDirectory())
      throw new GenerationError('The image output directory is not a directory');
  }
  return { root, outputDir };
}

async function readSourceImage(
  parsed: ParsedInput,
  workspace: Workspace
): Promise<ImageBytes | undefined> {
  if (parsed.sourceImageId !== undefined) {
    return await readImageBytes(
      await resolveGeneratedSource(workspace, parsed.sourceImageId),
      'source image',
      workspace.root
    );
  }
  if (parsed.sourceImagePath !== undefined) {
    const file = await resolveSourcePath(workspace.root, parsed.sourceImagePath);
    return await readImageBytes(file, 'source image', workspace.root);
  }
  return undefined;
}

async function resolveGeneratedSource(
  workspace: Workspace,
  sourceImageId: string
): Promise<string> {
  const id = sourceImageId.toLowerCase();
  for (const extension of ALLOWED_EXTENSIONS) {
    const candidate = path.join(workspace.outputDir, `${id}.${extension}`);
    const info = await stat(candidate).catch(() => null);
    if (!info?.isFile()) continue;
    const canonical = await realpath(candidate).catch(() => null);
    if (!canonical || !isInsideOrEqual(workspace.root, canonical)) {
      throw new GenerationError('The source image must stay inside the workspace');
    }
    return canonical;
  }
  throw new GenerationError('The source image was not found in the image output directory');
}

async function resolveSourcePath(root: string, raw: string): Promise<string> {
  // 绝对路径直接用，相对路径按工作区解析；两者都要在 realpath 后仍在工作区内。
  const absolute = path.resolve(root, raw);
  const canonical = await realpath(absolute).catch(() => null);
  if (!canonical) throw new GenerationError('The source image path does not exist');
  // 允许「受控符号链接」：链接本身可以，但解析后的真实路径必须在工作区内。
  if (!isInside(root, canonical)) {
    throw new GenerationError('The source image path must stay inside the workspace');
  }
  const info = await stat(canonical).catch(() => null);
  if (!info?.isFile()) throw new GenerationError('The source image path is not a regular file');
  return canonical;
}

function isInsideOrEqual(root: string, target: string): boolean {
  return target === root || isInside(root, target);
}

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

async function readImageBytes(file: string, label: string, root: string): Promise<ImageBytes> {
  const bytes = readFileBounded(file, label, root);
  const mimeType = sniffImageMime(bytes);
  if (!mimeType || !ALLOWED_MIME_TYPES.has(mimeType)) {
    throw new GenerationError(`The ${label} must be a png, jpeg, webp or gif image`);
  }
  return { bytes, mimeType };
}

function readFileBounded(file: string, label: string, root: string): Buffer {
  let fd: number | undefined;
  try {
    // No await between canonicalization, opening and identity verification. Read only the
    // checked descriptor; O_NOFOLLOW also protects a replaced leaf (where supported).
    const canonical = realpathSync(file);
    if (!isInside(root, canonical))
      throw new GenerationError('The source image must stay inside the workspace');
    const before = lstatSync(canonical);
    fd = openSync(
      canonical,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0)
    );
    const info = fstatSync(fd);
    if (!info.isFile()) throw new GenerationError(`The ${label} is not a regular file`);
    if (before.dev !== info.dev || before.ino !== info.ino || realpathSync(canonical) !== canonical)
      throw new GenerationError('The source image changed while opening');
    if (info.size > MAX_IMAGE_BYTES) {
      throw new GenerationError(`The ${label} is larger than 32 MiB`);
    }
    const bytes = Buffer.alloc(info.size + 1);
    let total = 0;
    while (total < bytes.length) {
      const count = readSync(fd, bytes, total, bytes.length - total, null);
      if (!count) break;
      total += count;
    }
    const after = fstatSync(fd);
    if (
      total !== info.size ||
      after.size !== info.size ||
      after.mtimeMs !== info.mtimeMs ||
      after.ctimeMs !== info.ctimeMs
    )
      throw new GenerationError('The source image changed while reading');
    return bytes.subarray(0, total);
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function buildEditForm(
  modelId: string,
  parsed: ParsedInput,
  source: ImageBytes,
  params: Record<string, unknown>
): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined)
      form.set(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
  }
  form.set('model', modelId);
  form.set('prompt', parsed.prompt);
  form.set('n', '1');
  form.set(
    'image',
    new Blob([new Uint8Array(source.bytes)], { type: source.mimeType }),
    `image.${EXTENSIONS[source.mimeType]}`
  );
  return form;
}

async function readResultImage(
  response: Response,
  requestSignal: AbortSignal,
  deps: ImageGenerationDeps
): Promise<ImageBytes> {
  const raw = await readResponseBounded(response, MAX_RESPONSE_BYTES);
  let payload: unknown;
  try {
    payload = JSON.parse(raw.toString('utf8'));
  } catch {
    throw new GenerationError('The image service returned a malformed response');
  }
  const item = firstResultItem(payload);
  if (!item) throw new GenerationError('The image service response did not include image data');

  if (typeof item.b64Json === 'string' && item.b64Json.length > 0) {
    return decodeImage(
      decodeBase64(item.b64Json),
      'The image service returned an unsupported image format'
    );
  }
  if (typeof item.url === 'string' && item.url.length > 0) {
    const downloadImpl = deps.download ?? defaultDownload;
    const downloaded = await downloadImpl(item.url, requestSignal);
    if (!downloaded.ok) {
      throw new GenerationError(
        `Image download failed: ${downloaded.error}`,
        isRetryableDownloadError(downloaded.error)
      );
    }
    const match = DATA_URL_PATTERN.exec(downloaded.dataUrl);
    if (!match) throw new GenerationError('Image download did not return base64 image data');
    return decodeImage(decodeBase64(match[2]), 'Image download did not return a supported image');
  }
  throw new GenerationError('The image service response did not include image data');
}

function firstResultItem(payload: unknown): { b64Json?: unknown; url?: unknown } | null {
  const record = asRecord(payload);
  const data = record?.data;
  if (!Array.isArray(data) || data.length === 0) return null;
  const item = asRecord(data[0]);
  if (!item) return null;
  return { b64Json: item.b64_json, url: item.url };
}

/** JSON.parse 的产物只能是 unknown，这里把「已验证是普通对象」的那一步收成一个地方。 */
function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function decodeBase64(raw: string): Buffer {
  const maxChars = Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 4;
  if (raw.length > maxChars) throw new GenerationError('The image is larger than 32 MiB');
  // 严格 base64：不接空白、不接 data URL 前缀、padding 与长度都要合法。
  if (raw.length === 0 || raw.length % 4 !== 0 || !BASE64_PATTERN.test(raw)) {
    throw new GenerationError('The image service returned malformed base64 image data');
  }
  const bytes = Buffer.from(raw, 'base64');
  if (bytes.length === 0) throw new GenerationError('The image service returned an empty image');
  if (bytes.length > MAX_IMAGE_BYTES) throw new GenerationError('The image is larger than 32 MiB');
  return bytes;
}

function decodeImage(bytes: Buffer, unsupportedMessage: string): ImageBytes {
  const mimeType = sniffImageMime(bytes);
  // 魔数说话：只认 png/jpeg/webp/gif，声明的 Content-Type / 扩展名都不作数。
  if (!mimeType || !ALLOWED_MIME_TYPES.has(mimeType)) throw new GenerationError(unsupportedMessage);
  return { bytes, mimeType };
}

function defaultDownload(url: string, signal: AbortSignal): Promise<RemoteImageFetchResult> {
  // 走现有公网图片代理：它自己带协议/字面量 IP/DNS rebinding/重定向/大小/魔数校验，
  // 且不会把 API key 发给 CDN。这里只补 32MiB 上限、超时与取消。
  const options: RemoteImageFetchOptions & { signal?: AbortSignal } = {
    maxBytes: MAX_IMAGE_BYTES,
    timeoutMs: IMAGE_REQUEST_TIMEOUT_MS,
    signal,
  };
  return withAbort(fetchRemoteImageDataUrl(url, options), signal);
}

function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    promise.catch(() => {});
    return Promise.reject(abortError());
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      }
    );
  });
}

function isRetryableDownloadError(error: string): boolean {
  return error === 'timeout' || error === 'unavailable' || error === 'too-many-redirects';
}

async function readUpstreamError(response: Response, apiKey: string): Promise<string> {
  const fallback = `HTTP ${response.status}`;
  let text: string;
  try {
    text = (await readResponseBounded(response, MAX_UPSTREAM_ERROR_BYTES, false)).toString('utf8');
  } catch {
    return fallback;
  }
  try {
    const parsed: unknown = JSON.parse(text);
    const message = upstreamMessage(parsed);
    // 只回显结构化 message，不回显原始正文（避免把网关 HTML 整页塞给模型）。
    if (message) return truncateError(redact(`${fallback}: ${message}`, apiKey));
  } catch {
    // 非 JSON 正文直接丢掉
  }
  return fallback;
}

function upstreamMessage(payload: unknown): string | undefined {
  const record = asRecord(payload);
  if (!record) return undefined;
  const error = record.error;
  if (typeof error === 'string') return error;
  const nested = asRecord(error)?.message;
  if (typeof nested === 'string') return nested;
  return typeof record.message === 'string' ? record.message : undefined;
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

async function readResponseBounded(
  response: Response,
  maxBytes: number,
  failWhenTooLarge = true
): Promise<Buffer> {
  const declared = Number(response.headers.get('content-length') ?? Number.NaN);
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => {});
    if (failWhenTooLarge) throw new GenerationError('The image service response is too large');
    return Buffer.alloc(0);
  }
  const body = response.body;
  if (!body) return Buffer.alloc(0);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        if (failWhenTooLarge) throw new GenerationError('The image service response is too large');
        return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock?.();
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
}

function writeGeneratedImage(
  workspace: Workspace,
  fileName: string,
  bytes: Buffer,
  signal: AbortSignal | undefined
): void {
  throwIfAborted(signal);
  const target = path.join(workspace.outputDir, fileName);
  let fd: number | undefined;
  let created = false;
  try {
    // Recheck after the (potentially 5-minute) HTTP wait, not just before requesting.
    // Synchronous admission/open/write has no JS scheduling gap. The opened file is
    // checked against the canonical path before any image bytes are written.
    for (const directory of [
      workspace.root,
      path.dirname(workspace.outputDir),
      workspace.outputDir,
    ]) {
      if (realpathSync(directory) !== directory || !lstatSync(directory).isDirectory())
        throw new GenerationError('The image output directory changed during generation');
    }
    // wx：绝不覆盖已有文件（UUID 碰撞或注入 id 时直接失败）。
    fd = openSync(
      target,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0),
      0o600
    );
    created = true;
    const actual = fstatSync(fd);
    const current = lstatSync(target);
    if (
      realpathSync(workspace.outputDir) !== workspace.outputDir ||
      !current.isFile() ||
      current.dev !== actual.dev ||
      current.ino !== actual.ino
    )
      throw new GenerationError('The image output directory changed while opening');
    writeFileSync(fd, bytes);
  } catch (error) {
    const failure = mapWriteError(error, created);
    if (fd !== undefined) {
      closeSync(fd);
      fd = undefined;
    }
    if (created) {
      try {
        unlinkSync(target);
      } catch {
        /* Do not remove other paths. */
      }
    }
    throw failure;
  }
  if (fd !== undefined) closeSync(fd);
  // 落盘后才被取消：删掉自己写的文件，避免留下半成品。
  if (signal?.aborted) {
    try {
      unlinkSync(target);
    } catch {
      /* Best-effort cleanup. */
    }
    throw abortError();
  }
}

function mapWriteError(error: unknown, created: boolean): GenerationError {
  if (error instanceof GenerationError) return error;
  const code = (error as NodeJS.ErrnoException | null)?.code;
  if (code === 'EEXIST' && !created) {
    return new GenerationError('An image already exists at the target path');
  }
  return new GenerationError('Failed to write the generated image');
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortError();
}

function abortError(): DOMException {
  return new DOMException('The image generation was cancelled', 'AbortError');
}

function redact(text: string, apiKey: string): string {
  return apiKey ? text.split(apiKey).join('***') : text;
}

function truncateError(text: string): string {
  return text.length > ERROR_MAX_LENGTH ? `${text.slice(0, ERROR_MAX_LENGTH)}…` : text;
}
