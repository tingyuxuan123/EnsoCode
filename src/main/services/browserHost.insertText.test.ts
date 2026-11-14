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
  sent: [] as { type?: string }[],
  inserted: [] as string[],
  executed: [] as { code: string; userGesture: boolean }[],
  checkResult: { ok: true } as unknown,
  onCheck: undefined as undefined | (() => void),
  evaluate: (_params: Record<string, unknown>): unknown => ({ result: { value: { ok: true } } }),
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
      id: 11,
      on: (name: string, fn: (...args: any[]) => void) => {
        mock.listeners[name] = fn;
      },
      once: (name: string, fn: (...args: any[]) => void) => {
        mock.listeners[name] = fn;
      },
      isDestroyed: () => false,
      setWindowOpenHandler: () => {},
      executeJavaScript: async (code: string, userGesture: boolean) => {
        mock.executed.push({ code, userGesture });
        mock.onCheck?.();
        return mock.checkResult;
      },
      insertText: async (text: string) => {
        mock.inserted.push(text);
      },
      sendInputEvent: (event: { type?: string }) => {
        mock.sent.push(event);
      },
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
          if (method === 'Runtime.evaluate') return mock.evaluate(params);
          return {};
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

mock.dir = mkdtempSync(join(tmpdir(), 'browser-host-insert-'));
afterAll(() => rmSync(mock.dir, { recursive: true, force: true }));

const openTab = async (host: BrowserHost, sessionId = 'conversation') => {
  await host.navigate(sessionId, 'https://example.com/');
  const tabId = host.state(sessionId).tabId;
  if (!tabId) throw new Error('tab was not opened');
  return tabId;
};

const checks = (): string[] => mock.executed.map((entry) => entry.code);

it('固定 DOM 校验后只向 activeElement 原生 insertText，不自动 focus/选择/回车', async () => {
  const host = new BrowserHost();
  const tabId = await openTab(host, 'insert-owner');
  mock.calls.length = 0;
  mock.sent.length = 0;
  mock.inserted.length = 0;
  mock.executed.length = 0;

  await expect(
    host.invoke('insert-owner', 'plugin_insert_text', { tabId, text: '需求\t数量' })
  ).resolves.toMatchObject({ url: 'https://example.com/' });
  expect(mock.inserted).toEqual(['需求\t数量']);
  expect(mock.sent).toEqual([]);

  const [check] = checks();
  expect(check).toBeTruthy();
  expect(check).toContain('activeElement');
  expect(check).toContain('getBoundingClientRect');
  expect(check).toContain('visibility');
  expect(check).not.toContain('需求');
  expect(mock.executed).toHaveLength(1);
});

it('activeElement 不合法时明确拒绝且不插入，允许 opacity:0 输入代理', async () => {
  const host = new BrowserHost();
  const tabId = await openTab(host, 'insert-reject');
  for (const [reason, pattern] of [
    ['none', /No focused editable element/],
    ['not-editable', /not input, textarea or contenteditable/],
    ['password', /password/],
    ['hidden', /hidden/],
    ['file', /file/],
    ['readonly', /read-?only/i],
    ['disabled', /disabled/],
    ['invisible', /not visible/],
  ] as const) {
    mock.inserted.length = 0;
    mock.checkResult = { ok: false, reason };
    await expect(
      host.invoke('insert-reject', 'plugin_insert_text', { tabId, text: 'x' })
    ).rejects.toThrow(pattern);
    expect(mock.inserted).toEqual([]);
  }
  // opacity:0 的合法输入代理不会被 Host 再拦一次
  mock.checkResult = { ok: true };
  await expect(
    host.invoke('insert-reject', 'plugin_insert_text', { tabId, text: '需求' })
  ).resolves.toBeTruthy();
  expect(mock.inserted).toEqual(['需求']);
});

it('脏参数、跨会话与未知 tab 都不发 CDP，也不插入', async () => {
  const host = new BrowserHost();
  const tabId = await openTab(host, 'insert-guard');
  mock.calls.length = 0;
  mock.inserted.length = 0;
  mock.executed.length = 0;
  for (const params of [
    { tabId },
    { tabId, text: 1 },
    { tabId, text: 'x', selector: '#edit_proxy' },
    { tabId, text: 'x', ref: 'e1_2' },
    { tabId, text: 'x', expression: 'document.body.innerText' },
    { tabId, text: 'x', enter: true },
    { tabId, text: '需'.repeat(10923) },
  ])
    await expect(host.invoke('insert-guard', 'plugin_insert_text', params)).rejects.toThrow();
  await expect(
    host.invoke('someone-else', 'plugin_insert_text', { tabId, text: 'x' })
  ).rejects.toThrow(/owner/i);
  await expect(
    host.invoke('insert-guard', 'plugin_insert_text', { tabId: 'browser:404', text: 'x' })
  ).rejects.toThrow();
  expect(checks()).toEqual([]);
  expect(mock.inserted).toEqual([]);
});

it('取消与 guard 都在插入前停止，不调用 insertText', async () => {
  const host = new BrowserHost();
  const tabId = await openTab(host, 'insert-abort');
  mock.calls.length = 0;
  mock.inserted.length = 0;
  mock.executed.length = 0;
  mock.checkResult = { ok: true };

  const before = new AbortController();
  before.abort();
  await expect(
    host.invoke('insert-abort', 'plugin_insert_text', { tabId, text: 'x' }, undefined, {
      signal: before.signal,
    })
  ).rejects.toThrow();
  expect(checks()).toEqual([]);
  expect(mock.inserted).toEqual([]);

  await expect(
    host.invoke('insert-abort', 'plugin_insert_text', { tabId, text: 'x' }, undefined, {
      guard: () => {
        throw new Error('document changed');
      },
    })
  ).rejects.toThrow('document changed');
  expect(checks()).toEqual([]);
  expect(mock.inserted).toEqual([]);

  // 校验完成后、真正插入前取消：队列信号复查必须拦住 insertText
  mock.executed.length = 0;
  const during = new AbortController();
  mock.onCheck = () => during.abort();
  await expect(
    host.invoke('insert-abort', 'plugin_insert_text', { tabId, text: 'x' }, undefined, {
      signal: during.signal,
    })
  ).rejects.toThrow();
  expect(mock.inserted).toEqual([]);
  mock.onCheck = undefined;
});

it('允许空串插入（清空后不再写内容），但不做选择或回车', async () => {
  const host = new BrowserHost();
  const tabId = await openTab(host, 'insert-empty');
  mock.calls.length = 0;
  mock.sent.length = 0;
  mock.inserted.length = 0;
  mock.executed.length = 0;
  mock.checkResult = { ok: true };
  await expect(
    host.invoke('insert-empty', 'plugin_insert_text', { tabId, text: '' })
  ).resolves.toBeTruthy();
  expect(mock.inserted).toEqual(['']);
  expect(mock.sent).toEqual([]);
});
