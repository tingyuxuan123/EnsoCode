import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  dir: '',
  contents: [] as any[],
  windows: [] as any[],
  workbench: { name: 'workbench', setBounds() {} } as any,
}));
vi.mock('../windows/createAppWindow', () => ({ getWorkbenchView: () => mock.workbench }));
vi.mock('./proxyConfig', () => ({ getProxyConfig: () => ({ attachSession: () => {} }) }));
vi.mock('electron', () => ({
  app: { getPath: () => mock.dir, isPackaged: false },
  session: {
    fromPartition: () => ({
      setPermissionRequestHandler() {},
      setPermissionCheckHandler() {},
      webRequest: { onBeforeRequest() {} },
      cookies: { flushStore: async () => {} },
      flushStorageData: async () => {},
    }),
  },
  BrowserWindow: class {
    destroyed = false;
    listeners: Record<string, (() => void)[]> = {};
    contentView = makeWindow().contentView;
    constructor() {
      mock.windows.push(this);
    }
    isDestroyed = () => this.destroyed;
    getContentBounds = () => ({ width: 960, height: 640 });
    on(name: string, fn: () => void) {
      this.listeners[name] = [...(this.listeners[name] ?? []), fn];
    }
    show() {}
    destroy() {
      this.destroyed = true;
      for (const view of [...this.contentView.children]) view.webContents.close();
      for (const fn of this.listeners.closed ?? []) fn();
    }
  },
  WebContentsView: class {
    name = 'guest';
    webContents: any;
    bounds: unknown;
    visible = false;
    constructor() {
      const listeners: Record<string, ((...args: any[]) => void)[]> = {};
      const contents = {
        id: mock.contents.length + 1,
        url: '',
        destroyed: false,
        devtoolsOpened: false,
        devtools: null as any,
        on: (name: string, fn: (...args: any[]) => void) => {
          listeners[name] = [...(listeners[name] ?? []), fn];
        },
        once: (name: string, fn: (...args: any[]) => void) => {
          listeners[name] = [...(listeners[name] ?? []), fn];
        },
        emit: (name: string, ...args: any[]) => {
          for (const fn of listeners[name] ?? []) fn(...args);
        },
        setWindowOpenHandler() {},
        getURL: () => contents.url,
        getTitle: () => '',
        getUserAgent: () => 'test Chromium',
        isLoading: () => false,
        isDestroyed: () => contents.destroyed,
        isDevToolsOpened: () => contents.devtoolsOpened,
        close: () => {
          if (contents.destroyed) return;
          contents.destroyed = true;
          contents.emit('destroyed');
        },
        setDevToolsWebContents: (devtools: any) => {
          contents.devtools = devtools;
        },
        openDevTools: () => {
          contents.devtoolsOpened = true;
        },
        closeDevTools: () => {
          if (!contents.devtoolsOpened) return;
          contents.devtoolsOpened = false;
          contents.devtools?.close();
          contents.emit('devtools-closed');
        },
        navigationHistory: {
          clear() {},
          canGoBack: () => false,
          canGoForward: () => false,
          getActiveIndex: () => 0,
          getEntryAtIndex: () => undefined,
        },
        executeJavaScript: async () => 'ok',
        reload: () => contents.emit('did-start-loading'),
        loadURL: async (url: string) => {
          contents.url = url;
        },
        debugger: {
          isAttached: () => true,
          attach() {},
          detach() {},
          on() {},
          sendCommand: vi.fn(async () => ({})),
        },
      };
      mock.contents.push(contents);
      this.webContents = contents;
    }
    setBackgroundColor() {}
    setBounds(bounds: unknown) {
      this.bounds = bounds;
    }
    setVisible(visible: boolean) {
      this.visible = visible;
    }
  },
}));

import { BrowserHost } from './browserHost';

mock.dir = mkdtempSync(join(tmpdir(), 'browser-zorder-'));
afterAll(() => rmSync(mock.dir, { recursive: true, force: true }));

const makeWindow = () => {
  const children: any[] = [];
  return {
    isDestroyed: () => false,
    isMinimized: () => false,
    getBounds: () => ({ x: 0, y: 0, width: 1200, height: 800 }),
    getContentBounds: () => ({ width: 1200, height: 800 }),
    contentView: {
      children,
      addChildView: (view: any, index?: number) => {
        if (view.webContents?.isDestroyed()) throw new Error('Cannot add a destroyed child view');
        const at = children.indexOf(view);
        if (at >= 0) children.splice(at, 1);
        if (index === undefined) children.push(view);
        else children.splice(index, 0, view);
      },
      removeChildView: (view: any) => {
        const at = children.indexOf(view);
        if (at >= 0) children.splice(at, 1);
      },
    },
  };
};

const raised = (win: ReturnType<typeof makeWindow>) => {
  const { children } = win.contentView;
  const guest = children.findIndex((c) => c.name === 'guest');
  return guest > children.indexOf(mock.workbench);
};

const viewport = { x: 0, y: 0, width: 600, height: 400 };

beforeEach(() => {
  mock.contents.length = 0;
  mock.windows.length = 0;
});

const setup = async () => {
  const host = new BrowserHost();
  const win = makeWindow();
  host.setHostWindow(() => win as any);
  await host.userNavigate('tab-a', 'conv', 'https://example.com');
  mock.contents[0].emit('dom-ready');
  host.setViewport('tab-a', 'conv', viewport);
  return { host, win };
};

it('浮层上报方消失后不再永久压住 guest', async () => {
  const { host, win } = await setup();
  expect(raised(win)).toBe(true);

  host.setOverlayActive(true);
  expect(raised(win)).toBe(false);

  host.resetOverlayReports();
  expect(raised(win)).toBe(true);
  // 新 renderer 从 count=0 起步，不会补发 false；重置后必须能再次沉下去
  host.setOverlayActive(true);
  expect(raised(win)).toBe(false);
});

it('covered 闩锁同样在上报方消失后回落', async () => {
  const { host, win } = await setup();
  host.setViewport('tab-a', 'conv', viewport, true);
  expect(raised(win)).toBe(false);

  host.resetOverlayReports();
  expect(raised(win)).toBe(true);
});

const openDockedDevtools = (host: BrowserHost) => {
  host.setDevTools('tab-a', true);
  host.setDevToolsViewport('tab-a', 'conv', viewport);
  mock.contents.at(-1).emit('console-message', {
    message: '__enso_devtools_dock__{"bounds":{"x":0,"y":0,"width":600,"height":240}}',
  });
};

it('收到 Electron 关闭事件后恢复整页尺寸，更多菜单仍能盖住网页', async () => {
  const { host, win } = await setup();
  const states: boolean[] = [];
  host.onState((_session, _id, state) => states.push(state.devtoolsOpen));
  const guest = win.contentView.children.find((view) => view.webContents === mock.contents[0]);
  openDockedDevtools(host);
  expect(guest.bounds).toEqual({ ...viewport, height: 240 });

  // Electron 关闭自定义 DevTools 前端时也会销毁其 webContents。
  mock.contents[0].closeDevTools();

  expect(host.state('tab-a').devtoolsOpen).toBe(false);
  expect(states.at(-1)).toBe(false);
  expect(guest.bounds).toEqual(viewport);
  expect(guest.visible).toBe(true);
  host.setViewport('tab-a', 'conv', viewport, true);
  expect(raised(win)).toBe(false);
  host.setViewport('tab-a', 'conv', viewport, false);
  expect(raised(win)).toBe(true);
});

it('从工具栏关闭和重复重开都不复用已销毁的 DevTools 视图', async () => {
  const { host, win } = await setup();
  for (let i = 0; i < 3; i++) {
    openDockedDevtools(host);
    const frontend = mock.contents.at(-1);
    expect(frontend.isDestroyed()).toBe(false);
    expect(host.state('tab-a').devtoolsOpen).toBe(true);

    host.setDevTools('tab-a', false);

    expect(frontend.isDestroyed()).toBe(true);
    expect(host.state('tab-a').devtoolsOpen).toBe(false);
    expect(win.contentView.children.some((view) => view.webContents === frontend)).toBe(false);
    expect(raised(win)).toBe(true);
  }
});

it('DevTools 前端先销毁时立即恢复布局，不等待下一次 viewport 上报', async () => {
  const { host, win } = await setup();
  openDockedDevtools(host);
  const guest = win.contentView.children.find((view) => view.webContents === mock.contents[0]);

  mock.contents.at(-1).close();

  expect(host.state('tab-a').devtoolsOpen).toBe(false);
  expect(guest.bounds).toEqual(viewport);
  expect(raised(win)).toBe(true);
});

it('DevTools 自带关闭按钮的桥接通知恢复整页和菜单层级', async () => {
  const { host, win } = await setup();
  openDockedDevtools(host);
  const frontend = mock.contents.at(-1);
  const guest = win.contentView.children.find((view) => view.webContents === mock.contents[0]);

  frontend.emit('console-message', { message: '__enso_devtools_dock__{"closed":true}' });

  expect(host.state('tab-a').devtoolsOpen).toBe(false);
  expect(frontend.isDestroyed()).toBe(true);
  expect(guest.bounds).toEqual(viewport);
  host.setViewport('tab-a', 'conv', viewport, true);
  expect(raised(win)).toBe(false);
});

it('旧前端延迟到达的关闭和区域消息不能影响重开的 DevTools', async () => {
  const { host, win } = await setup();
  openDockedDevtools(host);
  const oldFrontend = mock.contents.at(-1);
  host.setDevTools('tab-a', false);
  openDockedDevtools(host);
  const guest = win.contentView.children.find((view) => view.webContents === mock.contents[0]);

  oldFrontend.emit('console-message', {
    message: '__enso_devtools_dock__{"bounds":{"x":0,"y":0,"width":600,"height":1}}',
  });
  oldFrontend.emit('console-message', { message: '__enso_devtools_dock__{"closed":true}' });

  expect(guest.bounds).toEqual({ ...viewport, height: 240 });
  expect(host.state('tab-a').devtoolsOpen).toBe(true);
});
it('旧 DevTools 的迟到 Electron 关闭事件不误关已重开的前端', async () => {
  const { host, win } = await setup();
  openDockedDevtools(host);
  host.setDevTools('tab-a', false);
  openDockedDevtools(host);
  const frontend = mock.contents.at(-1);
  const guest = win.contentView.children.find((view) => view.webContents === mock.contents[0]);

  mock.contents[0].emit('devtools-closed');

  expect(host.state('tab-a').devtoolsOpen).toBe(true);
  expect(frontend.isDestroyed()).toBe(false);
  expect(guest.bounds).toEqual({ ...viewport, height: 240 });
  await host.dispose();
});

it('独立 DevTools 窗口关闭后清理前端，网页与菜单仍正常', async () => {
  const { host, win } = await setup();
  openDockedDevtools(host);
  const frontend = mock.contents.at(-1);
  frontend.emit('console-message', { message: '__enso_devtools_dock__{"side":"undocked"}' });
  const devtoolsWindow = mock.windows.at(-1);
  expect(host.state('tab-a').devtoolsDock).toBe('undocked');

  devtoolsWindow.destroy();

  expect(host.state('tab-a').devtoolsOpen).toBe(false);
  expect(frontend.isDestroyed()).toBe(true);
  host.setViewport('tab-a', 'conv', viewport, true);
  expect(raised(win)).toBe(false);
});

it('从独立窗口重新停靠只关空宿主窗，不销毁或误关 DevTools', async () => {
  const { host, win } = await setup();
  openDockedDevtools(host);
  const frontend = mock.contents.at(-1);
  frontend.emit('console-message', { message: '__enso_devtools_dock__{"side":"undocked"}' });
  const devtoolsWindow = mock.windows.at(-1);

  frontend.emit('console-message', { message: '__enso_devtools_dock__{"side":"bottom"}' });

  expect(devtoolsWindow.isDestroyed()).toBe(true);
  expect(frontend.isDestroyed()).toBe(false);
  expect(host.state('tab-a').devtoolsOpen).toBe(true);
  expect(win.contentView.children.some((view) => view.webContents === frontend)).toBe(true);
  host.setDevTools('tab-a', false);
  expect(host.state('tab-a').devtoolsOpen).toBe(false);
});

it('关闭 DevTools 后即使尺寸没变也重新应用设备模拟', async () => {
  const { host } = await setup();
  const device = { enabled: true, width: 393, height: 852, mobile: true };
  await host.setDevice('tab-a', 'conv', device);
  openDockedDevtools(host);
  mock.contents[0].debugger.sendCommand.mockClear();

  host.setDevTools('tab-a', false);

  await vi.waitFor(() =>
    expect(mock.contents[0].debugger.sendCommand).toHaveBeenCalledWith(
      'Emulation.setDeviceMetricsOverride',
      expect.objectContaining({ width: 393, height: 852 })
    )
  );
});

it('面板可见性上报不抢 agent 当前 tab，也不为空面板建空 tab', async () => {
  const { host } = await setup();
  host.setViewport('browser:panel-uuid', 'conv', viewport);
  expect(host.state('conv').tabId).toBe('tab-a');
  expect(mock.contents).toHaveLength(1);
  // 原始症状：面板上报后 reload 落到空页并报 URL 不允许
  await expect(host.invoke('conv', 'navigation', { action: 'reload' })).resolves.toBeDefined();
});

it('尚未加载页面的 tab reload 报明确原因，不冒充 URL 策略拒绝', async () => {
  const host = new BrowserHost();
  await host.invoke('conv', 'tabs', { action: 'new' });
  await expect(host.invoke('conv', 'navigation', { action: 'reload' })).rejects.toThrow(
    /no page loaded/i
  );
});

it('hibernateAll 关掉 guest webContents，进托盘才能丢掉 renderer', async () => {
  const { host, win } = await setup();
  let closed = false;
  mock.contents[0].close = () => {
    closed = true;
    mock.contents[0].isDestroyed = () => true;
  };
  expect(win.contentView.children.some((c) => c.name === 'guest')).toBe(true);

  await host.hibernateAll();

  expect(closed).toBe(true);
  expect(host.state('tab-a').tabId).toBe(null);
  expect(win.contentView.children.some((c) => c.name === 'guest')).toBe(false);
  expect(host.listSearchableTabs().some((tab) => tab.url.startsWith('https://example.com'))).toBe(
    true
  );
});
