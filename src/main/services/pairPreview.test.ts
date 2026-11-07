import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { HostToPhone } from '@enso/pair';
import type { ProjectedMessage } from '@shared/types/agent';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createPairPreviewPort,
  type PairPreviewBrowser,
  type PairPreviewCommand,
  type PairPreviewPort,
  type PairPreviewSource,
} from './pairPreview';

describe('paired remote preview authority and lifecycle', () => {
  let temp: string;
  let root: string;
  let now: number;
  let source: PairPreviewSource;
  let port: PairPreviewPort;
  let browser: PairPreviewBrowser;
  const frames: HostToPhone[] = [];
  const factory = vi.fn();
  const target = { sessionId: 's' };
  const lookup = vi.fn();
  let accessKey: string | null;
  const reply = async (frame: HostToPhone) => {
    frames.push(frame);
    return true;
  };
  const text = (role: 'user' | 'assistant' | 'toolResult', value: string): ProjectedMessage =>
    role === 'toolResult'
      ? {
          role,
          toolCallId: 't',
          toolName: 'bash',
          isError: false,
          content: [{ type: 'text', text: value }],
        }
      : { role, content: [{ type: 'text', text: value }] };
  beforeEach(() => {
    vi.useFakeTimers();
    temp = mkdtempSync(path.join(os.tmpdir(), 'enso-pair-preview-'));
    root = path.join(temp, 'workspace');
    mkdirSync(root);
    writeFileSync(path.join(root, 'index.html'), '<h1>hello</h1>');
    now = 1000;
    source = { root, stamp: 'authority-1', messages: [] };
    accessKey = source.stamp;
    lookup.mockReset().mockImplementation(async (of) => (of.sessionId === 's' ? source : null));
    browser = {
      capture: vi.fn(async () => ({
        width: 390,
        height: 844,
        dataUrl: 'data:image/jpeg;base64,/9j/2Q==',
      })),
      input: vi.fn(async () => {}),
      refresh: vi.fn(async () => {}),
      close: vi.fn(),
    };
    factory.mockReset().mockImplementation(async () => browser);
    port = createPairPreviewPort({
      lookup,
      accessKey: () => accessKey,
      browser: factory,
      now: () => now,
    });
    frames.length = 0;
  });
  afterEach(() => {
    for (const pair of ['one', 'two', 'three']) port.release(pair);
    rmSync(temp, { recursive: true, force: true });
    vi.useRealTimers();
  });
  async function command(command: PairPreviewCommand, pair = 'one') {
    await port.handle(pair, command, reply);
    return frames.at(-1)!;
  }
  async function list() {
    const result = await command({ type: 'preview-list', requestId: 'l', target });
    if (result.type !== 'preview-list-result') throw new Error('missing list');
    return result;
  }
  async function open(pair = 'one') {
    const entries = (await list()).entries;
    const result = await command(
      {
        type: 'preview-open',
        requestId: 'o',
        target,
        entryId: entries[0]?.id ?? 'a'.repeat(64),
        width: 390,
        height: 844,
      },
      pair
    );
    if (result.type !== 'preview-result') throw new Error('missing preview');
    return result;
  }
  it('offers existing defaults, assistant/tool HTML and explicit safe loopback invitations only; IDs hide paths', async () => {
    mkdirSync(path.join(root, 'dist'));
    writeFileSync(path.join(root, 'dist/index.html'), 'dist');
    writeFileSync(path.join(root, 'page.html'), 'page');
    writeFileSync(path.join(root, 'secret.html'), 'secret');
    const outside = path.join(temp, 'outside');
    mkdirSync(outside);
    writeFileSync(path.join(outside, 'outside.html'), 'outside');
    symlinkSync(outside, path.join(root, 'escape'), 'junction');
    source.messages = [
      text('user', 'secret.html http://127.0.0.1:8000/'),
      text(
        'assistant',
        'page.html escape/outside.html http://localhost:5173/app http://0.0.0.0:3000/ http://[::1]:6000/'
      ),
      text('toolResult', 'http://127.0.0.1:9000/ready'),
      text(
        'assistant',
        'http://127.1:4000/ http://localhost:80/ http://user@localhost:8080/ http://localhost:8080/?token=x http://localhost:8080/#x http://localhost:8080/../secret http://remote.test:8080/'
      ),
    ];
    const result = await list();
    expect(result.entries.map((entry) => entry.label)).toEqual(
      expect.arrayContaining([
        'index.html',
        path.join('dist', 'index.html'),
        'page.html',
        'http://127.0.0.1:5173/app',
        'http://127.0.0.1:3000/',
        'http://127.0.0.1:6000/',
        'http://127.0.0.1:9000/ready',
      ])
    );
    expect(result.entries).toHaveLength(7);
    expect(
      result.entries.every(
        (entry) => /^[a-f0-9]{64}$/.test(entry.id) && !('root' in entry) && !('url' in entry)
      )
    ).toBe(true);
    expect(
      await command({ type: 'preview-list', requestId: 'x', target: { sessionId: 'other' } })
    ).toMatchObject({ error: 'unavailable' });
  });
  it('returns only the newest sixteen candidates and rotates IDs with authority', async () => {
    source.messages = Array.from({ length: 20 }, (_, i) =>
      text('assistant', `http://localhost:${5000 + i}/`)
    );
    const before = await list();
    expect(before.entries).toHaveLength(16);
    expect(before.entries[0]?.label).toBe('http://127.0.0.1:5019/');
    const old = before.entries[0].id;
    source.stamp = accessKey = 'changed';
    expect((await list()).entries[0].id).not.toBe(old);
    expect(
      await command({
        type: 'preview-open',
        requestId: 'old',
        target,
        entryId: old,
        width: 390,
        height: 844,
      })
    ).toMatchObject({ error: 'not-found' });
  });
  it('binds previews to pairs and rejects stale frames and out-of-viewport clicks without input', async () => {
    const opened = await open();
    expect(opened.frame?.frameId).toBeTruthy();
    const previewId = opened.previewId!;
    expect(
      await command({ type: 'preview-frame', requestId: 'cross', previewId }, 'two')
    ).toMatchObject({ error: 'not-found' });
    expect(
      await command({
        type: 'preview-input',
        requestId: 'stale',
        previewId,
        frameId: 'old',
        input: { kind: 'text', text: 'bad' },
      })
    ).toMatchObject({ error: 'stale-frame' });
    expect(
      await command({
        type: 'preview-input',
        requestId: 'outside',
        previewId,
        frameId: opened.frame!.frameId,
        input: { kind: 'click', x: 500, y: 1 },
      })
    ).toMatchObject({ error: 'invalid' });
    expect(browser.input).not.toHaveBeenCalled();
    const next = await command({
      type: 'preview-input',
      requestId: 'input',
      previewId,
      frameId: opened.frame!.frameId,
      input: { kind: 'text', text: 'hi' },
    });
    expect(next).toHaveProperty('frame');
    if (next.type === 'preview-result') expect(next.frame?.frameId).not.toBe(opened.frame!.frameId);
  });
  it('limits capture cadence, global slots and replaces the previous preview per pair', async () => {
    const first = await open();
    expect(
      await command({ type: 'preview-frame', requestId: 'fast', previewId: first.previewId! })
    ).toMatchObject({ error: 'rate-limited' });
    now += 350;
    expect(
      await command({ type: 'preview-refresh', requestId: 'next', previewId: first.previewId! })
    ).toHaveProperty('frame');
    expect(browser.refresh).toHaveBeenCalledOnce();
    await open('two');
    expect(await open('three')).toMatchObject({ error: 'busy' });
    await open();
    expect(browser.close).toHaveBeenCalled();
  });
  it('rejects concurrent work, and release during browser creation cannot resurrect or reply', async () => {
    const entryId = (await list()).entries[0].id;
    let finish!: (value: PairPreviewBrowser) => void;
    factory.mockImplementationOnce(
      () =>
        new Promise<PairPreviewBrowser>((resolve) => {
          finish = resolve;
        })
    );
    const opening = port.handle(
      'one',
      { type: 'preview-open', requestId: 'pending', target, entryId, width: 390, height: 844 },
      reply
    );
    await vi.waitFor(() => expect(factory).toHaveBeenCalledOnce());
    expect(await command({ type: 'preview-list', requestId: 'flood', target })).toMatchObject({
      error: 'busy',
    });
    port.release('one');
    finish(browser);
    await opening;
    expect(browser.close).toHaveBeenCalledOnce();
    expect(frames.some((frame) => 'requestId' in frame && frame.requestId === 'pending')).toBe(
      false
    );
  });
  it('revokes on lookup/access/allow changes, failed sends, oversized or empty frames and idle timeout', async () => {
    const opened = await open();
    accessKey = 'changed';
    expect(
      await command({ type: 'preview-frame', requestId: 'revoked', previewId: opened.previewId! })
    ).toMatchObject({ error: 'unavailable' });
    expect(browser.close).toHaveBeenCalledOnce();
    accessKey = source.stamp;
    await port.handle(
      'one',
      { type: 'preview-list', requestId: 'denied', target },
      reply,
      () => false
    );
    expect(frames.at(-1)).toMatchObject({ error: 'unavailable' });
    await port.handle(
      'one',
      {
        type: 'preview-open',
        requestId: 'failed',
        target,
        entryId: (await list()).entries[0].id,
        width: 390,
        height: 844,
      },
      async () => false
    );
    expect(browser.close).toHaveBeenCalledTimes(2);
    vi.mocked(browser.capture).mockResolvedValueOnce({
      width: 390,
      height: 844,
      dataUrl: `data:image/jpeg;base64,${'a'.repeat(700000)}`,
    });
    expect(await open()).toMatchObject({ error: 'too-large' });
    vi.mocked(browser.capture).mockResolvedValueOnce({ width: 390, height: 844, dataUrl: '' });
    expect(await open()).toMatchObject({ error: 'unavailable' });
    await open();
    const closed = vi.mocked(browser.close).mock.calls.length;
    now += 600_001;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(browser.close).toHaveBeenCalledTimes(closed + 1);
  });
  it('rechecks the authority stamp after creation and after capture', async () => {
    factory.mockImplementationOnce(async () => {
      source.stamp = 'new';
      return browser;
    });
    expect(await open()).toMatchObject({ error: 'unavailable' });
    expect(browser.close).toHaveBeenCalledOnce();
    accessKey = source.stamp;
    vi.mocked(browser.capture).mockImplementationOnce(async () => {
      source.stamp = 'newer';
      return { width: 390, height: 844, dataUrl: 'data:image/jpeg;base64,/9j/2Q==' };
    });
    expect(await open()).toMatchObject({ error: 'unavailable' });
  });
  it('close immediately revokes a busy capture and suppresses its late frame without closing another pair', async () => {
    const opened = await open();
    now += 350;
    let finish!: (value: { width: number; height: number; dataUrl: string }) => void;
    vi.mocked(browser.capture).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const pending = port.handle(
      'one',
      { type: 'preview-frame', requestId: 'slow', previewId: opened.previewId! },
      reply
    );
    await vi.waitFor(() => expect(browser.capture).toHaveBeenCalledTimes(2));
    expect(
      await command(
        { type: 'preview-close', requestId: 'wrong-owner', previewId: opened.previewId! },
        'two'
      )
    ).toMatchObject({ error: 'not-found' });
    expect(
      await command({ type: 'preview-close', requestId: 'close', previewId: opened.previewId! })
    ).toMatchObject({ type: 'preview-result', requestId: 'close', previewId: opened.previewId });
    expect(browser.close).toHaveBeenCalledOnce();
    finish({ width: 390, height: 844, dataUrl: 'data:image/jpeg;base64,/9j/2Q==' });
    await pending;
    expect(frames.some((frame) => 'requestId' in frame && frame.requestId === 'slow')).toBe(false);
  });
  it('rechecks authority while the reply is asynchronously encrypted and caps titles at phone bounds', async () => {
    const entryId = (await list()).entries[0].id;
    let replyGuard: (() => boolean) | undefined;
    await port.handle(
      'one',
      { type: 'preview-open', requestId: 'guard', target, entryId, width: 390, height: 844 },
      async (_frame, valid) => {
        replyGuard = valid;
        expect(valid?.()).toBe(true);
        accessKey = 'revoked';
        expect(valid?.()).toBe(false);
        return false;
      }
    );
    expect(replyGuard).toBeTypeOf('function');
    expect(browser.close).toHaveBeenCalledOnce();
    accessKey = source.stamp;
    vi.mocked(browser.capture).mockResolvedValueOnce({
      width: 390,
      height: 844,
      dataUrl: 'data:image/jpeg;base64,/9j/2Q==',
      title: 'x'.repeat(301),
    });
    expect(await open()).toMatchObject({ error: 'unavailable' });
  });
  it('released pending constructors still count toward the global resource bound and cannot unlock newer work', async () => {
    const entryId = (await list()).entries[0].id;
    const openCommand: PairPreviewCommand = {
      type: 'preview-open',
      requestId: 'pending',
      target,
      entryId,
      width: 390,
      height: 844,
    };
    const finishes: Array<(value: PairPreviewBrowser) => void> = [];
    factory.mockImplementation(
      () => new Promise<PairPreviewBrowser>((resolve) => finishes.push(resolve))
    );
    const first = port.handle('one', openCommand, reply);
    const second = port.handle('two', openCommand, reply);
    await vi.waitFor(() => expect(factory).toHaveBeenCalledTimes(2));
    port.release('one');
    expect(await command({ ...openCommand, requestId: 'third' }, 'three')).toMatchObject({
      error: 'busy',
    });
    expect(factory).toHaveBeenCalledTimes(2);
    expect(await command({ ...openCommand, requestId: 'same-pair' })).toMatchObject({
      error: 'busy',
    });
    finishes[0](browser);
    await first;
    finishes[1](browser);
    await second;
    factory.mockResolvedValue(browser);
    expect(await command({ ...openCommand, requestId: 'new' }, 'three')).toHaveProperty('frame');
  });
  it('preserves bounded adapter too-large/stale-frame statuses and permits recapture after navigation', async () => {
    vi.mocked(browser.capture).mockRejectedValueOnce(new Error('too-large'));
    expect(await open()).toMatchObject({ error: 'too-large' });
    const opened = await open();
    const closed = vi.mocked(browser.close).mock.calls.length;
    vi.mocked(browser.input).mockRejectedValueOnce(new Error('stale-frame'));
    expect(
      await command({
        type: 'preview-input',
        requestId: 'navigation',
        previewId: opened.previewId!,
        frameId: opened.frame!.frameId,
        input: { kind: 'text', text: 'not sent' },
      })
    ).toMatchObject({ error: 'stale-frame' });
    expect(browser.close).toHaveBeenCalledTimes(closed);
    now += 350;
    expect(
      await command({ type: 'preview-frame', requestId: 'recapture', previewId: opened.previewId! })
    ).toHaveProperty('frame');
  });
});
