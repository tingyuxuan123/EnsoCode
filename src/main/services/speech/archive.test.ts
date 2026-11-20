import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isModelReady } from '../llama/downloader';
import { downloadArchiveModel } from './archive';
import type { SpeechModelSpec } from './model';

const sha = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');

let root: string;
let archive: Buffer;

function makeArchive(files: Record<string, string>): Buffer {
  const src = path.join(root, 'src');
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(src, name)), { recursive: true });
    writeFileSync(path.join(src, name), body);
  }
  const out = path.join(root, 'model.tar.bz2');
  execFileSync('tar', ['-cjf', out, '-C', src, 'pkg']);
  return readFileSync(out);
}

function spec(overrides: Partial<SpeechModelSpec> = {}): SpeechModelSpec {
  return {
    id: 'x-asr-streaming',
    streaming: true,
    approxBytes: archive.length,
    memoryBytes: 1,
    files: [
      { name: 'encoder.onnx', sha256: sha('ENC') },
      { name: 'tokens.txt', sha256: sha('TOK') },
    ],
    sources: null,
    archive: {
      url: 'https://example.test/pkg.tar.bz2',
      sha256: sha(archive),
      bytes: archive.length,
      root: 'pkg',
    },
    ...overrides,
  };
}

/** 支持 Range 的假服务端，记录每次请求头 */
function server(body: Buffer, ranges: (string | null)[] = []): typeof fetch {
  return (async (_url: string, init?: RequestInit) => {
    const range = (init?.headers as Record<string, string> | undefined)?.Range ?? null;
    ranges.push(range);
    const start = range ? Number(/bytes=(\d+)-/.exec(range)?.[1] ?? 0) : 0;
    const slice = body.subarray(start);
    return new Response(new Uint8Array(slice), {
      status: range ? 206 : 200,
      headers: range
        ? { 'content-range': `bytes ${start}-${body.length - 1}/${body.length}` }
        : { 'content-length': String(body.length) },
    });
  }) as typeof fetch;
}

const skip = process.platform === 'win32';

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'enso-speech-archive-'));
  archive = makeArchive({
    'pkg/encoder.onnx': 'ENC',
    'pkg/tokens.txt': 'TOK',
    'pkg/test_wavs/big.wav': 'WAV',
  });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe.skipIf(skip)('downloadArchiveModel', () => {
  it('verifies the archive, keeps only the listed files and marks the model ready', async () => {
    const dir = path.join(root, 'model');
    const progress: number[] = [];
    await downloadArchiveModel(spec(), dir, {
      fetch: server(archive),
      onProgress: (p) => progress.push(p.received),
    });
    expect(isModelReady(dir, spec())).toBe(true);
    expect(readFileSync(path.join(dir, 'encoder.onnx'), 'utf8')).toBe('ENC');
    expect(readdirSync(dir).sort()).toEqual(['.ready', 'encoder.onnx', 'tokens.txt']);
    expect(progress.at(-1)).toBe(archive.length);
  });

  it('resumes a partial archive with a range request', async () => {
    const dir = path.join(root, 'model');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, '.archive.part'), archive.subarray(0, 10));
    const ranges: (string | null)[] = [];
    await downloadArchiveModel(spec(), dir, { fetch: server(archive, ranges) });
    expect(ranges[0]).toBe('bytes=10-');
    expect(isModelReady(dir, spec())).toBe(true);
  });

  it('refuses a tampered archive and leaves nothing that looks ready', async () => {
    const dir = path.join(root, 'model');
    const bad = spec({
      archive: {
        url: 'https://example.test/pkg.tar.bz2',
        sha256: sha('other'),
        bytes: archive.length,
        root: 'pkg',
      },
    });
    await expect(
      downloadArchiveModel(bad, dir, { fetch: server(archive), retryDelayMs: 0 })
    ).rejects.toThrow(/sha256/);
    expect(isModelReady(dir, bad)).toBe(false);
    expect(existsSync(path.join(dir, '.archive.part'))).toBe(false);
  });

  it('rejects an archive whose members do not match the registry', async () => {
    const dir = path.join(root, 'model');
    const wrong = spec({ files: [{ name: 'encoder.onnx', sha256: sha('NOPE') }] });
    await expect(downloadArchiveModel(wrong, dir, { fetch: server(archive) })).rejects.toThrow(
      /encoder\.onnx/
    );
    expect(isModelReady(dir, wrong)).toBe(false);
  });

  it('stops when aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      downloadArchiveModel(spec(), path.join(root, 'model'), {
        fetch: server(archive),
        signal: controller.signal,
      })
    ).rejects.toThrow(/abort/);
  });

  it('unpacks gzip archives and keeps nested paths and the executable bit', async () => {
    const src = path.join(root, 'gz');
    mkdirSync(path.join(src, 'pkg', 'libs'), { recursive: true });
    writeFileSync(path.join(src, 'pkg', 'bin'), 'BIN');
    chmodSync(path.join(src, 'pkg', 'bin'), 0o755);
    writeFileSync(path.join(src, 'pkg', 'libs', 'a.so'), 'LIB');
    const out = path.join(root, 'pkg.tar.gz');
    execFileSync('tar', ['-czf', out, '-C', src, 'pkg']);
    const gz = readFileSync(out);
    const dir = path.join(root, 'engine');
    const gzSpec = spec({
      files: [
        { name: 'bin', sha256: sha('BIN') },
        { name: 'libs/a.so', sha256: sha('LIB') },
      ],
      archive: {
        url: 'https://example.test/pkg.tar.gz',
        sha256: sha(gz),
        bytes: gz.length,
        root: 'pkg',
      },
    });
    await downloadArchiveModel(gzSpec, dir, { fetch: server(gz) });
    expect(isModelReady(dir, gzSpec)).toBe(true);
    expect(readFileSync(path.join(dir, 'libs', 'a.so'), 'utf8')).toBe('LIB');
    expect(statSync(path.join(dir, 'bin')).mode & 0o111).not.toBe(0);
  });
});
