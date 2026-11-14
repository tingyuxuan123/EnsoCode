import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  dir: '',
  listeners: {} as Record<string, (...args: any[]) => void>,
  url: '',
  attached: false,
  calls: [] as { method: string; params: Record<string, unknown> }[],
  result: undefined as unknown,
  block: undefined as Promise<void> | undefined,
}));
vi.mock('../windows/createAppWindow', () => ({ getWorkbenchView: () => null }));
vi.mock('./proxyConfig', () => ({ getProxyConfig: () => ({ attachSession: () => {} }) }));
vi.mock('electron', () => ({
  app: { getPath: () => mock.dir, isPackaged: false },
  session: {
    fromPartition: () => ({
      setPermissionRequestHandler() {},
      setPermissionCheckHandler() {},
      webRequest: { onBeforeRequest: () => {} },
    }),
  },
  WebContentsView: class {
    setBackgroundColor() {}
    webContents = {
      id: 7,
      on: (name: string, fn: (...args: any[]) => void) => {
        mock.listeners[name] = fn;
      },
      once: (name: string, fn: (...args: any[]) => void) => {
        mock.listeners[name] = fn;
      },
      isDestroyed: () => false,
      setWindowOpenHandler: () => {},
      executeJavaScript: async () => 'ok',
      getURL: () => mock.url,
      getTitle: () => '',
      isLoading: () => false,
      debugger: {
        isAttached: () => mock.attached,
        attach: () => {
          mock.attached = true;
        },
        sendCommand: async (method: string, params: Record<string, unknown>) => {
          mock.calls.push({ method, params });
          const blocked = mock.block;
          if (blocked) {
            mock.block = undefined;
            await blocked;
          }
          return mock.result;
        },
      },
      navigationHistory: {
        clear: () => {},
        canGoBack: () => false,
        canGoForward: () => false,
        getActiveIndex: () => 0,
        getEntryAtIndex: () => null,
        goBack: () => {},
        goForward: () => {},
      },
      loadURL: async (url: string) => {
        mock.url = url;
        mock.listeners['dom-ready']?.();
      },
      stop: () => {},
    };
  },
}));

import { BrowserHost } from './browserHost';

mock.dir = mkdtempSync(join(tmpdir(), 'browser-host-inspect-'));
afterAll(() => rmSync(mock.dir, { recursive: true, force: true }));

const openTab = async (host: BrowserHost, sessionId = 'conversation') => {
  await host.navigate(sessionId, 'https://example.com/');
  const tabId = host.state(sessionId).tabId;
  if (!tabId) throw new Error('tab was not opened');
  return tabId;
};

it('检查走固定的 Runtime.evaluate 脚本，只回投影字段', async () => {
  const host = new BrowserHost();
  const tabId = await openTab(host);
  mock.calls.length = 0;
  mock.result = {
    result: {
      value: [
        {
          tag: 'div',
          text: 'row',
          ref: 'row-1',
          rect: { x: 1, y: 2, width: 3, height: 4 },
          html: '<img onerror=alert(1)>',
          cookies: 'session=1',
        },
        { tag: 'script', text: 'steal()', rect: { x: 0, y: 0, width: 0, height: 0 } },
      ],
    },
  };
  await expect(host.inspectElements(tabId, 'conversation', '#main')).resolves.toEqual([
    { tag: 'div', text: 'row', ref: 'row-1', rect: { x: 1, y: 2, width: 3, height: 4 } },
  ]);
  const evaluated = mock.calls.filter((call) => call.method === 'Runtime.evaluate');
  expect(evaluated).toHaveLength(1);
  expect(evaluated[0]?.params).toMatchObject({ returnByValue: true });
  expect(String(evaluated[0]?.params.expression)).toContain('data-enso-ref');
  expect(String(evaluated[0]?.params.expression)).toContain(JSON.stringify('#main'));
});

it('跨会话或未知 tab 被拒绝，坏页面结果报错', async () => {
  const host = new BrowserHost();
  const tabId = await openTab(host, 'owner');
  // 插件拿 navigate 的返回值继续操作：会话当前 agent tab 就是刚导航的那个
  expect(host.agentTabId('owner')).toBe(tabId);
  await expect(host.inspectElements(tabId, 'someone-else', '#main')).rejects.toThrow(/owner/i);
  expect(() => host.tabUrl(tabId, 'someone-else')).toThrow(/owner/i);
  await expect(host.inspectElements('browser:404', 'owner', '#main')).rejects.toThrow(
    /closed|unknown/i
  );
  expect(host.tabUrl(tabId, 'owner')).toBe('https://example.com/');

  mock.result = { result: { value: 'not-an-array' } };
  await expect(host.inspectElements(tabId, 'owner', '#main')).rejects.toThrow(/unexpected/i);
  mock.result = undefined as unknown;
  await expect(host.inspectElements(tabId, 'owner', '#main')).rejects.toThrow(
    /no result|unexpected/i
  );
});

it('检查走 BrowserHost 队列并响应取消信号', async () => {
  const host = new BrowserHost();
  const tabId = await openTab(host, 'owner');
  mock.result = {
    result: {
      value: [{ tag: 'input', text: '', value: '', rect: { x: 1, y: 2, width: 3, height: 4 } }],
    },
  };
  const evaluated = () => mock.calls.filter((call) => call.method === 'Runtime.evaluate').length;

  // 已取消的调用在入队前就失败，不会发出 CDP
  const before = evaluated();
  await expect(
    host.inspectElements(tabId, 'owner', '#main', undefined, { signal: AbortSignal.abort() })
  ).rejects.toThrow();
  expect(evaluated()).toBe(before);

  // 前一个 tab 操作没结束时，检查排在它后面，不插队
  let release: () => void = () => {};
  mock.block = new Promise<void>((resolve) => {
    release = resolve;
  });
  const slow = host.invoke('owner', 'cdp', { method: 'Runtime.enable', params: {} });
  const inspect = host.inspectElements(tabId, 'owner', '#main');
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(evaluated()).toBe(before);
  release();
  await slow;
  await expect(inspect).resolves.toEqual([
    { tag: 'input', text: '', value: '', rect: { x: 1, y: 2, width: 3, height: 4 } },
  ]);
});

it('排队期间URL改变，检查开始前guard阻止发出CDP', async () => {
  const host = new BrowserHost();
  const tabId = await openTab(host, 'guard-owner');
  const before = mock.calls.filter((call) => call.method === 'Runtime.evaluate').length;
  await expect(
    host.inspectElements(tabId, 'guard-owner', '#main', undefined, {
      guard: () => {
        throw new Error('document changed');
      },
    })
  ).rejects.toThrow('document changed');
  expect(mock.calls.filter((call) => call.method === 'Runtime.evaluate')).toHaveLength(before);
});
