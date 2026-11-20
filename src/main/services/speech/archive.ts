import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { type DownloadProgress, ModelDownloadError, sha256File } from '../llama/downloader';
import type { SpeechModelSpec } from './model';

const PART = '.archive.part';
const EXTRACT = '.extract';
const READY = '.ready';

export interface ArchiveDownloadOptions {
  fetch?: typeof fetch;
  signal?: AbortSignal;
  onProgress?: (p: DownloadProgress) => void;
  maxAttempts?: number;
  retryDelayMs?: number;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new ModelDownloadError('aborted', 'download aborted');
}

/**
 * 整包模型：续传到 .archive.part → 校验包 sha256 → 系统 tar 只解出注册文件 → 逐个校验 → 换入并写 .ready。
 * macOS / Linux / Windows 10+ 都自带支持 bzip2 的 tar，不为一个模型引入解压依赖。
 */
export async function downloadArchiveModel(
  spec: SpeechModelSpec,
  dir: string,
  opts: ArchiveDownloadOptions = {}
): Promise<void> {
  const archive = spec.archive;
  if (!archive) throw new ModelDownloadError('no_sources', `${spec.id} has no archive`);
  throwIfAborted(opts.signal);
  fs.mkdirSync(dir, { recursive: true });
  fs.rmSync(path.join(dir, READY), { force: true });
  const part = path.join(dir, PART);
  const maxAttempts = opts.maxAttempts ?? 3;
  const delay = opts.retryDelayMs ?? 1000;
  for (let attempt = 1; ; attempt++) {
    try {
      await fetchResumable(archive.url, part, archive.bytes, opts);
      break;
    } catch (error) {
      if (opts.signal?.aborted || (error as { name?: unknown })?.name === 'AbortError') {
        throw new ModelDownloadError('aborted', 'download aborted');
      }
      if (attempt >= maxAttempts) throw error;
      if (delay > 0) await new Promise((r) => setTimeout(r, delay * 2 ** (attempt - 1)));
    }
  }
  const actual = await sha256File(part);
  throwIfAborted(opts.signal);
  if (actual !== archive.sha256) {
    fs.rmSync(part, { force: true });
    throw new ModelDownloadError(
      'checksum_mismatch',
      `archive sha256 ${actual} != ${archive.sha256}`
    );
  }
  const tmp = path.join(dir, EXTRACT);
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  try {
    const members = spec.files.map((f) => `${archive.root}/${f.name}`);
    // 压缩格式交给 tar 自动识别（bzip2 模型包 / gzip 引擎包）
    await promisify(execFile)('tar', ['-xf', part, '-C', tmp, ...members], {
      signal: opts.signal,
    });
    for (const file of spec.files) {
      const extracted = path.join(tmp, archive.root, file.name);
      if (file.sha256 && (await sha256File(extracted)) !== file.sha256) {
        throw new ModelDownloadError('checksum_mismatch', `${file.name}: sha256 mismatch`);
      }
    }
    for (const file of spec.files) {
      const final = path.join(dir, file.name);
      fs.mkdirSync(path.dirname(final), { recursive: true });
      fs.renameSync(path.join(tmp, archive.root, file.name), final);
    }
  } catch (error) {
    if (opts.signal?.aborted) throw new ModelDownloadError('aborted', 'download aborted');
    throw error;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  fs.rmSync(part, { force: true });
  fs.writeFileSync(
    path.join(dir, READY),
    JSON.stringify({
      id: spec.id,
      files: spec.files.map((f) => f.name),
      at: new Date().toISOString(),
    })
  );
}

async function fetchResumable(
  url: string,
  part: string,
  expected: number,
  opts: ArchiveDownloadOptions
): Promise<void> {
  let offset = fs.existsSync(part) ? fs.statSync(part).size : 0;
  if (offset === expected) return;
  if (offset > expected) {
    fs.rmSync(part, { force: true });
    offset = 0;
  }
  const res = await (opts.fetch ?? fetch)(url, {
    headers: offset > 0 ? { Range: `bytes=${offset}-` } : {},
    signal: opts.signal,
    redirect: 'follow',
  });
  throwIfAborted(opts.signal);
  if (res.status === 200) offset = 0;
  else if (res.status !== 206) throw new Error(`HTTP ${res.status} for ${url}`);
  if (!res.body) throw new Error(`empty body for ${url}`);
  const fd = fs.openSync(part, offset > 0 ? 'a' : 'w');
  let received = offset;
  const reader = res.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      throwIfAborted(opts.signal);
      if (done) break;
      fs.writeSync(fd, value);
      received += value.byteLength;
      opts.onProgress?.({
        file: path.basename(url),
        fileIndex: 0,
        fileCount: 1,
        received,
        total: expected,
      });
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
    fs.closeSync(fd);
  }
  if (received !== expected) throw new Error(`received ${received} of ${expected} bytes`);
}
