import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  truncateSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { open } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { HostToPhone, PairFileTarget } from '@enso/pair';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPairFilePort, type PairFileSource } from './pairFiles';

vi.mock('node:fs/promises', async (original) => {
  const fs = await original<typeof import('node:fs/promises')>();
  return { ...fs, open: vi.fn(fs.open) };
});

describe('device file chunks', () => {
  let tmp: string;
  let root: string;
  const target: PairFileTarget = { sessionId: 's' };
  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'enso-pair-files-'));
    root = path.join(tmp, 'workspace');
    mkdirSync(root);
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  function fixture(rels: string[], source?: () => Promise<PairFileSource | null>) {
    const lookup = source ?? (async () => ({ root, artifacts: rels.map((rel) => ({ rel })) }));
    const port = createPairFilePort(lookup);
    const frames: HostToPhone[] = [];
    const reply = vi.fn(async (frame: HostToPhone) => {
      frames.push(frame);
      return true;
    });
    const list = async (of = target) => {
      await port.handle({ type: 'file-list', requestId: 'l', target: of }, reply);
      const result = frames.at(-1);
      if (result?.type !== 'file-list-result') throw new Error('missing list response');
      return result;
    };
    const read = async (fileId: string, offset = 0, of = target) => {
      await port.handle({ type: 'file-read', requestId: 'r', target: of, fileId, offset }, reply);
      const result = frames.at(-1);
      if (result?.type !== 'file-read-result') throw new Error('missing read response');
      return result;
    };
    return { list, read };
  }

  it('returns exact binary bytes in bounded standard-base64 chunks, including >1MB and empty files', async () => {
    const bytes = Buffer.alloc(1024 * 1024 + 719, 0);
    for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251;
    writeFileSync(path.join(root, 'binary.zip'), bytes);
    writeFileSync(path.join(root, 'empty.txt'), '');
    const { list, read } = fixture(['binary.zip', 'empty.txt']);
    const files = (await list()).files;
    expect(files.map((file) => file.name)).toEqual(['binary.zip', 'empty.txt']);
    expect(files[0]).toEqual({
      id: expect.stringMatching(/^[a-f0-9]{64}$/),
      name: 'binary.zip',
      rel: 'binary.zip',
      size: bytes.length,
    });
    const chunks: Buffer[] = [];
    for (let offset = 0; offset < bytes.length; ) {
      const chunk = await read(files[0].id, offset);
      expect(chunk).toMatchObject({ name: 'binary.zip', size: bytes.length, offset });
      const data = Buffer.from(chunk.data ?? '', 'base64');
      expect(data.length).toBeLessThanOrEqual(384 * 1024);
      expect(data.length).toBeGreaterThan(0);
      chunks.push(data);
      offset += data.length;
    }
    expect(Buffer.concat(chunks)).toEqual(bytes);
    expect(await read(files[1].id)).toMatchObject({ size: 0, offset: 0, data: '' });
    expect((await read(files[1].id, 1)).error).toBe('invalid');
  });

  it('never serves unmentioned, forged, outside, directory or escaping-symlink candidates', async () => {
    writeFileSync(path.join(root, 'ok.txt'), 'allowed');
    writeFileSync(path.join(root, 'secret.txt'), 'secret');
    writeFileSync(path.join(tmp, 'outside.txt'), 'outside');
    symlinkSync(path.join(tmp, 'outside.txt'), path.join(root, 'link.txt'));
    const { list, read } = fixture(['ok.txt', '../outside.txt', 'link.txt', '.']);
    const files = (await list()).files;
    expect(files.map((file) => file.rel)).toEqual(['ok.txt']);
    vi.mocked(open).mockClear();
    expect((await read('f'.repeat(64))).error).toBe('not-found');
    expect((await read(files[0].id, 0, { sessionId: 'other' })).error).toBe('not-found');
    unlinkSync(path.join(root, 'ok.txt'));
    symlinkSync(path.join(tmp, 'outside.txt'), path.join(root, 'ok.txt'));
    expect((await read(files[0].id)).error).toBe('not-found');
    expect(open).not.toHaveBeenCalled();
  });

  it('rederives authorization and stat versions on every read; missing/changed files never return stale data', async () => {
    writeFileSync(path.join(root, 'a.txt'), 'first');
    let allowed = true;
    const { list, read } = fixture([], async () =>
      allowed ? { root, artifacts: [{ rel: 'a.txt' }] } : null
    );
    const id = (await list()).files[0].id;
    writeFileSync(path.join(root, 'a.txt'), 'replacement');
    expect((await read(id)).error).toBe('not-found');
    const nextId = (await list()).files[0].id;
    expect(nextId).not.toBe(id);
    utimesSync(path.join(root, 'a.txt'), new Date(1_000), new Date(2_000));
    expect((await read(nextId)).error).toBe('not-found');
    allowed = false;
    expect((await read(nextId)).error).toBe('unavailable');
    expect(await list()).toMatchObject({ files: [], error: 'unavailable' });
    allowed = true;
    unlinkSync(path.join(root, 'a.txt'));
    expect((await read(nextId)).error).toBe('not-found');
  });

  it('revalidates authority and file version after disk I/O before returning any bytes', async () => {
    writeFileSync(path.join(root, 'a.txt'), 'original');
    let lookups = 0;
    const { list, read } = fixture([], async () => {
      if (++lookups === 3) writeFileSync(path.join(root, 'a.txt'), 'modified');
      return { root, artifacts: [{ rel: 'a.txt' }] };
    });
    const id = (await list()).files[0].id;
    const result = await read(id);
    expect(result.error).toBe('changed');
    expect(result.data).toBeUndefined();
  });

  it('caps size before reading and rejects dirty offsets without throwing', async () => {
    writeFileSync(path.join(root, 'huge.bin'), '');
    truncateSync(path.join(root, 'huge.bin'), 50 * 1024 * 1024 + 1);
    const { list, read } = fixture(['huge.bin']);
    const id = (await list()).files[0].id;
    vi.mocked(open).mockClear();
    expect((await read(id)).error).toBe('too-large');
    for (const offset of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER, 50 * 1024 * 1024 + 1])
      expect((await read(id, offset)).error).toBe('invalid');
    expect(open).not.toHaveBeenCalled();
    const offline = fixture([], async () => {
      throw new Error('offline');
    });
    expect((await offline.list()).error).toBe('unavailable');
    expect((await offline.read(id)).error).toBe('unavailable');
  });

  it('bounds listings and supports bot target identity without a Code session', async () => {
    const rels = Array.from({ length: 150 }, (_, i) => `${i}.txt`);
    for (const rel of rels) writeFileSync(path.join(root, rel), rel);
    const { list, read } = fixture(rels);
    const bot: PairFileTarget = {
      bot: { chatId: '11111111-1111-4111-8111-111111111111', entryId: 'entry' },
    };
    const files = (await list(bot)).files;
    expect(files.length).toBe(128);
    expect((await read(files[0].id, 0, bot)).data).toBe(Buffer.from('0.txt').toString('base64'));
    expect((await read(files[0].id, 0)).error).toBe('not-found');
  });
});
