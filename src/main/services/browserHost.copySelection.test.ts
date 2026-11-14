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
  sent: [] as { type?: string; keyCode?: string; modifiers?: string[] }[],
  onSend: undefined as undefined | ((event: { type?: string }) => void),
  evaluate: (_params: Record<string, unknown>): unknown => ({ result: { value: { ok: true } } }),
  block: undefined as Promise<void> | undefined,
  blockFor: undefined as string | undefined,
  navigateError: undefined as Error | undefined,
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
      id: 9,
      on: (name: string, fn: (...args: any[]) => void) => {
        mock.listeners[name] = fn;
      },
      once: (name: string, fn: (...args: any[]) => void) => {
        mock.listeners[name] = fn;
      },
      isDestroyed: () => false,
      setWindowOpenHandler: () => {},
      executeJavaScript: async () => 'ok',
      sendInputEvent: (event: { type?: string }) => {
        mock.sent.push(event);
        mock.onSend?.(event);
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
          if (mock.blockFor === method) {
            mock.blockFor = undefined;
            const blocked = mock.block;
            mock.block = undefined;
            if (blocked) await blocked;
          }
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
        if (mock.navigateError) {
          const error = mock.navigateError;
          mock.navigateError = undefined;
          throw error;
        }
      },
      stop: () => {},
    };
  },
}));

import { BROWSER_OPS } from '@shared/types/agent';
import { BROWSER_HOST_INTERNAL_OPS, BrowserHost } from './browserHost';

mock.dir = mkdtempSync(join(tmpdir(), 'browser-host-copy-'));
afterAll(() => rmSync(mock.dir, { recursive: true, force: true }));

const openTab = async (host: BrowserHost, sessionId = 'conversation') => {
  await host.navigate(sessionId, 'https://example.com/');
  const tabId = host.state(sessionId).tabId;
  if (!tabId) throw new Error('tab was not opened');
  return tabId;
};

const expressions = (): string[] =>
  mock.calls
    .filter((call) => call.method === 'Runtime.evaluate')
    .map((call) => String(call.params.expression));

const isInstall = (expression: string): boolean =>
  expression.includes('proto.setData = replacement');
const isRead = (expression: string): boolean => expression.includes('deadline');
const isCleanup = (expression: string): boolean => expression.includes('delete window[key]');

const scripted = (handlers: Partial<Record<'install' | 'read' | 'cleanup', unknown>>): void => {
  mock.evaluate = (params) => {
    const expression = String(params.expression);
    if (isInstall(expression)) return handlers.install ?? { result: { value: { ok: true } } };
    if (isRead(expression)) return handlers.read ?? { result: { value: { ok: true } } };
    if (isCleanup(expression)) return handlers.cleanup ?? { result: { value: { ok: true } } };
    return { result: { value: null } };
  };
};

const capture = (text: string, meta = '') => ({
  result: { value: { ok: true, seen: true, text, meta } },
});

it('内部 op 不进 worker / 模型的 BrowserOp 闭集', () => {
  expect([...BROWSER_HOST_INTERNAL_OPS]).toEqual([
    'plugin_copy_selection',
    'plugin_insert_text',
    'plugin_read_wps_range',
  ]);
  for (const op of BROWSER_HOST_INTERNAL_OPS)
    expect(BROWSER_OPS as readonly string[]).not.toContain(op);
});

it('导航被SSO中断时返回本次固定tab标识，不把账户回调URL带给插件', async () => {
  const host = new BrowserHost();
  mock.navigateError = Object.assign(
    new Error("ERR_ABORTED (-3) loading 'https://account.wps.cn/passport?code=private'"),
    { code: 'ERR_ABORTED', errno: -3 }
  );
  let failure: any;
  try {
    await host.invoke('sso-read', 'navigate', { url: 'https://www.kdocs.cn/l/demo', newTab: true });
  } catch (error) {
    failure = error;
  }
  expect(failure).toMatchObject({ code: 'NAVIGATION_INTERRUPTED', tabId: expect.any(String) });
  expect(failure.message).not.toContain('private');
  expect(host.tabUrl(failure.tabId, 'sso-read')).toBe('https://www.kdocs.cn/l/demo');
});

it('安装固定脚本、按平台发复制键、读取投影结果并清理 hook', async () => {
  const host = new BrowserHost();
  const tabId = await openTab(host, 'copy-owner');
  mock.calls.length = 0;
  mock.sent.length = 0;
  const meta = JSON.stringify({
    srcRange: 'sheetIdx:0,rowFrom:0,rowTo:0,colFrom:1,colTo:1,sheetStId:1',
    fileId: 'file-secret',
    linkId: 'link-secret',
    html: '<b>hidden</b>',
  });
  scripted({ read: capture('需求\t数量\nA\t1', meta) });

  const result = await host.invoke('copy-owner', 'plugin_copy_selection', { tabId });
  expect(result).toEqual({
    text: '需求\t数量\nA\t1',
    range: { sheetId: '1', rowFrom: 0, rowTo: 0, colFrom: 1, colTo: 1 },
  });
  const serialized = JSON.stringify(result);
  for (const secret of ['file-secret', 'link-secret', '<b>hidden</b>', 'srcRange'])
    expect(serialized).not.toContain(secret);

  const evaluateCalls = mock.calls.filter((call) => call.method === 'Runtime.evaluate');
  expect(evaluateCalls).toHaveLength(3);
  for (const call of evaluateCalls)
    expect(call.params).toMatchObject({ returnByValue: true, awaitPromise: true });
  expect(isInstall(String(evaluateCalls[0]?.params.expression))).toBe(true);
  expect(isRead(String(evaluateCalls[1]?.params.expression))).toBe(true);
  expect(isCleanup(String(evaluateCalls[2]?.params.expression))).toBe(true);
  const token = /token: "([A-Za-z0-9_-]+)"/.exec(String(evaluateCalls[0]?.params.expression))?.[1];
  expect(token).toBeTruthy();
  for (const call of evaluateCalls) expect(String(call.params.expression)).toContain(token);

  const modifier = process.platform === 'darwin' ? 'meta' : 'control';
  expect(mock.sent.map((event) => [event.type, event.keyCode, ...(event.modifiers ?? [])])).toEqual(
    [
      ['keyDown', 'C', modifier],
      ['keyUp', 'C', modifier],
    ]
  );
});

it('没有捕获内容或文本超限都明确报错，且仍然清理 hook', async () => {
  const host = new BrowserHost();
  const tabId = await openTab(host, 'copy-fail');
  mock.calls.length = 0;
  scripted({ read: { result: { value: { ok: true, seen: false, text: '', meta: '' } } } });
  await expect(host.invoke('copy-fail', 'plugin_copy_selection', { tabId })).rejects.toThrow(
    /没有捕获/
  );
  expect(expressions().some(isCleanup)).toBe(true);

  mock.calls.length = 0;
  scripted({ read: capture('x'.repeat(64 * 1024 + 1)) });
  await expect(host.invoke('copy-fail', 'plugin_copy_selection', { tabId })).rejects.toThrow(/64/);
  expect(expressions().some(isCleanup)).toBe(true);

  mock.calls.length = 0;
  mock.sent.length = 0;
  scripted({ install: { result: { value: { ok: false, reason: 'busy' } } } });
  await expect(host.invoke('copy-fail', 'plugin_copy_selection', { tabId })).rejects.toThrow(
    /another copy_selection/
  );
  // busy 时不会发出复制键；cleanup 带着本次 token 运行也只是无害的 no-op
  expect(expressions().some(isCleanup)).toBe(true);
  expect(mock.sent).toEqual([]);
});

it('动作中取消也撤销 hook，取消前已入队则不发 CDP', async () => {
  const host = new BrowserHost();
  const tabId = await openTab(host, 'copy-abort');

  mock.calls.length = 0;
  mock.sent.length = 0;
  const before = new AbortController();
  before.abort();
  await expect(
    host.invoke('copy-abort', 'plugin_copy_selection', { tabId }, undefined, {
      signal: before.signal,
    })
  ).rejects.toThrow();
  expect(expressions()).toEqual([]);
  expect(mock.sent).toEqual([]);

  mock.calls.length = 0;
  mock.sent.length = 0;
  scripted({});
  const during = new AbortController();
  mock.onSend = (event) => {
    if (event.type === 'keyUp') during.abort();
  };
  await expect(
    host.invoke('copy-abort', 'plugin_copy_selection', { tabId }, undefined, {
      signal: during.signal,
    })
  ).rejects.toThrow();
  await vi.waitFor(() => expect(expressions().some(isCleanup)).toBe(true));
  mock.onSend = undefined;
});

it('按 tab 队列串行，排队期间 guard 失败不发 CDP', async () => {
  const host = new BrowserHost();
  const tabId = await openTab(host, 'copy-queue');
  mock.calls.length = 0;
  mock.sent.length = 0;
  scripted({ read: capture('queued') });
  let release: () => void = () => {};
  mock.block = new Promise<void>((resolve) => {
    release = resolve;
  });
  mock.blockFor = 'Runtime.enable';
  const slow = host.invoke('copy-queue', 'cdp', { method: 'Runtime.enable', params: {} });
  const copy = host.invoke('copy-queue', 'plugin_copy_selection', { tabId });
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(expressions()).toEqual([]);
  expect(mock.sent).toEqual([]);
  release();
  await slow;
  await expect(copy).resolves.toEqual({ text: 'queued' });

  mock.calls.length = 0;
  mock.sent.length = 0;
  await expect(
    host.invoke('copy-queue', 'plugin_copy_selection', { tabId }, undefined, {
      guard: () => {
        throw new Error('document changed');
      },
    })
  ).rejects.toThrow('document changed');
  expect(expressions()).toEqual([]);
  expect(mock.sent).toEqual([]);
});

it('跨会话、未知 tab 与非法入参都不发 CDP', async () => {
  const host = new BrowserHost();
  const tabId = await openTab(host, 'copy-guard');
  mock.calls.length = 0;
  mock.sent.length = 0;
  await expect(host.invoke('someone-else', 'plugin_copy_selection', { tabId })).rejects.toThrow(
    /owner/i
  );
  await expect(
    host.invoke('copy-guard', 'plugin_copy_selection', { tabId: 'browser:404' })
  ).rejects.toThrow();
  // Host 自己也不接受键盘选择器 / JS / 额外参数
  for (const extra of [{ key: 'Meta+C' }, { expression: 'document.body.innerText' }])
    await expect(
      host.invoke('copy-guard', 'plugin_copy_selection', { tabId, ...extra })
    ).rejects.toThrow(/copy_selection/);
  expect(expressions()).toEqual([]);
  expect(mock.sent).toEqual([]);
});
