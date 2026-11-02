import { createHash, randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import type {
  HostToPhone,
  PairFileTarget,
  PairPreviewEntry,
  PairPreviewFrame,
  PairPreviewInput,
  PhoneToHost,
} from '@enso/pair';
import type { ProjectedMessage } from '@shared/types/agent';
import {
  artifactCandidates,
  resolveArtifactFile,
  resolveArtifacts,
  textPathCandidates,
} from './bots/artifacts';
import type { PairReply } from './pairHost';
import { parsePairPreviewCommand } from './pairPolicy';

export interface PairPreviewSource {
  root: string;
  stamp: string;
  messages: readonly ProjectedMessage[];
}
export interface PairPreviewCandidate extends PairPreviewEntry {
  root: string;
  url: string;
}
export interface PairPreviewBrowser {
  capture(): Promise<Omit<PairPreviewFrame, 'frameId'>>;
  input(input: PairPreviewInput): Promise<void>;
  refresh(): Promise<void>;
  close(): void;
}
export type PairPreviewBrowserFactory = (
  candidate: PairPreviewCandidate,
  viewport: { width: number; height: number }
) => Promise<PairPreviewBrowser>;
export type PairPreviewCommand = Extract<PhoneToHost, { type: `preview-${string}` }>;
export interface PairPreviewPort {
  handle(
    pairId: string,
    command: PairPreviewCommand,
    reply: PairReply,
    allowed?: (target: PairFileTarget) => boolean
  ): Promise<void>;
  release(pairId: string): void;
}
/** Literal hosts only: URL's permissive numeric-host normalization is deliberately not authority. */
function loopbackInvitation(raw: string): string | null {
  const unsafeAscii = (value: string) =>
    [...value].some((char) => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127);
  if (raw.length > 2048 || /[\\\s]/u.test(raw) || unsafeAscii(raw)) return null;
  const match = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0):(\d{4,5})(\/[^?#]*)?$/u.exec(
    raw
  );
  if (!match || Number(match[2]) < 1024 || Number(match[2]) > 65535) return null;
  try {
    const pathname = decodeURIComponent(match[3] ?? '/');
    if (
      /[\\?#%]/u.test(pathname) ||
      unsafeAscii(pathname) ||
      pathname.split('/').some((part) => part === '.' || part === '..')
    )
      return null;
    const url = new URL(raw);
    url.hostname = '127.0.0.1';
    return url.href;
  } catch {
    return null;
  }
}

function candidatesOf(source: PairPreviewSource): PairPreviewCandidate[] {
  const root = realpathSync(source.root);
  const found: PairPreviewCandidate[] = [];
  const seen = new Set<string>();
  const add = (kind: PairPreviewCandidate['kind'], url: string, label: string) => {
    if (seen.has(url) || found.length >= 16) return;
    seen.add(url);
    found.push({
      id: createHash('sha256')
        .update(JSON.stringify([source.stamp, root, url]))
        .digest('hex'),
      kind,
      root,
      url,
      label: label.slice(0, 500),
    });
  };
  const html = (paths: string[]) => {
    for (const artifact of resolveArtifacts(root, paths, 64)) {
      if (artifact.kind !== 'html') continue;
      const file = resolveArtifactFile(root, artifact.rel);
      if (file) add('html', file, artifact.rel);
    }
  };
  // Newest authoritative invitations first; user text never grants preview access.
  for (const message of [...source.messages].reverse()) {
    if (found.length >= 16) break;
    if (message.role !== 'assistant' && message.role !== 'toolResult') continue;
    const texts = message.content.flatMap((part) => (part.type === 'text' ? [part.text] : []));
    for (const text of texts) {
      for (const match of text.matchAll(
        /http:\/\/\[::1\][^\s`'"<>(){}]*|http:\/\/[^\s`'"<>()[\]{}]+/gu
      )) {
        const url = loopbackInvitation(match[0].replace(/[.,;!，。；！]+$/u, ''));
        if (url) add('server', url, url);
      }
    }
    html([...artifactCandidates([message]), ...texts.flatMap(textPathCandidates)]);
  }
  html(['index.html', 'dist/index.html']);
  return found;
}

interface Preview {
  id: string;
  target: PairFileTarget;
  stamp: string;
  key: string;
  browser: PairPreviewBrowser;
  viewport: { width: number; height: number };
  frameId?: string;
  capturedAt: number;
}
interface PairState {
  alive: boolean;
  busy: boolean;
  reserved: boolean;
  touchedAt: number;
  preview?: Preview;
  allowed: (target: PairFileTarget) => boolean;
}

export function createPairPreviewPort(options: {
  lookup: (target: PairFileTarget) => Promise<PairPreviewSource | null>;
  accessKey: (target: PairFileTarget) => string | null;
  browser: PairPreviewBrowserFactory;
  now?: () => number;
}): PairPreviewPort {
  const now = options.now ?? Date.now;
  const states = new Map<string, PairState>();
  const operations = new Map<string, PairState>();
  const opening = new Set<PairState>();
  const slots = new Set<PairState>();
  let timer: ReturnType<typeof setInterval> | undefined;
  const close = (state: PairState) => {
    const browser = state.preview?.browser;
    state.preview = undefined;
    state.reserved = false;
    if (!opening.has(state)) slots.delete(state);
    try {
      browser?.close();
    } catch {
      /* Closing must never prevent revocation. */
    }
  };
  const release = (pairId: string) => {
    const state = states.get(pairId);
    if (state) {
      state.alive = false;
      close(state);
      states.delete(pairId);
    }
    if (!states.size && timer) {
      clearInterval(timer);
      timer = undefined;
    }
  };
  const accessible = (state: PairState, target: PairFileTarget, key: string): boolean => {
    try {
      return state.alive && state.allowed(target) && options.accessKey(target) === key;
    } catch {
      return false;
    }
  };
  const startTimer = () => {
    timer ??= setInterval(() => {
      for (const [pairId, state] of states) {
        const preview = state.preview;
        if (
          now() - state.touchedAt >= 600_000 ||
          (preview && !accessible(state, preview.target, preview.key))
        )
          release(pairId);
      }
    }, 30_000);
    timer.unref();
  };
  return {
    release,
    async handle(pairId, raw, reply, allowed = () => true) {
      const command = parsePairPreviewCommand(raw);
      const existing = states.get(pairId);
      // Close is cancellation, not queued browser work. Revoke synchronously before any await.
      if (command?.type === 'preview-close' && existing?.preview?.id === command.previewId) {
        const preview = existing.preview;
        const authorized = () => {
          try {
            return allowed(preview.target) && options.accessKey(preview.target) === preview.key;
          } catch {
            return false;
          }
        };
        const before = authorized();
        release(pairId);
        try {
          const source = before ? await options.lookup(preview.target) : null;
          await reply(
            source?.stamp === preview.stamp && authorized()
              ? {
                  type: 'preview-result',
                  requestId: command.requestId,
                  previewId: command.previewId,
                }
              : { type: 'preview-result', requestId: command.requestId, error: 'unavailable' },
            authorized
          );
        } catch {
          /* Already revoked; no late browser can be resurrected. */
        }
        return;
      }
      let state = states.get(pairId);
      if (!state) {
        state = { alive: true, busy: false, reserved: false, touchedAt: now(), allowed };
        states.set(pairId, state);
        startTimer();
      }
      const current = state;
      const errorFrame = (error: string): HostToPhone =>
        raw.type === 'preview-list'
          ? { type: 'preview-list-result', requestId: raw.requestId, entries: [], error }
          : { type: 'preview-result', requestId: raw.requestId, error };
      const emit = async (message: HostToPhone, valid: () => boolean = () => current.alive) => {
        if (!current.alive) return;
        const discard = () => {
          if (states.get(pairId) === current) release(pairId);
        };
        try {
          if (!valid() || !(await reply(message, valid))) discard();
        } catch {
          discard();
        }
      };
      if (current.busy || operations.has(pairId)) {
        await emit(errorFrame('busy'));
        return;
      }
      current.busy = true;
      operations.set(pairId, current);
      current.allowed = allowed;
      current.touchedAt = now();
      try {
        if (!command) {
          await emit(errorFrame('invalid'));
          return;
        }
        let target: PairFileTarget;
        let key: string | null;
        let stamp: string;
        const verify = async () => {
          if (!key || !accessible(current, target, key)) return false;
          const latest = await options.lookup(target);
          return latest?.stamp === stamp && accessible(current, target, key);
        };
        if ('target' in command) {
          target = command.target;
          key = options.accessKey(target);
          if (!key || !accessible(current, target, key)) {
            close(current);
            await emit(errorFrame('unavailable'));
            return;
          }
          const source = await options.lookup(target);
          if (!source || !accessible(current, target, key)) {
            close(current);
            await emit(errorFrame('unavailable'));
            return;
          }
          stamp = source.stamp;
          const candidates = candidatesOf(source);
          if (command.type === 'preview-list') {
            if (!(await verify())) {
              close(current);
              await emit(errorFrame('unavailable'));
              return;
            }
            await emit(
              {
                type: 'preview-list-result',
                requestId: command.requestId,
                entries: candidates.map(({ id, label, kind }) => ({ id, label, kind })),
              },
              () => !!key && accessible(current, target, key)
            );
            return;
          }
          // An explicit open revokes the previous preview even when the entry has expired.
          close(current);
          const candidate = candidates.find((entry) => entry.id === command.entryId);
          if (!candidate) {
            await emit(errorFrame('not-found'));
            return;
          }
          if (slots.size >= 2) {
            await emit(errorFrame('busy'));
            return;
          }
          current.reserved = true;
          opening.add(current);
          slots.add(current);
          const viewport = { width: command.width, height: command.height };
          const browser = await options.browser(candidate, viewport);
          current.preview = {
            id: randomUUID(),
            target,
            key,
            stamp,
            browser,
            viewport,
            capturedAt: -Infinity,
          };
          const valid = await verify();
          opening.delete(current);
          if (!valid) {
            close(current);
            await emit(errorFrame('unavailable'));
            return;
          }
        } else {
          const preview = current.preview;
          if (!preview || preview.id !== command.previewId) {
            await emit(errorFrame('not-found'));
            return;
          }
          ({ target, key, stamp } = preview);
          if (!(await verify())) {
            close(current);
            await emit(errorFrame('unavailable'));
            return;
          }
          if (command.type === 'preview-close') {
            close(current);
            await emit({
              type: 'preview-result',
              requestId: command.requestId,
              previewId: command.previewId,
            });
            return;
          }
          if (command.type === 'preview-input') {
            if (command.frameId !== preview.frameId) {
              await emit(errorFrame('stale-frame'));
              return;
            }
            const input = command.input;
            if (
              input.kind === 'click' &&
              (input.x >= preview.viewport.width || input.y >= preview.viewport.height)
            ) {
              await emit(errorFrame('invalid'));
              return;
            }
            await preview.browser.input(input);
          } else {
            if (now() - preview.capturedAt < 350) {
              await emit(errorFrame('rate-limited'));
              return;
            }
            if (command.type === 'preview-refresh') await preview.browser.refresh();
          }
        }
        const preview = current.preview;
        if (!preview || !(await verify())) {
          close(current);
          await emit(errorFrame('unavailable'));
          return;
        }
        const image = await preview.browser.capture();
        if (!(await verify())) {
          close(current);
          await emit(errorFrame('unavailable'));
          return;
        }
        if (image.dataUrl.length > 700_000) {
          close(current);
          await emit(errorFrame('too-large'));
          return;
        }
        if (
          !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/u.test(image.dataUrl) ||
          image.width !== preview.viewport.width ||
          image.height !== preview.viewport.height ||
          (image.title !== undefined &&
            (typeof image.title !== 'string' || image.title.length > 300))
        ) {
          close(current);
          await emit(errorFrame('unavailable'));
          return;
        }
        preview.frameId = randomUUID();
        preview.capturedAt = now();
        current.touchedAt = now();
        await emit(
          {
            type: 'preview-result',
            requestId: command.requestId,
            previewId: preview.id,
            frame: {
              frameId: preview.frameId,
              width: image.width,
              height: image.height,
              dataUrl: image.dataUrl,
              ...(image.title === undefined ? {} : { title: image.title }),
            },
          },
          () => !!key && current.preview === preview && accessible(current, target, key)
        );
      } catch (error) {
        opening.delete(current);
        const code = error instanceof Error ? error.message : '';
        const preview = current.preview;
        if (code === 'stale-frame' && preview && accessible(current, preview.target, preview.key)) {
          preview.frameId = undefined;
          await emit(errorFrame('stale-frame'), () =>
            accessible(current, preview.target, preview.key)
          );
        } else {
          close(current);
          await emit(errorFrame(code === 'too-large' ? 'too-large' : 'unavailable'));
        }
      } finally {
        opening.delete(current);
        if (!current.preview) slots.delete(current);
        if (operations.get(pairId) === current) operations.delete(pairId);
        current.busy = false;
        if (!current.preview && !current.reserved && states.get(pairId) === current) {
          states.delete(pairId);
          if (!states.size && timer) {
            clearInterval(timer);
            timer = undefined;
          }
        }
      }
    },
  };
}
