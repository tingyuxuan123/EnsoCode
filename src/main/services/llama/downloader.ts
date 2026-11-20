import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { finished } from 'node:stream/promises';
export interface DownloadableModelFile {
  name: string;
  /** 已知时下载完成后校验；缺省只校验长度 */
  sha256?: string;
  /** 不在 HF/ModelScope 上的文件：按序尝试的直链镜像，优先于 sources */
  urls?: readonly string[];
}

/** @deprecated Alias kept for callers */
export type EmbeddingModelFile = DownloadableModelFile;

export type DownloadSource = 'huggingface' | 'modelscope';

/**
 * 下载器只需要「哪些文件、从哪个仓库取」。用结构类型而不是绑定 EmbeddingModelSpec，
 * 让本地 chat 模型（GGUF）复用同一套断点续传 / 校验 / 镜像回退逻辑。
 */
export interface DownloadableModel {
  id: string;
  files: readonly EmbeddingModelFile[];
  sources: { huggingface: string | null; modelscope: string | null } | null;
}

export interface DownloadProgress {
  file: string;
  fileIndex: number;
  fileCount: number;
  /** 当前文件已落盘字节（含断点前已存在部分） */
  received: number;
  /** 服务端未给 Content-Length 时为 null */
  total: number | null;
}

export interface ModelDownloadEvent extends DownloadProgress {
  modelId: string;
  dir: string;
  done?: true;
  error?: string;
}

export interface DownloadModelOptions {
  fetch?: typeof fetch;
  onProgress?: (p: DownloadProgress) => void;
  signal?: AbortSignal;
  /** 尝试顺序；默认 HF 优先、ModelScope 回退 */
  sources?: DownloadSource[];
  /** 单来源单文件最大尝试次数 */
  maxAttempts?: number;
  /** 重试间隔基数（毫秒），测试传 0 */
  retryDelayMs?: number;
  /** 覆盖各来源根地址（测试指向本地 server；生产 HF 走 `HF_ENDPOINT` 环境变量） */
  endpoints?: Partial<Record<DownloadSource, string>>;
}

export class ModelDownloadError extends Error {
  constructor(
    readonly code: 'no_sources' | 'all_sources_failed' | 'checksum_mismatch' | 'aborted',
    message: string,
    readonly causes: unknown[] = []
  ) {
    super(message);
    this.name = 'ModelDownloadError';
  }
}

const READY_MARKER = '.ready';
const PART_SUFFIX = '.part';
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 1000;

// 两个来源都可用环境变量指向镜像（HF_ENDPOINT 常用于 hf-mirror.com）；未设时用官方地址
const DEFAULT_ENDPOINTS: Record<DownloadSource, () => string> = {
  huggingface: () => (process.env.HF_ENDPOINT ?? 'https://huggingface.co').replace(/\/+$/, ''),
  modelscope: () =>
    (process.env.MODELSCOPE_ENDPOINT ?? 'https://www.modelscope.cn').replace(/\/+$/, ''),
};

export function fileUrl(
  source: DownloadSource,
  repo: string,
  file: string,
  endpoints: Partial<Record<DownloadSource, string>> = {}
): string {
  const base = (endpoints[source] ?? DEFAULT_ENDPOINTS[source]()).replace(/\/+$/, '');
  const encoded = file.split('/').map(encodeURIComponent).join('/');
  return source === 'huggingface'
    ? `${base}/${repo}/resolve/main/${encoded}`
    : `${base}/models/${repo}/resolve/master/${encoded}`;
}

/** 目录下所有文件齐全且带完成标记才算可用；中途崩溃只剩 .part 时返回 false */
export function isModelReady(dir: string, spec: DownloadableModel): boolean {
  if (spec.files.length === 0) return false;
  if (!fs.existsSync(path.join(dir, READY_MARKER))) return false;
  return spec.files.every((f) => fs.existsSync(safeJoin(dir, f.name)));
}

/** 已落盘字节数（完成文件 + 未完成 .part），供 UI 在未开始前显示进度 */
export function downloadedBytes(dir: string, spec: DownloadableModel): number {
  let sum = 0;
  for (const f of spec.files) {
    const final = safeJoin(dir, f.name);
    const size = statSize(final) ?? statSize(final + PART_SUFFIX) ?? 0;
    sum += size;
  }
  return sum;
}

function statSize(p: string): number | null {
  try {
    return fs.statSync(p).size;
  } catch {
    return null;
  }
}

/** 注册表内文件名可信，但仍禁止越出模型目录 */
function safeJoin(dir: string, name: string): string {
  const resolved = path.resolve(dir, name);
  const root = path.resolve(dir);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error(`model file escapes model dir: ${name}`);
  }
  return resolved;
}

interface SharedDownload {
  controller: AbortController;
  progress: Set<(progress: DownloadProgress) => void>;
  promise: Promise<void>;
}

const downloads = new Map<string, SharedDownload>();
const downloadListeners = new Set<(event: ModelDownloadEvent) => void>();

export function subscribeModelDownloads(listener: (event: ModelDownloadEvent) => void): () => void {
  downloadListeners.add(listener);
  return () => {
    downloadListeners.delete(listener);
  };
}

function notifyDownload(event: ModelDownloadEvent): void {
  for (const listener of [...downloadListeners]) {
    // 通知失败不能把已下载权重变成失败任务。
    try {
      listener(event);
    } catch {}
  }
}

export function isModelDownloading(dir: string): boolean {
  return downloads.has(path.resolve(dir));
}

export function cancelModelDownload(dir: string): boolean {
  const task = downloads.get(path.resolve(dir));
  if (!task || task.controller.signal.aborted) return false;
  task.controller.abort();
  return true;
}

/** 自动/显式下载共用目录级任务及取消信号；旧任务完全退出后才允许后继接触文件。 */
export async function downloadModel(
  spec: DownloadableModel,
  dir: string,
  opts: DownloadModelOptions = {}
): Promise<void> {
  throwIfAborted(opts.signal);
  const key = path.resolve(dir);
  const previous = downloads.get(key);
  let task = previous;
  if (!task || task.controller.signal.aborted) {
    const controller = new AbortController();
    const progress = new Set<(progress: DownloadProgress) => void>();
    let error: string | undefined;
    const next: SharedDownload = {
      controller,
      progress,
      promise: Promise.resolve()
        .then(async () => {
          await previous?.promise.catch(() => {});
          throwIfAborted(controller.signal);
          await downloadModelFiles(spec, key, {
            ...opts,
            signal: controller.signal,
            onProgress: (p) => {
              if (controller.signal.aborted) return;
              notifyDownload({ modelId: spec.id, dir: key, ...p });
              for (const listener of progress) {
                if (controller.signal.aborted) break;
                listener(p);
              }
            },
          });
        })
        .catch((cause: unknown) => {
          error = cause instanceof Error ? cause.message : String(cause);
          throw cause;
        })
        .finally(() => {
          if (downloads.get(key) !== next) return;
          downloads.delete(key);
          notifyDownload({
            modelId: spec.id,
            dir: key,
            file: '',
            fileIndex: 0,
            fileCount: 0,
            received: 0,
            total: null,
            done: true,
            error,
          });
        }),
    };
    downloads.set(key, next);
    task = next;
  }
  const current = task;
  const abort = () => current.controller.abort();
  opts.signal?.addEventListener('abort', abort, { once: true });
  if (opts.onProgress) current.progress.add(opts.onProgress);
  try {
    await current.promise;
  } finally {
    opts.signal?.removeEventListener('abort', abort);
    if (opts.onProgress) current.progress.delete(opts.onProgress);
  }
}

/** 逐文件续传到 .part，校验后改名；全部就位才写 .ready。 */
async function downloadModelFiles(
  spec: DownloadableModel,
  dir: string,
  opts: DownloadModelOptions
): Promise<void> {
  throwIfAborted(opts.signal);
  const direct = spec.files.length > 0 && spec.files.every((f) => f.urls?.length);
  if (!spec.sources && !direct)
    throw new ModelDownloadError('no_sources', `${spec.id} has no download sources`);
  const sources = (opts.sources ?? ['huggingface', 'modelscope']).filter((s) => spec.sources?.[s]);
  if (sources.length === 0 && !direct) {
    throw new ModelDownloadError('no_sources', `${spec.id} has no usable download sources`);
  }
  fs.mkdirSync(dir, { recursive: true });
  // 重新开始下载时清掉旧标记，避免中途失败仍被视为可用
  fs.rmSync(path.join(dir, READY_MARKER), { force: true });

  for (let i = 0; i < spec.files.length; i++) {
    throwIfAborted(opts.signal);
    const file = spec.files[i];
    const final = safeJoin(dir, file.name);
    // 已存在的文件每次都重新校验 sha256：损坏/被替换的权重不能因为“文件在”就被当作就绪（3a 评审 Major 3）
    if (fs.existsSync(final) && file.sha256) {
      const actual = await sha256File(final);
      throwIfAborted(opts.signal);
      if (actual !== file.sha256.toLowerCase()) fs.rmSync(final, { force: true });
    }
    if (fs.existsSync(final)) {
      report(opts, {
        file: file.name,
        fileIndex: i,
        fileCount: spec.files.length,
        received: statSize(final) ?? 0,
        total: statSize(final),
      });
      continue;
    }
    fs.mkdirSync(path.dirname(final), { recursive: true });
    const causes: unknown[] = [];
    let done = false;
    const urls =
      file.urls ??
      sources.map((s) => fileUrl(s, spec.sources?.[s] as string, file.name, opts.endpoints));
    for (const url of urls) {
      try {
        await downloadFile(url, final, file, {
          ...opts,
          fileIndex: i,
          fileCount: spec.files.length,
        });
        done = true;
        break;
      } catch (error) {
        if (error instanceof ModelDownloadError && error.code !== 'checksum_mismatch') throw error;
        causes.push(error);
      }
    }
    if (!done) {
      throw new ModelDownloadError(
        'all_sources_failed',
        `failed to download ${file.name} for ${spec.id}`,
        causes
      );
    }
  }
  throwIfAborted(opts.signal);
  fs.writeFileSync(
    path.join(dir, READY_MARKER),
    JSON.stringify({
      id: spec.id,
      files: spec.files.map((f) => f.name),
      at: new Date().toISOString(),
    })
  );
}

function report(opts: DownloadModelOptions, p: DownloadProgress): void {
  opts.onProgress?.(p);
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new ModelDownloadError('aborted', 'download aborted');
}

async function downloadFile(
  url: string,
  final: string,
  file: EmbeddingModelFile,
  opts: DownloadModelOptions & { fileIndex: number; fileCount: number }
): Promise<void> {
  const part = final + PART_SUFFIX;
  const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const delayBase = opts.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    throwIfAborted(opts.signal);
    try {
      await fetchToPart(url, part, file, opts);
      throwIfAborted(opts.signal);
      // 校验在整文件上做：断点续传后前半段不在本次流里
      if (file.sha256) {
        const actual = await sha256File(part);
        throwIfAborted(opts.signal);
        if (actual !== file.sha256.toLowerCase()) {
          fs.rmSync(part, { force: true });
          throw new ModelDownloadError(
            'checksum_mismatch',
            `${file.name}: sha256 ${actual} != ${file.sha256}`
          );
        }
      }
      fs.renameSync(part, final);
      return;
    } catch (error) {
      // 进行中的 fetch 被取消抛的是 AbortError，不是我们的错误类：同样不重试、不换源（3a 评审 Major 2）
      if (opts.signal?.aborted || isAbortError(error)) {
        throw new ModelDownloadError('aborted', 'download aborted');
      }
      if (error instanceof ModelDownloadError && error.code === 'aborted') throw error;
      lastError = error;
      if (attempt + 1 < maxAttempts && delayBase > 0) {
        await new Promise((r) => setTimeout(r, delayBase * 2 ** attempt));
      }
    }
  }
  throw lastError;
}

async function fetchToPart(
  url: string,
  part: string,
  file: EmbeddingModelFile,
  opts: DownloadModelOptions & { fileIndex: number; fileCount: number }
): Promise<void> {
  const doFetch = opts.fetch ?? fetch;
  let offset = statSize(part) ?? 0;
  const headers: Record<string, string> = {};
  if (offset > 0) headers.Range = `bytes=${offset}-`;
  const res = await doFetch(url, { headers, signal: opts.signal, redirect: 'follow' });
  throwIfAborted(opts.signal);
  let total: number | null = null;
  if (res.status === 416 && offset > 0) {
    // 部分网关对任何 Range 都回 416：必须拿到真实总长并与 .part 比对，否则半个 tokenizer.json
    // 会被当成完整文件（没有 sha256 的文件无从拦截；3a 评审 Major 1）
    const full = await remoteLength(doFetch, url, res, opts.signal);
    throwIfAborted(opts.signal);
    if (full !== null && full === offset) return;
    fs.rmSync(part, { force: true });
    throw new Error(
      `${file.name}: 416 with local ${offset} bytes but remote length ${full ?? 'unknown'}`
    );
  }
  if (res.status === 206) {
    const range = /bytes \d+-\d+\/(\d+)/.exec(res.headers.get('content-range') ?? '');
    total = range ? Number(range[1]) : null;
  } else if (res.status === 200) {
    // 服务端不支持 Range：从头重下
    if (offset > 0) fs.rmSync(part, { force: true });
    offset = 0;
    const len = res.headers.get('content-length');
    total = len ? Number(len) : null;
  } else {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  if (!res.body) throw new Error(`empty body for ${url}`);

  const fd = fs.openSync(part, offset > 0 ? 'a' : 'w');
  let received = offset;
  const reader = res.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      throwIfAborted(opts.signal);
      if (done) break;
      if (value) {
        fs.writeSync(fd, value);
        received += value.byteLength;
        report(opts, {
          file: file.name,
          fileIndex: opts.fileIndex,
          fileCount: opts.fileCount,
          received,
          total,
        });
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
    fs.closeSync(fd);
  }
  if (total !== null && received !== total) {
    throw new Error(`${file.name}: received ${received} of ${total} bytes`);
  }
}

/** 416 响应的 `Content-Range: bytes *\/<len>`（RFC 9110 §14.4）优先；缺失时补一次 HEAD */
async function remoteLength(
  doFetch: typeof fetch,
  url: string,
  res: Response,
  signal: AbortSignal | undefined
): Promise<number | null> {
  const fromRange = /bytes \*\/(\d+)/.exec(res.headers.get('content-range') ?? '');
  if (fromRange) return Number(fromRange[1]);
  try {
    const head = await doFetch(url, { method: 'HEAD', signal, redirect: 'follow' });
    const len = head.ok ? head.headers.get('content-length') : null;
    return len && /^\d+$/.test(len) ? Number(len) : null;
  } catch (error) {
    if (isAbortError(error)) throw error;
    return null;
  }
}

function isAbortError(error: unknown): boolean {
  return (error as { name?: unknown } | null)?.name === 'AbortError';
}

export async function sha256File(p: string): Promise<string> {
  const hash = createHash('sha256');
  const stream = fs.createReadStream(p);
  stream.on('data', (chunk) => hash.update(chunk));
  // end 只表示读完；close 后文件句柄才释放，后继任务才能安全删除/改名。
  await finished(stream);
  return hash.digest('hex');
}
