import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  windows: [] as any[],
  sessions: [] as any[],
  partitions: [] as string[],
  screenshot: vi.fn(),
  deferDom: false,
  loadFailure: false,
  probes: [] as Array<{ host: string; port: number }>,
  probeFailures: [] as string[],
}));
vi.mock('node:net', async () => {
  const { EventEmitter } = await import('node:events');
  return {
    createConnection(options: { host: string; port: number }) {
      mock.probes.push(options);
      const socket = Object.assign(new EventEmitter(), { destroy: vi.fn() });
      queueMicrotask(() =>
        socket.emit(
          mock.probeFailures.includes(options.host) ? 'error' : 'connect',
          new Error('Refused')
        )
      );
      return socket;
    },
  };
});
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events');
  return {
    session: {
      fromPartition(partition: string) {
        mock.partitions.push(partition);
        const session = Object.assign(new EventEmitter(), {
          setPermissionRequestHandler: vi.fn(),
          setPermissionCheckHandler: vi.fn(),
          closeAllConnections: vi.fn(async () => {}),
          clearStorageData: vi.fn(async () => {}),
          clearCache: vi.fn(async () => {}),
          setProxy: vi.fn(async () => {}),
          protocol: { handle: vi.fn(), unhandle: vi.fn() },
          webRequest: {
            onBeforeRequest: vi.fn(),
            onBeforeSendHeaders: vi.fn(),
            onHeadersReceived: vi.fn(),
          },
        });
        mock.sessions.push(session);
        return session;
      },
    },
    BrowserWindow: class extends EventEmitter {
      destroyed = false;
      options: any;
      webContents: any;
      constructor(options: any) {
        super();
        this.options = options;
        const debuggerApi = Object.assign(new EventEmitter(), {
          attach: vi.fn(),
          detach: vi.fn(),
          isAttached: () => debuggerApi.attach.mock.calls.length > 0,
          sendCommand: vi.fn(async (method: string, params: unknown) => {
            if (method === 'Page.captureScreenshot') return mock.screenshot(params);
            return {};
          }),
        });
        this.webContents = Object.assign(new EventEmitter(), {
          debugger: debuggerApi,
          stop: vi.fn(),
          isDestroyed: () => this.destroyed,
          setWindowOpenHandler: vi.fn(),
          setWebRTCIPHandlingPolicy: vi.fn(),
          getURL: () => 'http://127.0.0.1:5173/',
          isLoadingMainFrame: vi.fn(() => false),
          getTitle: () => 'Preview',
          loadURL: vi.fn(async (_url: string) => {
            this.webContents.emit(
              'did-start-navigation',
              {},
              'http://127.0.0.1:5173/',
              false,
              true
            );
            if (mock.loadFailure) throw new Error('Load failed');
            if (!mock.deferDom) this.webContents.emit('dom-ready');
          }),
        });
        mock.windows.push(this);
      }
      destroy() {
        this.destroyed = true;
        this.emit('closed');
      }
      isDestroyed() {
        return this.destroyed;
      }
      loadURL(url: string) {
        return this.webContents.loadURL(url);
      }
    },
  };
});

import { createPairPreviewBrowser } from './pairPreviewBrowser';

const candidate = {
  id: 'id',
  kind: 'server' as const,
  label: 'Vite',
  root: '/workspace',
  url: 'http://127.0.0.1:5173/',
};
const viewport = { width: 800, height: 600 };
let mockRoot: string;
beforeEach(async () => {
  mockRoot = await mkdtemp(join(tmpdir(), 'enso-preview-mock-'));
  candidate.root = mockRoot;
  mock.windows = [];
  mock.sessions = [];
  mock.partitions = [];
  mock.deferDom = false;
  mock.loadFailure = false;
  mock.probes = [];
  mock.probeFailures = [];
  mock.screenshot.mockReset().mockResolvedValue({ data: Buffer.from('jpeg').toString('base64') });
});
afterEach(async () => {
  for (const window of mock.windows) if (!window.destroyed) window.destroy();
  await rm(mockRoot, { recursive: true, force: true });
});

it('每个预览拥有不持久化的独立沙箱窗口、无 preload 和全部拒绝的权限', async () => {
  const one = await createPairPreviewBrowser(candidate, viewport);
  const two = await createPairPreviewBrowser(candidate, viewport);
  expect(new Set(mock.partitions).size).toBe(2);
  expect(mock.partitions.every((name) => !name.startsWith('persist:'))).toBe(true);
  const options = mock.windows[0].options;
  expect(options).toMatchObject({ show: false, useContentSize: true, width: 800, height: 600 });
  expect(options.webPreferences).toMatchObject({
    offscreen: true,
    backgroundThrottling: false,
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    webSecurity: true,
  });
  expect(options.webPreferences).not.toHaveProperty('preload');
  const session = mock.sessions[0];
  expect(session.setProxy).toHaveBeenCalledWith({
    mode: 'fixed_servers',
    proxyRules: 'http://enso-preview-blackhole.invalid:1',
    proxyBypassRules: '<-loopback>;http://127.0.0.1:5173;ws://127.0.0.1:5173',
  });
  const deny = vi.fn();
  session.setPermissionRequestHandler.mock.calls[0][0]({}, 'camera', deny);
  expect(deny).toHaveBeenCalledWith(false);
  expect(session.setPermissionCheckHandler.mock.calls[0][0]({}, 'clipboard-read')).toBe(false);
  const open = mock.windows[0].webContents.setWindowOpenHandler.mock.calls[0][0];
  expect(open({ url: candidate.url })).toEqual({ action: 'deny' });
  const preventDefault = vi.fn();
  session.emit('will-download', { preventDefault });
  mock.windows[0].webContents.emit('will-attach-webview', { preventDefault });
  expect(preventDefault).toHaveBeenCalledTimes(2);
  one.close();
  two.close();
});

it('静态入口只加载分区私有 HTTP 地址，不打开 file URL 且关闭注销处理器', async () => {
  const root = await mkdtemp(join(tmpdir(), 'enso-preview-browser-'));
  try {
    const entry = join(root, 'index.html');
    await writeFile(entry, '<h1>preview</h1>');
    const browser = await createPairPreviewBrowser(
      { ...candidate, kind: 'html', root, url: entry },
      viewport
    );
    expect(mock.windows[0].webContents.loadURL).toHaveBeenLastCalledWith(
      'http://enso-preview.invalid/index.html'
    );
    const [scheme, handler] = mock.sessions[0].protocol.handle.mock.calls[0];
    expect(scheme).toBe('http');
    const response = await handler(new Request('http://enso-preview.invalid/index.html'));
    expect(await response.text()).toBe('<h1>preview</h1>');
    browser.close();
    expect(mock.sessions[0].protocol.unhandle).toHaveBeenCalledWith('http');
    expect((await handler(new Request('http://enso-preview.invalid/index.html'))).status).toBe(410);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it('开发服务器只探测批准端口的两个数值 loopback，IPv4 不可达时选 IPv6 不查询 DNS', async () => {
  mock.probeFailures = ['127.0.0.1'];
  const browser = await createPairPreviewBrowser(candidate, viewport);
  expect(mock.probes).toEqual([
    { host: '127.0.0.1', port: 5173 },
    { host: '::1', port: 5173 },
  ]);
  expect(mock.windows[0].webContents.loadURL).toHaveBeenLastCalledWith('http://[::1]:5173/');
  expect(mock.sessions[0].setProxy).toHaveBeenCalledWith(
    expect.objectContaining({ proxyBypassRules: '<-loopback>;http://[::1]:5173;ws://[::1]:5173' })
  );
  const handler = mock.sessions[0].webRequest.onBeforeRequest.mock.calls[0][1];
  const callback = vi.fn();
  handler({ url: candidate.url, resourceType: 'mainFrame' }, callback);
  expect(callback).toHaveBeenCalledWith({ cancel: true });
  browser.close();
});

it('两个数值 loopback 都不可达时拒绝且不创建窗口，恶意候选不会探测任意地址', async () => {
  mock.probeFailures = ['127.0.0.1', '::1'];
  await expect(createPairPreviewBrowser(candidate, viewport)).rejects.toThrow();
  expect(mock.windows).toHaveLength(0);
  mock.probes = [];
  await expect(
    createPairPreviewBrowser({ ...candidate, url: 'http://192.168.1.1:5173/' }, viewport)
  ).rejects.toThrow();
  expect(mock.probes).toHaveLength(0);
});

it('首次 dom-ready 后才 attach debugger，并设置布局、焦点和原生弹窗拦截', async () => {
  mock.deferDom = true;
  const pending = createPairPreviewBrowser(candidate, viewport);
  await vi.waitFor(() => expect(mock.windows).toHaveLength(1));
  const contents = mock.windows[0].webContents;
  expect(contents.debugger.attach).not.toHaveBeenCalled();
  contents.emit('dom-ready');
  const browser = await pending;
  const send = contents.debugger.sendCommand;
  expect(contents.loadURL.mock.calls.map(([url]: [string]) => url)).toEqual([
    'about:blank',
    candidate.url,
  ]);
  const addScript = send.mock.calls.find(
    ([method]: [string]) => method === 'Page.addScriptToEvaluateOnNewDocument'
  );
  expect(addScript).toBeDefined();
  const realm = {
    RTCPeerConnection: class {},
    webkitRTCPeerConnection: class {},
    WebTransport: class {},
  };
  runInNewContext(addScript[1].source, realm);
  for (const name of ['RTCPeerConnection', 'webkitRTCPeerConnection', 'WebTransport']) {
    expect(Object.getOwnPropertyDescriptor(realm, name)).toMatchObject({
      value: undefined,
      writable: false,
      configurable: false,
    });
  }
  expect(send).toHaveBeenCalledWith(
    'Emulation.setDeviceMetricsOverride',
    expect.objectContaining({ width: 800, height: 600, deviceScaleFactor: 1 })
  );
  expect(send).toHaveBeenCalledWith('Emulation.setFocusEmulationEnabled', { enabled: true });
  expect(send).toHaveBeenCalledWith('Page.setInterceptFileChooserDialog', { enabled: true });
  contents.debugger.emit('message', {}, 'Page.javascriptDialogOpening', {});
  await vi.waitFor(() =>
    expect(send).toHaveBeenCalledWith('Page.handleJavaScriptDialog', { accept: false })
  );
  browser.close();
});

it('所有导航和请求都检查封闭源，刷新后旧截图不能再点，关闭后迟到请求全拒绝', async () => {
  const browser = await createPairPreviewBrowser(candidate, viewport);
  const contents = mock.windows[0].webContents;
  const handler = mock.sessions[0].webRequest.onBeforeRequest.mock.calls[0][1];
  const callback = vi.fn();
  handler({ url: 'https://example.com/a.js', resourceType: 'script' }, callback);
  expect(callback).toHaveBeenLastCalledWith({ cancel: true });
  handler({ url: `${candidate.url}src/app.js`, resourceType: 'script' }, callback);
  expect(callback).toHaveBeenLastCalledWith({ cancel: false });
  for (const event of ['will-navigate', 'will-redirect']) {
    const preventDefault = vi.fn();
    contents.emit(event, { preventDefault }, 'file:///etc/passwd');
    expect(preventDefault).toHaveBeenCalledOnce();
  }
  const preventDefault = vi.fn();
  contents.emit('will-frame-navigate', { preventDefault, url: candidate.url, isMainFrame: false });
  expect(preventDefault).toHaveBeenCalledOnce();
  await expect(browser.input({ kind: 'click', x: 10, y: 20 })).rejects.toThrow('stale-frame');
  await browser.capture();
  await browser.input({ kind: 'click', x: 10, y: 20 });
  contents.emit('did-start-navigation', {}, candidate.url, false, true);
  await expect(browser.input({ kind: 'click', x: 10, y: 20 })).rejects.toThrow();
  await browser.capture();
  await browser.input({ kind: 'click', x: 10, y: 20 });
  await browser.refresh();
  await expect(browser.input({ kind: 'click', x: 10, y: 20 })).rejects.toThrow();
  browser.close();
  browser.close();
  handler({ url: candidate.url, resourceType: 'mainFrame' }, callback);
  expect(callback).toHaveBeenLastCalledWith({ cancel: true });
  expect(mock.windows[0].destroyed).toBe(true);
  expect(mock.sessions[0].clearStorageData).toHaveBeenCalledOnce();
});

it('输入仅通过固定 CDP 可信事件派发，不允许任意脚本或越界坐标', async () => {
  const browser = await createPairPreviewBrowser(candidate, viewport);
  await browser.capture();
  const send = mock.windows[0].webContents.debugger.sendCommand;
  await browser.input({ kind: 'click', x: 10, y: 20 });
  expect(send).toHaveBeenCalledWith(
    'Input.dispatchMouseEvent',
    expect.objectContaining({ type: 'mousePressed', x: 10, y: 20, button: 'left', clickCount: 1 })
  );
  expect(send).toHaveBeenCalledWith(
    'Input.dispatchMouseEvent',
    expect.objectContaining({ type: 'mouseReleased', x: 10, y: 20 })
  );
  await browser.input({ kind: 'scroll', deltaX: 0, deltaY: 150 });
  expect(send).toHaveBeenCalledWith(
    'Input.dispatchMouseEvent',
    expect.objectContaining({ type: 'mouseWheel', deltaY: 150 })
  );
  await browser.input({ kind: 'text', text: '你好 React' });
  expect(send).toHaveBeenCalledWith('Input.insertText', { text: '你好 React' });
  await browser.input({ kind: 'key', key: 'Enter' });
  expect(send).toHaveBeenCalledWith(
    'Input.dispatchKeyEvent',
    expect.objectContaining({ type: 'keyDown', key: 'Enter', text: '\r' })
  );
  expect(send).toHaveBeenCalledWith(
    'Input.dispatchKeyEvent',
    expect.objectContaining({ type: 'keyUp', key: 'Enter' })
  );
  await expect(browser.input({ kind: 'click', x: 900, y: 0 })).rejects.toThrow();
  expect(send.mock.calls.some(([method]: [string]) => method.startsWith('Runtime.'))).toBe(false);
  browser.close();
});

it('鼠标按下后若已开始跳转，不会把释放或剩余输入派发给新页面', async () => {
  const browser = await createPairPreviewBrowser(candidate, viewport);
  await browser.capture();
  const contents = mock.windows[0].webContents;
  contents.debugger.sendCommand.mockImplementationOnce(async () => {
    contents.emit('did-start-navigation', {}, candidate.url, false, true);
    return {};
  });
  await expect(browser.input({ kind: 'click', x: 10, y: 20 })).rejects.toThrow();
  expect(contents.debugger.sendCommand).not.toHaveBeenCalledWith(
    'Input.dispatchMouseEvent',
    expect.objectContaining({ type: 'mouseReleased' })
  );
  browser.close();
});

it('一次完成的点击可正常触发同源导航，下一帧等主文档加载后再捕获', async () => {
  const browser = await createPairPreviewBrowser(candidate, viewport);
  await browser.capture();
  const contents = mock.windows[0].webContents;
  contents.debugger.sendCommand
    .mockImplementationOnce(async () => ({}))
    .mockImplementationOnce(async () => {
      contents.isLoadingMainFrame.mockReturnValue(true);
      contents.emit('did-start-navigation', {}, candidate.url, false, true);
      return {};
    });
  await expect(browser.input({ kind: 'click', x: 10, y: 20 })).resolves.toBeUndefined();
  mock.screenshot.mockClear();
  const next = browser.capture();
  await Promise.resolve();
  expect(mock.screenshot).not.toHaveBeenCalled();
  contents.isLoadingMainFrame.mockReturnValue(false);
  contents.emit('did-stop-loading');
  expect((await next).width).toBe(800);
  browser.close();
});

it('调用超时会终止窗口，关闭清理的单步失败不阻止其它资源释放', async () => {
  const browser = await createPairPreviewBrowser(candidate, viewport);
  mock.screenshot.mockImplementation(() => new Promise(() => {}));
  vi.useFakeTimers();
  try {
    const pending = expect(browser.capture()).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(10_001);
    await pending;
    expect(mock.windows[0].destroyed).toBe(true);
  } finally {
    vi.useRealTimers();
  }
  const other = await createPairPreviewBrowser(candidate, viewport);
  mock.windows[1].webContents.debugger.detach.mockImplementation(() => {
    throw new Error('Already detached');
  });
  expect(() => other.close()).not.toThrow();
  expect(mock.windows[1].destroyed).toBe(true);
  expect(mock.sessions[1].clearStorageData).toHaveBeenCalledOnce();
});

it('截图途中一次跳转会重试获取新视觉，不发送旧视觉', async () => {
  const browser = await createPairPreviewBrowser(candidate, viewport);
  mock.screenshot.mockImplementationOnce(async () => {
    mock.windows[0].webContents.emit('did-start-navigation', {}, candidate.url, false, true);
    return { data: 'AQID' };
  });
  expect((await browser.capture()).width).toBe(800);
  expect(mock.screenshot).toHaveBeenCalledTimes(2);
  browser.close();
});

it('导航使截图 CDP 命令拒绝时仍只重试一次，不销毁可恢复的窗口', async () => {
  const browser = await createPairPreviewBrowser(candidate, viewport);
  mock.screenshot.mockImplementationOnce(async () => {
    mock.windows[0].webContents.emit('did-start-navigation', {}, candidate.url, false, true);
    throw new Error('Execution context destroyed');
  });
  expect((await browser.capture()).width).toBe(800);
  expect(mock.windows[0].destroyed).toBe(false);
  browser.close();
});

it('截图连续跳转只重试一次并返回可恢复 stale-frame，不销毁浏览器', async () => {
  const browser = await createPairPreviewBrowser(candidate, viewport);
  mock.screenshot.mockImplementation(async () => {
    mock.windows[0].webContents.emit('did-start-navigation', {}, candidate.url, false, true);
    return { data: 'AQID' };
  });
  await expect(browser.capture()).rejects.toThrow('stale-frame');
  expect(mock.screenshot).toHaveBeenCalledTimes(2);
  expect(mock.windows[0].destroyed).toBe(false);
  await expect(browser.input({ kind: 'key', key: 'Enter' })).rejects.toThrow('stale-frame');
  browser.close();
});

it('JPEG 截图保持 viewport 坐标，降低质量后仍严格限制 data URL 字符数', async () => {
  mock.screenshot
    .mockResolvedValueOnce({ data: 'A'.repeat(700_001) })
    .mockResolvedValueOnce({ data: 'AQID' });
  const browser = await createPairPreviewBrowser(candidate, viewport);
  const frame = await browser.capture();
  expect(frame).toMatchObject({
    width: 800,
    height: 600,
    dataUrl: 'data:image/jpeg;base64,AQID',
    title: 'Preview',
  });
  expect(mock.screenshot.mock.calls[0][0]).toMatchObject({
    format: 'jpeg',
    quality: 65,
    captureBeyondViewport: false,
  });
  // 真机回归：固定文档 clip(0,0) 在 scrollY=550 时没有捕获可见的下半页，必须拍当前视口。
  expect(mock.screenshot.mock.calls[0][0]).not.toHaveProperty('clip');
  expect(mock.screenshot.mock.calls[1][0].quality).toBeLessThan(65);
  mock.screenshot.mockResolvedValue({ data: 'A'.repeat(700_001) });
  await expect(browser.capture()).rejects.toThrow('too-large');
  browser.close();
});

it('加载失败或等待超时都会销毁资源，不会遗留隐藏进程', async () => {
  mock.loadFailure = true;
  await expect(createPairPreviewBrowser(candidate, viewport)).rejects.toThrow();
  expect(mock.windows[0].destroyed).toBe(true);
  mock.loadFailure = false;
  mock.deferDom = true;
  vi.useFakeTimers();
  try {
    const pending = createPairPreviewBrowser(candidate, viewport);
    const rejected = expect(pending).rejects.toThrow();
    await vi.waitFor(() => expect(mock.windows).toHaveLength(2));
    await vi.advanceTimersByTimeAsync(15_001);
    await rejected;
    expect(mock.windows.at(-1).destroyed).toBe(true);
  } finally {
    vi.useRealTimers();
  }
});
