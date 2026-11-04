import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { acquireDesignCanvas, setDesignViewingCwd } from './host/canvas-target';
import { designTools } from './host/registry';
import type { PluginContext } from './host/types';
import { dispatchDesignTool } from './runtime-dispatch';
import type { CanvasController } from './vetta/src/canvas/design-runtime';
import { getCanvasController, setCanvasController } from './vetta/src/canvas/design-runtime';

const controller = (path: string) =>
  ({ session: { vetdPath: path, dirPath: path } }) as CanvasController;
const a = controller('/a/first.vetd');
const b = controller('/b/ride.vetd');
const request = (tool: 'vetd_create' | 'vetd_status' | 'vetd_screenshot' | 'vetd_sizes') => ({
  requestId: tool,
  tool,
  params: {},
  session: { sessionId: 'b', cwd: '/b' },
});
const open = vi.fn();
const botCanvas = vi.hoisted(() => ({ visible: false, open: vi.fn() }));
vi.mock('./host/bot-canvas', () => ({
  isViewedBotDesignChat: () => botCanvas.visible,
  revealBotDesign: botCanvas.open,
}));
const ctx = {
  plugin: { id: 'vetta-ui-design' },
  fs: {
    listFilesRecursive: async () => [
      { name: 'design.json', path: '/b/ride.vetd/design.json', relPath: 'ride.vetd/design.json' },
    ],
  },
  conversation: {},
  ui: { openActivityTab: open },
} as unknown as PluginContext;
const register = (name: string, handler: () => unknown) =>
  designTools.set(name, { id: name, description: '', parameters: {}, handler });
const text = (result: Awaited<ReturnType<typeof dispatchDesignTool>>) =>
  JSON.parse((result.content[0] as { text: string }).text);

beforeEach(() => {
  designTools.clear();
  localStorage.clear();
  open.mockReset();
  botCanvas.visible = false;
  botCanvas.open.mockReset();
  setCanvasController(a);
  setDesignViewingCwd('/b');
});
afterEach(() => {
  setCanvasController(null);
  setDesignViewingCwd(null);
  vi.useRealTimers();
});

it('does not execute B status on A while B canvas is mounting', async () => {
  register('vetd_status', () => ({ open: getCanvasController()?.session.vetdPath }));
  let settled = false;
  const pending = dispatchDesignTool(
    request('vetd_status'),
    new AbortController().signal,
    ctx
  ).then((result) => {
    settled = true;
    return result;
  });
  await vi.waitFor(() => expect(open).toHaveBeenCalled());
  expect(settled).toBe(false);
  setCanvasController(b);
  expect(text(await pending)).toEqual({ open: '/b/ride.vetd' });
});

it('create waits for its exact design, not an older design in the same cwd, and queues status', async () => {
  setCanvasController(controller('/b/old.vetd'));
  register('vetd_create', () => ({ ok: true, vetdPath: '/b/ride.vetd' }));
  register('vetd_status', () => ({ open: getCanvasController()?.session.vetdPath }));
  let created = false;
  const pending = dispatchDesignTool(
    request('vetd_create'),
    new AbortController().signal,
    ctx
  ).then((result) => {
    created = true;
    return result;
  });
  const status = dispatchDesignTool(request('vetd_status'), new AbortController().signal, ctx);
  await vi.waitFor(() => expect(open).toHaveBeenCalled());
  expect(created).toBe(false);
  setCanvasController(b);
  expect(text(await pending)).toMatchObject({ ok: true, vetdPath: '/b/ride.vetd' });
  expect(text(await status)).toEqual({ open: '/b/ride.vetd' });
});

it('fails retryably without invoking the handler when mounting times out, and releases the lease', async () => {
  vi.useFakeTimers();
  const handler = vi.fn(() => ({ open: getCanvasController()?.session.vetdPath }));
  register('vetd_status', handler);
  const pending = dispatchDesignTool(request('vetd_status'), new AbortController().signal, ctx);
  await vi.advanceTimersByTimeAsync(60_001);
  expect(text(await pending)).toMatchObject({ ok: false, retryable: true });
  expect(handler).not.toHaveBeenCalled();
  setCanvasController(b);
  expect(
    text(await dispatchDesignTool(request('vetd_status'), new AbortController().signal, ctx))
  ).toEqual({ open: '/b/ride.vetd' });
});

it('a failed create-open retains the created path and directs retry away from another create', async () => {
  vi.useFakeTimers();
  setCanvasController(controller('/b/old.vetd'));
  register('vetd_create', () => ({ ok: true, vetdPath: '/b/ride.vetd' }));
  const pending = dispatchDesignTool(request('vetd_create'), new AbortController().signal, ctx);
  await vi.advanceTimersByTimeAsync(60_001);
  expect(text(await pending)).toMatchObject({
    ok: false,
    created: true,
    retryable: true,
    vetdPath: '/b/ride.vetd',
    error: expect.stringContaining('do not repeat vetd_create'),
  });
  open.mockClear();
  register('vetd_status', () => ({ open: getCanvasController('/b')?.session.vetdPath }));
  const retry = dispatchDesignTool(request('vetd_status'), new AbortController().signal, ctx);
  await vi.advanceTimersByTimeAsync(1);
  expect(open).toHaveBeenCalled();
  setCanvasController(b);
  expect(text(await retry)).toEqual({ open: '/b/ride.vetd' });
});

it('cancellation while waiting never executes the tool on the old controller', async () => {
  const abort = new AbortController();
  const handler = vi.fn();
  register('vetd_status', handler);
  const pending = dispatchDesignTool(request('vetd_status'), abort.signal, ctx);
  await vi.waitFor(() => expect(open).toHaveBeenCalled());
  abort.abort();
  await expect(pending).rejects.toThrow();
  setCanvasController(b);
  expect(handler).not.toHaveBeenCalled();
  register('vetd_status', () => ({ open: getCanvasController()?.session.vetdPath }));
  expect(
    text(await dispatchDesignTool(request('vetd_status'), new AbortController().signal, ctx))
  ).toEqual({ open: '/b/ride.vetd' });
});

it('rejects background rendered tools and create without changing the foreground canvas', async () => {
  setDesignViewingCwd('/a');
  const handler = vi.fn();
  for (const tool of ['vetd_screenshot', 'vetd_create'] as const) {
    register(tool, handler);
    expect(
      text(await dispatchDesignTool(request(tool), new AbortController().signal, ctx))
    ).toMatchObject({
      ok: false,
      retryable: true,
      error: expect.stringContaining('another project'),
    });
  }
  expect(handler).not.toHaveBeenCalled();
  expect(open).not.toHaveBeenCalled();
  expect(getCanvasController()).toBe(a);
});

it('opens a Bot tool canvas in the active chat without opening the Code dock', async () => {
  setDesignViewingCwd(null);
  botCanvas.visible = true;
  register('vetd_create', () => ({ ok: true, vetdPath: '/b/ride.vetd' }));
  const base = request('vetd_create');
  const pending = dispatchDesignTool(
    { ...base, session: { ...base.session, botChatId: 'chat-b' } },
    new AbortController().signal,
    ctx
  );
  await vi.waitFor(() =>
    expect(botCanvas.open).toHaveBeenCalledWith({
      chatId: 'chat-b',
      sessionId: 'b',
      cwd: '/b',
      path: '/b/ride.vetd',
    })
  );
  setCanvasController({ ...b, botChatId: 'chat-b' } as CanvasController);
  expect(text(await pending)).toMatchObject({ ok: true });
  expect(open).not.toHaveBeenCalled();
});

it('does not use the Code canvas for a background Bot chat in the same workspace', async () => {
  setCanvasController(b);
  const handler = vi.fn();
  register('vetd_screenshot', handler);
  const base = request('vetd_screenshot');
  expect(
    text(
      await dispatchDesignTool(
        { ...base, session: { ...base.session, botChatId: 'chat-b' } },
        new AbortController().signal,
        ctx
      )
    )
  ).toMatchObject({ ok: false, retryable: true });
  expect(handler).not.toHaveBeenCalled();
  expect(open).not.toHaveBeenCalled();
});

it('background status and file-only tools do not wait for or switch the canvas', async () => {
  setDesignViewingCwd('/a');
  const release = await acquireDesignCanvas(new AbortController().signal);
  try {
    register('vetd_status', () => ({ designs: ['/b/ride.vetd'], open: getCanvasController('/b') }));
    register('vetd_sizes', () => ({ sizes: [390] }));
    expect(
      text(await dispatchDesignTool(request('vetd_status'), new AbortController().signal, ctx))
    ).toEqual({ designs: ['/b/ride.vetd'], open: null });
    expect(
      text(await dispatchDesignTool(request('vetd_sizes'), new AbortController().signal, ctx))
    ).toEqual({ sizes: [390] });
    expect(open).not.toHaveBeenCalled();
  } finally {
    release();
  }
});

it('queued lease acquisition has a timeout and cancelled waiters do not block successors', async () => {
  vi.useFakeTimers();
  const release = await acquireDesignCanvas(new AbortController().signal);
  const abort = new AbortController();
  const cancelled = acquireDesignCanvas(abort.signal);
  const cancelledResult = expect(cancelled).rejects.toThrow();
  abort.abort();
  await cancelledResult;
  register('vetd_status', () => ({ open: getCanvasController('/b')?.session.vetdPath }));
  const busy = dispatchDesignTool(request('vetd_status'), new AbortController().signal, ctx);
  await vi.advanceTimersByTimeAsync(60_001);
  expect(text(await busy)).toMatchObject({
    ok: false,
    retryable: true,
    error: expect.stringContaining('busy'),
  });
  release();
  setCanvasController(b);
  expect(
    text(await dispatchDesignTool(request('vetd_status'), new AbortController().signal, ctx))
  ).toEqual({ open: '/b/ride.vetd' });
});

it('scoped controller reads reject sibling-prefix projects and remain safe after an await', async () => {
  setCanvasController(controller('/b-other/design.vetd'));
  expect(getCanvasController('/b')).toBeNull();
  setCanvasController(b);
  expect(getCanvasController('/b/')).toBe(b);
  await Promise.resolve();
  setCanvasController(a);
  expect(getCanvasController('/b')).toBeNull();
});

it('a nested project canvas is not the parent workspace canvas', () => {
  setCanvasController({ ...controller('/b/nested/ride.vetd'), cwd: '/b/nested' });
  expect(getCanvasController('/b')).toBeNull();
  expect(getCanvasController('/b/nested')).not.toBeNull();
  setCanvasController({ ...a, cwd: '/b' });
  expect(getCanvasController('/b')).toBeNull();
});

it('cancelling an executing handler releases the lease even when upstream cannot abort its work', async () => {
  setCanvasController(b);
  let finish = () => {};
  register(
    'vetd_status',
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      })
  );
  const abort = new AbortController();
  const pending = dispatchDesignTool(request('vetd_status'), abort.signal, ctx);
  const rejection = expect(pending).rejects.toThrow();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  abort.abort();
  await rejection;
  register('vetd_status', () => ({ open: getCanvasController('/b')?.session.vetdPath }));
  expect(
    text(await dispatchDesignTool(request('vetd_status'), new AbortController().signal, ctx))
  ).toEqual({ open: '/b/ride.vetd' });
  finish();
});
