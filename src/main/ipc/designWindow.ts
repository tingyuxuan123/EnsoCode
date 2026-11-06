import { randomUUID } from 'node:crypto';
import type {
  DesignWindowActivityEvent,
  DesignWindowInfo,
  DesignWindowPromptRequest,
  DesignWindowPromptResult,
  DesignWindowResult,
  DesignWindowState,
} from '@shared/types/design';
import { IPC_CHANNELS } from '@shared/types/ipc';
import { ipcMain } from 'electron';
import { getWindowWebContents, sendToWindow } from '../windows/createAppWindow';
import {
  designWindowFor,
  designWindowSession,
  designWindowSessions,
  onDesignWindowsChanged,
  openDesignWindow,
} from '../windows/DesignWindow';
import { getMainWindow, isMainWebContents } from '../windows/MainWindow';

const MAX_SESSION_ID = 200;
const MAX_PROMPT_CHARS = 256 * 1024;
const MAX_EVENTS = 500;
const MAX_ERROR_CHARS = 1000;
const TOOL_NAMES = new Set(['read', 'edit', 'write']);

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const sessionId = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= MAX_SESSION_ID;
const onlyKeys = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).every((key) => keys.includes(key));
const shortString = (value: unknown, max = 4096): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max;

function parseEvent(raw: unknown): DesignWindowActivityEvent | null {
  if (!record(raw) || !shortString(raw.toolCallId, 512) || !TOOL_NAMES.has(raw.toolName as string))
    return null;
  const toolName = raw.toolName as DesignWindowActivityEvent['toolName'];
  if (raw.type === 'tool-call-args') {
    if (!onlyKeys(raw, ['type', 'toolCallId', 'toolName', 'args'])) return null;
    if (!record(raw.args) || !onlyKeys(raw.args, ['path']) || !shortString(raw.args.path))
      return null;
    return { type: raw.type, toolCallId: raw.toolCallId, toolName, args: { path: raw.args.path } };
  }
  if (raw.type === 'tool-call-end') {
    if (!onlyKeys(raw, ['type', 'toolCallId', 'toolName', 'isError'])) return null;
    if (typeof raw.isError !== 'boolean') return null;
    return { type: raw.type, toolCallId: raw.toolCallId, toolName, isError: raw.isError };
  }
  return null;
}

function parseState(raw: unknown): DesignWindowState | null {
  if (!record(raw) || !onlyKeys(raw, ['sessionId', 'streaming', 'events'])) return null;
  if (!sessionId(raw.sessionId) || typeof raw.streaming !== 'boolean') return null;
  if (!Array.isArray(raw.events) || raw.events.length > MAX_EVENTS) return null;
  const events: DesignWindowActivityEvent[] = [];
  for (const item of raw.events) {
    const event = parseEvent(item);
    if (!event) return null;
    events.push(event);
  }
  return { sessionId: raw.sessionId, streaming: raw.streaming, events };
}

const failed = (error: string): DesignWindowPromptResult => ({ status: 'failed', error });

interface Pending {
  origin: number;
  resolve(result: DesignWindowPromptResult): void;
}

/**
 * 独立设计窗口的 Main 侧协调：打开窗口、主窗口 → 设计窗口的运行状态转发、
 * 设计窗口 → 主窗口的派活转发。会话一律以 Main 绑定为准，不采信 Renderer 上报。
 */
export function createDesignWindowHandlers(deps: {
  isMain(senderId: number): boolean;
  mainId(): number | null;
  /** 独立设计窗口绑定的根会话；其它 sender 返回 null。 */
  boundSession(senderId: number): string | null;
  /** Main 权威：本机、非 Bot、未结束会话的根会话 id；不合格返回 null。 */
  target(sessionId: string): string | null | Promise<string | null>;
  open(sessionId: string): void;
  sessions(): string[];
  sendToSession(sessionId: string, channel: string, payload: unknown): void;
  sendToMain(channel: string, payload: unknown): boolean;
  timeoutMs?: number;
}) {
  const streaming = new Map<string, boolean>();
  const pending = new Map<string, Pending>();
  return {
    async open(senderId: number, raw: unknown): Promise<DesignWindowResult> {
      if (!deps.isMain(senderId)) return { ok: false, error: 'forbidden' };
      if (!sessionId(raw)) return { ok: false, error: 'invalid' };
      const root = await deps.target(raw);
      if (!root) return { ok: false, error: '该会话不支持独立设计窗口（仅限本机项目的普通会话）' };
      deps.open(root);
      return { ok: true };
    },
    list(senderId: number): string[] {
      return deps.isMain(senderId) ? deps.sessions() : [];
    },
    info(senderId: number): DesignWindowInfo {
      const bound = deps.boundSession(senderId);
      if (!bound) return { ok: false, error: 'forbidden' };
      return { ok: true, sessionId: bound, streaming: streaming.get(bound) ?? false };
    },
    state(senderId: number, raw: unknown): DesignWindowResult {
      if (!deps.isMain(senderId)) return { ok: false, error: 'forbidden' };
      const state = parseState(raw);
      if (!state || !deps.sessions().includes(state.sessionId))
        return { ok: false, error: 'invalid' };
      streaming.set(state.sessionId, state.streaming);
      deps.sendToSession(state.sessionId, IPC_CHANNELS.DESIGN_WINDOW_STATE, state);
      return { ok: true };
    },
    prompt(senderId: number, raw: unknown): Promise<DesignWindowPromptResult> {
      const bound = deps.boundSession(senderId);
      if (!bound) return Promise.resolve(failed('forbidden'));
      if (
        !record(raw) ||
        !onlyKeys(raw, ['text', 'skipIfStreaming']) ||
        !shortString(raw.text, MAX_PROMPT_CHARS) ||
        (raw.skipIfStreaming !== undefined && typeof raw.skipIfStreaming !== 'boolean')
      )
        return Promise.resolve(failed('invalid'));
      const origin = deps.mainId();
      if (origin === null) return Promise.resolve(failed('主窗口不可用，请先打开 EnsoCode 主窗口'));
      const requestId = randomUUID();
      const { promise, resolve } = Promise.withResolvers<DesignWindowPromptResult>();
      const timer = setTimeout(() => {
        // 主窗口可能仍在冷启动会话后发出；不能断言没发，只说明结果未知。
        if (pending.delete(requestId))
          resolve(
            failed(
              'Main window did not respond in time; the prompt may still be sent. Check the conversation before retrying.'
            )
          );
      }, deps.timeoutMs ?? 120_000);
      timer.unref?.();
      pending.set(requestId, {
        origin,
        resolve: (result) => {
          clearTimeout(timer);
          resolve(result);
        },
      });
      const request: DesignWindowPromptRequest = {
        requestId,
        sessionId: bound,
        text: raw.text,
        skipIfStreaming: raw.skipIfStreaming === true,
      };
      if (!deps.sendToMain(IPC_CHANNELS.DESIGN_WINDOW_PROMPT_REQUEST, request)) {
        pending.delete(requestId);
        clearTimeout(timer);
        return Promise.resolve(failed('主窗口不可用，请先打开 EnsoCode 主窗口'));
      }
      return promise;
    },
    promptResponse(senderId: number, raw: unknown): boolean {
      if (!record(raw) || typeof raw.requestId !== 'string') return false;
      const entry = pending.get(raw.requestId);
      if (!entry || entry.origin !== senderId) return false;
      if (raw.status !== 'sent' && raw.status !== 'queued' && raw.status !== 'failed') return false;
      pending.delete(raw.requestId);
      const error =
        typeof raw.error === 'string' && raw.error
          ? raw.error.slice(0, MAX_ERROR_CHARS)
          : undefined;
      entry.resolve({ status: raw.status, ...(error ? { error } : {}) });
      return true;
    },
    windowsChanged(sessions: string[]): void {
      for (const id of streaming.keys()) if (!sessions.includes(id)) streaming.delete(id);
    },
  };
}

export function registerDesignWindowHandlers(): void {
  const handlers = createDesignWindowHandlers({
    isMain: isMainWebContents,
    mainId: () => {
      const main = getMainWindow();
      if (!main || main.isDestroyed()) return null;
      const contents = getWindowWebContents(main);
      return contents.isDestroyed() ? null : contents.id;
    },
    boundSession: designWindowSession,
    target: async (id) => (await import('./agent')).designWindowSessionId(id),
    open: (id) => void openDesignWindow(id),
    sessions: designWindowSessions,
    sendToSession: (id, channel, payload) => {
      const win = designWindowFor(id);
      if (win) sendToWindow(win, channel, payload);
    },
    sendToMain: (channel, payload) => {
      const main = getMainWindow();
      if (!main || main.isDestroyed()) return false;
      sendToWindow(main, channel, payload);
      return true;
    },
  });
  onDesignWindowsChanged((sessions) => {
    handlers.windowsChanged(sessions);
    const main = getMainWindow();
    if (main && !main.isDestroyed())
      sendToWindow(main, IPC_CHANNELS.DESIGN_WINDOWS_CHANGED, sessions);
  });
  ipcMain.handle(IPC_CHANNELS.DESIGN_WINDOW_OPEN, (event, raw: unknown) =>
    handlers.open(event.sender.id, raw)
  );
  ipcMain.handle(IPC_CHANNELS.DESIGN_WINDOW_LIST, (event) => handlers.list(event.sender.id));
  // 设计窗口发起的请求同样只认顶层 frame（引擎 iframe 没有 preload，这里再兜一层）。
  const topFrame = (event: Electron.IpcMainInvokeEvent) =>
    event.senderFrame !== null && event.senderFrame === event.sender.mainFrame;
  ipcMain.handle(IPC_CHANNELS.DESIGN_WINDOW_INFO, (event) =>
    topFrame(event) ? handlers.info(event.sender.id) : { ok: false, error: 'forbidden' }
  );
  ipcMain.handle(IPC_CHANNELS.DESIGN_WINDOW_PUSH_STATE, (event, raw: unknown) =>
    handlers.state(event.sender.id, raw)
  );
  ipcMain.handle(IPC_CHANNELS.DESIGN_WINDOW_PROMPT, (event, raw: unknown) =>
    topFrame(event)
      ? handlers.prompt(event.sender.id, raw)
      : { status: 'failed', error: 'forbidden' }
  );
  ipcMain.handle(IPC_CHANNELS.DESIGN_WINDOW_PROMPT_RESPONSE, (event, raw: unknown) => ({
    ok: handlers.promptResponse(event.sender.id, raw),
  }));
}
