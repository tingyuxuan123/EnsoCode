import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  dir: '',
  contents: [] as any[],
  exec: (async () => 'ok') as (script: string) => Promise<unknown>,
}));
vi.mock('../windows/createAppWindow', () => ({ getWorkbenchView: () => null }));
vi.mock('./proxyConfig', () => ({ getProxyConfig: () => ({ attachSession: () => {} }) }));
vi.mock('electron', () => ({
  app: { getPath: () => mock.dir, isPackaged: false },
  session: {
    fromPartition: () => ({
      setPermissionRequestHandler() {},
      setPermissionCheckHandler() {},
      webRequest: { onBeforeRequest() {} },
    }),
  },
  WebContentsView: class {
    webContents: any;
    constructor() {
      const listeners: Record<string, ((...args: any[]) => void)[]> = {};
      const contents = {
        id: mock.contents.length + 1,
        url: '',
        scripts: [] as string[],
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
        isLoading: () => false,
        isDestroyed: () => false,
        navigationHistory: {
          clear() {},
          canGoBack: () => false,
          canGoForward: () => false,
          getActiveIndex: () => 0,
          getEntryAtIndex: () => undefined,
        },
        executeJavaScript: (script: string) => {
          contents.scripts.push(script);
          return mock.exec(script);
        },
        loadURL: async (url: string) => {
          contents.url = url;
        },
        debugger: {
          isAttached: () => false,
          attach() {},
          detach() {},
          on() {},
          sendCommand: async () => ({}),
        },
      };
      mock.contents.push(contents);
      this.webContents = contents;
    }
    setBackgroundColor() {}
    setBounds() {}
    setVisible() {}
  },
}));

import { PAGE_UNLOCK_OVERLAY_SCRIPT } from '@shared/browser/pageScripts';
import { BrowserHost } from './browserHost';

mock.dir = mkdtempSync(join(tmpdir(), 'browser-lock-'));
afterAll(() => rmSync(mock.dir, { recursive: true, force: true }));

beforeEach(() => {
  mock.contents.length = 0;
  mock.exec = async () => 'ok';
});

const openTab = async (host: BrowserHost, tabId: string, sessionId = 'conv') => {
  await host.userNavigate(tabId, sessionId, 'https://example.com');
  const contents = mock.contents[mock.contents.length - 1];
  contents.emit('dom-ready');
  return contents;
};

it('browser_lock 只保留标签生命周期，不安装阻止人工操作的遮罩', async () => {
  const host = new BrowserHost();
  const contents = await openTab(host, 'tab-a');
  await host.setLocked('conv', true);
  expect(host.state('tab-a').locked).toBe(true);
  expect(contents.scripts.some((script: string) => script.includes('preventDefault'))).toBe(false);

  mock.exec = async () => {
    throw new Error('context destroyed');
  };
  await host.setLocked('conv', false);
  expect(host.state('tab-a').locked).toBe(false);
});

it('保留和释放标签不再依赖页内遮罩执行结果', async () => {
  const host = new BrowserHost();
  await openTab(host, 'tab-a');
  expect(await host.invoke('conv', 'lock', {})).toEqual({ locked: true });

  mock.exec = async () => 'stuck';
  expect(await host.invoke('conv', 'lock', { release: true })).toEqual({ locked: false });
});

it('did-finish-load 无论是否保留标签都清掉旧版或 BFCache 残留遮罩', async () => {
  const host = new BrowserHost();
  const contents = await openTab(host, 'tab-a');

  contents.scripts.length = 0;
  contents.emit('did-finish-load');
  await Promise.resolve();
  expect(contents.scripts).toContain(PAGE_UNLOCK_OVERLAY_SCRIPT);

  await host.setLocked('conv', true);
  contents.scripts.length = 0;
  contents.emit('did-finish-load');
  await Promise.resolve();
  expect(contents.scripts).toContain(PAGE_UNLOCK_OVERLAY_SCRIPT);
  expect(contents.scripts.some((script: string) => script.includes('preventDefault'))).toBe(false);
});

it('release 解锁会话下所有 tab，加锁仍只作用于当前 tab', async () => {
  const host = new BrowserHost();
  const first = await openTab(host, 'tab-a');
  await host.setLocked('conv', true);
  const second = await openTab(host, 'tab-b');
  expect(host.state('tab-b').locked).toBe(false);

  await host.setLocked('conv', true);
  expect(host.state('tab-a').locked).toBe(true);
  expect(host.state('tab-b').locked).toBe(true);

  first.scripts.length = 0;
  second.scripts.length = 0;
  await host.setLocked('conv', false);
  expect(host.state('tab-a').locked).toBe(false);
  expect(host.state('tab-b').locked).toBe(false);
});
