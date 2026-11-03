import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { DesignCaptureService } from '../services/design/capture';
import { DesignEngineService } from '../services/design/engine';
import { DesignServiceError } from '../services/design/errors';
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
afterEach(async () => {
  vi.clearAllMocks();
  await Promise.all(temps.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});
async function fixture(trusted = true) {
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
  expect(broker.register).toHaveBeenCalledWith(7, { viewingSessionId: 's' });
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
