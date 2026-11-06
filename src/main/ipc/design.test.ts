import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { shell } from 'electron';
import { afterEach, expect, it, vi } from 'vitest';
import { DesignCaptureService } from '../services/design/capture';
import { DesignEngineService } from '../services/design/engine';
import { DesignServiceError } from '../services/design/errors';
import * as roots from '../services/design/roots';
import { DesignScriptService } from '../services/design/scripts';
import { DesignStorage } from '../services/design/storage';
import { DesignWatchService } from '../services/design/watch';

const broker = vi.hoisted(() => ({
  register: vi.fn(),
  respond: vi.fn(() => true),
  releaseOwner: vi.fn(),
}));
vi.mock('../services/design/index', () => ({
  getDesignPaths: vi.fn(),
  getDesignToolBroker: () => broker,
}));
vi.mock('../windows/createAppWindow', () => ({
  getWindowWebContents: vi.fn(),
  sendToWindow: vi.fn(),
}));
vi.mock('../windows/MainWindow', () => ({ getMainWindow: vi.fn() }));
vi.mock('../services/agentHost', () => ({ setDesignCanvasCwds: vi.fn() }));

import { createDesignHandlers } from './design';

const temps: string[] = [];
it.each([
  ['c:\\工作区\\app', 'C:/工作区/app'],
  ['c:\\', 'C:/'],
  ['/private/work', '/private/work'],
])('resolveRoot exposes SDK paths without mutating native authority: %s', async (native, sdk) => {
  const { handlers, event } = await fixture();
  const ref = { kind: 'session' as const, sessionId: 's' };
  const root = { ref, path: native };
  vi.spyOn(roots, 'resolveDesignRoot').mockResolvedValue(root);
  expect(await handlers.resolveRoot(event, ref)).toEqual({ ok: true, root: { ref, path: sdk } });
  expect(root.path).toBe(native);
});
it.each([
  '\\\\server\\share',
  '\\\\?\\C:\\work',
  '\\\\.\\C:\\work',
  '//server/share',
  'C:work',
  'C:\\work\\..\\secret',
  'C:\\work\\.\\app',
  'C:\\work\0app',
])('resolveRoot rejects unsupported native roots: %s', async (path) => {
  const { handlers, event } = await fixture();
  const ref = { kind: 'session' as const, sessionId: 's' };
  vi.spyOn(roots, 'resolveDesignRoot').mockResolvedValue({ ref, path });
  expect(await handlers.resolveRoot(event, ref)).toMatchObject({ ok: false });
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  await Promise.all(temps.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});
it('opens the current route using only the live engine registered to the sender', async () => {
  const { handlers, event, deps } = await fixture();
  const open = vi.spyOn(shell, 'openExternal');
  vi.spyOn(deps.engine, 'registered').mockImplementation((owner, engineId) =>
    owner === 7 && engineId === 'live' ? { port: 5123 } : null
  );
  const route = { op: 'openEngineRoute', engineId: 'live', path: '/settings-ssh?tab=a#top' };
  expect(await handlers.shell(event, route)).toEqual({ ok: true });
  expect(open).toHaveBeenCalledWith('http://127.0.0.1:5123/settings-ssh?tab=a#top');
  for (const request of [
    { ...route, engineId: 'closed' },
    { ...route, path: '//example.com' },
    { ...route, path: '/\t/127.0.0.1:1/other-service' },
    { ...route, path: '/\\example.com' },
    { ...route, path: 'http://127.0.0.1:5124/' },
    { ...route, port: 5124 },
    { op: 'openExternal', url: 'http://127.0.0.1:5123/settings-ssh' },
  ])
    expect(await handlers.shell(event, request)).toMatchObject({ ok: false });
  const other = { ...event, sender: { ...event.sender, id: 8 } };
  expect(await handlers.shell(other, route)).toMatchObject({ ok: false });
  expect(open).toHaveBeenCalledTimes(1);
  expect(await handlers.shell(event, { op: 'openExternal', url: 'https://example.com/' })).toEqual({
    ok: true,
  });
  expect(open).toHaveBeenLastCalledWith('https://example.com/');
});
async function fixture(trusted = true, dedicated: Record<number, string> = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'design-ipc-'));
  temps.push(dir);
  const send = vi.fn();
  const engine = new DesignEngineService(send);
  const capture = new DesignCaptureService(() => null);
  const scripts = new DesignScriptService();
  const watch = new DesignWatchService(send);
  const storage = new DesignStorage(dir);
  const deps = {
    trusted: () => trusted,
    owner: () => null,
    engine,
    capture,
    scripts,
    watch,
    storage,
    projectRoot: vi.fn((sessionId: string): string | null | Promise<string | null> =>
      sessionId === 'ssh' ? null : `/projects/${sessionId}`
    ),
    canvasCwds: vi.fn(),
    dedicatedSession: (senderId: number): string | null => dedicated[senderId] ?? null,
  };
  const handlers = createDesignHandlers(deps);
  const once = vi.fn();
  const frame = { url: 'file:///trusted/index.html' };
  const event = {
    sender: { id: 7, isDestroyed: () => false, mainFrame: frame, once },
    senderFrame: frame,
  };
  return { handlers, event, deps, once };
}
it('每个 handler 首先拒绝不可信 sender，包括工具回复和 runtime 注册', async () => {
  const { handlers, event, once } = await fixture(false);
  for (const handler of Object.values(handlers))
    expect(await handler(event, {})).toMatchObject({ ok: false, code: 'PERMISSION_DENIED' });
  expect(once).not.toHaveBeenCalled();
  expect(broker.respond).not.toHaveBeenCalled();
  expect(broker.register).not.toHaveBeenCalled();
});
it('可信 sender 的坏参数返回结构化错误而不是抛出', async () => {
  const { handlers, event } = await fixture();
  for (const [key, handler] of Object.entries(handlers)) {
    if (key !== 'toolResponse')
      expect(await handler(event, null)).toMatchObject({ ok: false, code: 'INVALID_ARGUMENT' });
  }
});
it('内部服务抛错被包装，窗口销毁级联释放 broker/engine/watch/capture/scripts', async () => {
  const { handlers, event, deps, once } = await fixture();
  vi.spyOn(deps.engine, 'request').mockRejectedValue(
    new DesignServiceError('ENGINE_UNAVAILABLE', 'missing template')
  );
  expect(await handlers.engine(event, { op: 'diagnostics' })).toEqual({
    ok: false,
    code: 'ENGINE_UNAVAILABLE',
    error: 'missing template',
  });
  const releases = [deps.engine, deps.capture, deps.scripts, deps.watch].map((service) =>
    vi.spyOn(service, 'releaseOwner')
  );
  expect(await handlers.registerRuntime(event, { viewingSessionId: 's' })).toEqual({ ok: true });
  expect(broker.register).toHaveBeenCalledWith(7, { viewingSessionId: 's' }, false);
  expect(once).toHaveBeenCalledOnce();
  once.mock.calls[0]?.[1]();
  for (const release of releases) expect(release).toHaveBeenCalledWith(7);
  expect(broker.releaseOwner).toHaveBeenCalledWith(7);
});
it('画布按 sender 替换、跨窗口按 cwd 去重，关闭与销毁清理；SSH/坏入参不开放 gate', async () => {
  const { handlers, event, deps, once } = await fixture();
  const second = { ...event, sender: { ...event.sender, id: 8, once: vi.fn() } };
  expect(await handlers.canvasPresence(event, { sessionId: 'a', open: true })).toEqual({
    ok: true,
  });
  expect(deps.projectRoot).toHaveBeenCalledWith('a');
  expect(deps.canvasCwds).toHaveBeenLastCalledWith(['/projects/a']);
  await handlers.canvasPresence(second, { sessionId: 'a', open: true });
  expect(deps.canvasCwds).toHaveBeenCalledTimes(1);
  await handlers.canvasPresence(event, { sessionId: 'b', open: true });
  expect(deps.canvasCwds).toHaveBeenLastCalledWith(['/projects/a', '/projects/b']);
  await handlers.canvasPresence(event, { sessionId: 'ssh', open: true });
  expect(deps.canvasCwds).toHaveBeenLastCalledWith(['/projects/a']);
  for (const raw of [
    { sessionId: 'a', open: 'yes' },
    { sessionId: 'a', open: true, cwd: '/evil' },
    { open: true },
    { sessionId: '', open: true },
  ])
    expect(await handlers.canvasPresence(event, raw)).toMatchObject({ ok: false });
  second.sender.once.mock.calls[0]?.[1]();
  expect(deps.canvasCwds).toHaveBeenLastCalledWith([]);
  await handlers.canvasPresence(event, { sessionId: 'a', open: true });
  await handlers.canvasPresence(event, { sessionId: null, open: false });
  expect(deps.canvasCwds).toHaveBeenLastCalledWith([]);
  once.mock.calls[0]?.[1]();
});
it('异步 cwd 解析不能覆盖新上报或复活已销毁窗口', async () => {
  const { handlers, event, deps, once } = await fixture();
  const pending = Promise.withResolvers<string | null>();
  // The production authority is lazily imported and may yield after a newer report.
  vi.mocked(deps.projectRoot).mockImplementationOnce(() => pending.promise);
  const old = handlers.canvasPresence(event, { sessionId: 'a', open: true });
  await handlers.canvasPresence(event, { sessionId: 'b', open: true });
  pending.resolve('/projects/a');
  await old;
  expect(deps.canvasCwds).toHaveBeenLastCalledWith(['/projects/b']);
  once.mock.calls[0]?.[1]();
  expect(deps.canvasCwds).toHaveBeenLastCalledWith([]);
});
it('独立设计窗口按 Main 绑定的会话登记运行时，忽略 Renderer 上报的会话', async () => {
  const { handlers, event } = await fixture(true, { 7: 'bound' });
  expect(await handlers.registerRuntime(event, { viewingSessionId: 'other' })).toEqual({
    ok: true,
  });
  expect(broker.register).toHaveBeenCalledWith(7, { viewingSessionId: 'bound' }, true);
  expect(await handlers.registerRuntime(event, { viewingSessionId: null })).toEqual({ ok: true });
  expect(broker.register).toHaveBeenLastCalledWith(7, { viewingSessionId: 'bound' }, true);
});
it('主窗口登记仍是普通运行时', async () => {
  const { handlers, event } = await fixture();
  await handlers.registerRuntime(event, { viewingSessionId: 's' });
  expect(broker.register).toHaveBeenCalledWith(7, { viewingSessionId: 's' }, false);
});
it('独立设计窗口只能上报自己绑定会话的画布', async () => {
  const { handlers, event, deps } = await fixture(true, { 7: 'bound' });
  expect(await handlers.canvasPresence(event, { sessionId: 'other', open: true })).toMatchObject({
    ok: false,
    code: 'INVALID_ARGUMENT',
  });
  expect(deps.canvasCwds).not.toHaveBeenCalled();
  expect(await handlers.canvasPresence(event, { sessionId: 'bound', open: true })).toEqual({
    ok: true,
  });
  expect(deps.canvasCwds).toHaveBeenLastCalledWith(['/projects/bound']);
  expect(await handlers.canvasPresence(event, { sessionId: null, open: false })).toEqual({
    ok: true,
  });
  expect(deps.canvasCwds).toHaveBeenLastCalledWith([]);
});
it('独立设计窗口只能访问自己绑定会话的根，画廊项目服务不开放', async () => {
  const { handlers, event } = await fixture(true, { 7: 'bound' });
  const resolve = vi
    .spyOn(roots, 'resolveDesignRoot')
    .mockImplementation(async (ref) => ({ ref, path: '/projects/x' }));
  const other = [
    { kind: 'session', sessionId: 'other' },
    { kind: 'project', projectId: 'p' },
  ];
  for (const root of other) {
    expect(await handlers.resolveRoot(event, root)).toMatchObject({ code: 'PERMISSION_DENIED' });
    expect(await handlers.fs(event, { op: 'readFile', root, rel: 'a.txt' })).toMatchObject({
      code: 'PERMISSION_DENIED',
    });
    expect(await handlers.watch(event, { root, rel: 'a.vetd' })).toMatchObject({
      code: 'PERMISSION_DENIED',
    });
    expect(await handlers.engine(event, { op: 'start', root, designRel: 'a.vetd' })).toMatchObject({
      code: 'PERMISSION_DENIED',
    });
    expect(
      await handlers.shell(event, { op: 'showItemInFolder', root, rel: 'a.vetd' })
    ).toMatchObject({ code: 'PERMISSION_DENIED' });
  }
  expect(resolve).not.toHaveBeenCalled();
  expect(await handlers.projects(event, { op: 'list' })).toMatchObject({
    code: 'PERMISSION_DENIED',
  });
  const own = { kind: 'session', sessionId: 'bound' };
  expect(await handlers.resolveRoot(event, own)).toMatchObject({ ok: true });
  expect(resolve).toHaveBeenCalledWith(own);
});
