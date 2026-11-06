import { IPC_CHANNELS } from '@shared/types/ipc';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }));
vi.mock('../windows/createAppWindow', () => ({
  getWindowWebContents: vi.fn(),
  sendToWindow: vi.fn(),
}));
vi.mock('../windows/MainWindow', () => ({ getMainWindow: vi.fn(), isMainWebContents: vi.fn() }));
vi.mock('../windows/DesignWindow', () => ({}));

import { createDesignWindowHandlers } from './designWindow';

const MAIN = 1;
const DESIGN = 9;

function setup() {
  const toSession: Array<{ sessionId: string; channel: string; payload: unknown }> = [];
  const toMain: Array<{ channel: string; payload: Record<string, unknown> }> = [];
  let mainAlive = true;
  const deps = {
    isMain: (id: number) => id === MAIN,
    mainId: () => (mainAlive ? MAIN : null),
    boundSession: (id: number) => (id === DESIGN ? 'root' : null),
    target: vi.fn((id: string) => (id === 'root' || id === 'child' ? 'root' : null)),
    open: vi.fn(),
    sessions: () => ['root'],
    sendToSession: (sessionId: string, channel: string, payload: unknown) =>
      toSession.push({ sessionId, channel, payload }),
    sendToMain: (channel: string, payload: unknown) => {
      if (!mainAlive) return false;
      toMain.push({ channel, payload: payload as Record<string, unknown> });
      return true;
    },
    timeoutMs: 50,
  };
  const handlers = createDesignWindowHandlers(deps);
  return { handlers, deps, toSession, toMain, killMain: () => (mainAlive = false) };
}

const tool = {
  type: 'tool-call-args',
  toolCallId: 't1',
  toolName: 'edit',
  args: { path: '/p/a.vetd/frames/home.tsx' },
} as const;

afterEach(() => vi.useRealTimers());

describe('design window IPC', () => {
  it('only the main window opens windows, for sessions Main resolves to a local root', async () => {
    const { handlers, deps } = setup();
    expect(await handlers.open(DESIGN, 'root')).toMatchObject({ ok: false });
    expect(await handlers.open(MAIN, 'child')).toEqual({ ok: true });
    expect(deps.open).toHaveBeenCalledWith('root');
    for (const raw of ['ssh', '', 42, null, { sessionId: 'root' }, 'x'.repeat(300)])
      expect(await handlers.open(MAIN, raw)).toMatchObject({ ok: false });
    expect(deps.open).toHaveBeenCalledTimes(1);
  });

  it('lists popped sessions only to the main window', () => {
    const { handlers } = setup();
    expect(handlers.list(MAIN)).toEqual(['root']);
    expect(handlers.list(DESIGN)).toEqual([]);
  });

  it('forwards validated state from the main window and replays streaming via info', () => {
    const { handlers, toSession } = setup();
    expect(handlers.info(DESIGN)).toEqual({ ok: true, sessionId: 'root', streaming: false });
    expect(handlers.state(MAIN, { sessionId: 'root', streaming: true, events: [tool] })).toEqual({
      ok: true,
    });
    expect(toSession).toEqual([
      {
        sessionId: 'root',
        channel: IPC_CHANNELS.DESIGN_WINDOW_STATE,
        payload: { sessionId: 'root', streaming: true, events: [tool] },
      },
    ]);
    expect(handlers.info(DESIGN)).toEqual({ ok: true, sessionId: 'root', streaming: true });
    expect(handlers.info(MAIN)).toMatchObject({ ok: false });
  });

  it('rejects state from other senders, for unpopped sessions, or with bad events', () => {
    const { handlers, toSession } = setup();
    const bad = [
      [DESIGN, { sessionId: 'root', streaming: true, events: [] }],
      [MAIN, { sessionId: 'other', streaming: true, events: [] }],
      [MAIN, { sessionId: 'root', streaming: 'yes', events: [] }],
      [MAIN, { sessionId: 'root', streaming: true, events: [{ ...tool, toolName: 'bash' }] }],
      [MAIN, { sessionId: 'root', streaming: true, events: [{ ...tool, args: { path: 1 } }] }],
      [MAIN, { sessionId: 'root', streaming: true, events: Array(501).fill(tool) }],
      [MAIN, { sessionId: 'root', streaming: true, events: [], extra: 1 }],
    ] as const;
    for (const [sender, raw] of bad)
      expect(handlers.state(sender, raw)).toMatchObject({ ok: false });
    expect(toSession).toEqual([]);
  });

  it('drops the streaming cache when a window closes', () => {
    const { handlers } = setup();
    handlers.state(MAIN, { sessionId: 'root', streaming: true, events: [] });
    handlers.windowsChanged([]);
    handlers.windowsChanged(['root']);
    expect(handlers.info(DESIGN)).toMatchObject({ streaming: false });
  });

  it('relays prompts to the main window with the bound session, answered only by main', async () => {
    const { handlers, toMain } = setup();
    const pending = handlers.prompt(DESIGN, { text: 'fix notes', skipIfStreaming: true });
    const request = toMain[0];
    expect(request.channel).toBe(IPC_CHANNELS.DESIGN_WINDOW_PROMPT_REQUEST);
    expect(request.payload).toMatchObject({
      sessionId: 'root',
      text: 'fix notes',
      skipIfStreaming: true,
    });
    const requestId = request.payload.requestId;
    expect(handlers.promptResponse(DESIGN, { requestId, status: 'sent' })).toBe(false);
    expect(handlers.promptResponse(MAIN, { requestId, status: 'bogus' })).toBe(false);
    expect(handlers.promptResponse(MAIN, { requestId, status: 'queued' })).toBe(true);
    await expect(pending).resolves.toEqual({ status: 'queued' });
    expect(handlers.promptResponse(MAIN, { requestId, status: 'sent' })).toBe(false);
  });

  it('fails prompts from non-design senders, bad input, missing main window or timeout', async () => {
    const { handlers, toMain, killMain } = setup();
    await expect(handlers.prompt(MAIN, { text: 'x' })).resolves.toMatchObject({
      status: 'failed',
    });
    for (const raw of [null, { text: '' }, { text: 1 }, { text: 'x', sessionId: 'other' }])
      await expect(handlers.prompt(DESIGN, raw)).resolves.toMatchObject({ status: 'failed' });
    expect(toMain).toEqual([]);
    await expect(handlers.prompt(DESIGN, { text: 'x' })).resolves.toMatchObject({
      status: 'failed',
      error: expect.stringMatching(/respond|timed out/i),
    });
    killMain();
    await expect(handlers.prompt(DESIGN, { text: 'x' })).resolves.toMatchObject({
      status: 'failed',
    });
  });

  it('passes main-window failures through with a bounded message', async () => {
    const { handlers, toMain } = setup();
    const pending = handlers.prompt(DESIGN, { text: 'x' });
    const requestId = toMain[0].payload.requestId;
    handlers.promptResponse(MAIN, { requestId, status: 'failed', error: 'e'.repeat(5000) });
    const result = await pending;
    expect(result.status).toBe('failed');
    expect(result.error?.length).toBeLessThanOrEqual(1000);
  });
});
