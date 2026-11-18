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
        getTitle: () => 'Login',
        isLoading: () => false,
        isDestroyed: () => false,
        navigationHistory: {
          clear() {},
          canGoBack: () => false,
          canGoForward: () => false,
        },
        executeJavaScript: (script: string) => mock.exec(script),
        loadURL: async (url: string) => {
          contents.url = url;
        },
        sendInputEvent: vi.fn(),
        insertText: vi.fn(async () => {}),
        debugger: { isAttached: () => false },
      };
      mock.contents.push(contents);
      this.webContents = contents;
    }
    setBackgroundColor() {}
    setBounds() {}
    setVisible() {}
  },
}));

import { BrowserHost } from './browserHost';

mock.dir = mkdtempSync(join(tmpdir(), 'browser-actions-'));
afterAll(() => rmSync(mock.dir, { recursive: true, force: true }));
beforeEach(() => {
  mock.contents.length = 0;
  mock.exec = async () => 'ok';
});

const open = async () => {
  const host = new BrowserHost();
  await host.userNavigate('tab-a', 'conv', 'https://example.com');
  const contents = mock.contents[0];
  return { host, contents };
};

it('失效引用不发送输入，错误提供当前页面的可用引用以便安全继续', async () => {
  const { host, contents } = await open();
  mock.exec = async (script) => {
    if (script.includes('const snapshotId =')) {
      return {
        text: '普通登录',
        entries: [{ ref: 'efresh_1', role: 'textbox', name: '账号', kind: 'fill', depth: 0 }],
        diagnostics: [],
        truncated: false,
      };
    }
    return { x: 10, y: 10 };
  };
  const message = await host
    .invoke('conv', 'act', { steps: [{ action: 'type', ref: 'eold_1', text: 'test-user' }] })
    .then(
      () => '',
      (error: Error) => error.message
    );
  expect(message).toContain('0 completed');
  expect(message).toContain('stale');
  expect(message).toContain('efresh_1');
  expect(contents.sendInputEvent).not.toHaveBeenCalled();
  expect(contents.insertText).not.toHaveBeenCalled();
  await host.invoke('conv', 'act', {
    steps: [{ action: 'type', ref: 'efresh_1', text: 'test-user' }],
  });
  expect(contents.insertText).toHaveBeenCalledExactlyOnceWith('test-user');
});

it('批次中途找不到按钮时保留完成数，不重放先前输入，也不执行后续步骤', async () => {
  const { host, contents } = await open();
  mock.exec = async (script) => {
    if (script.includes('const snapshotId ='))
      return {
        text: '登录中',
        entries: [{ ref: 'efresh_1', role: 'textbox', name: '账号', kind: 'fill', depth: 0 }],
        diagnostics: [],
        truncated: false,
      };
    return { x: 10, y: 10 };
  };
  const message = await host
    .invoke('conv', 'act', {
      steps: [
        { action: 'type', target: '账号', text: 'test-user' },
        { action: 'click', target: '登录', role: 'button' },
        { action: 'type', target: '账号', text: 'must-not-run' },
      ],
    })
    .then(
      () => '',
      (error: Error) => error.message
    );
  expect(message).toContain('1 completed');
  expect(message).toContain('Target not found');
  expect(message).toContain('Current page');
  expect(message).toContain('账号');
  expect(contents.insertText).toHaveBeenCalledExactlyOnceWith('test-user');
  expect(
    contents.sendInputEvent.mock.calls.some(([event]: any[]) => event.type === 'mouseDown')
  ).toBe(false);
});

it('失败反馈没有展示的引用仍不可执行', async () => {
  const { host, contents } = await open();
  mock.exec = async () => ({
    text: '',
    entries: Array.from({ length: 45 }, (_, i) => ({
      ref: `efresh_${i + 1}`,
      role: 'button',
      name: `Button ${i + 1}`,
      kind: 'click',
      depth: 0,
    })),
    diagnostics: [],
    truncated: false,
  });
  const params = (ref: string) => ({ steps: [{ action: 'click', ref }] });
  await expect(host.invoke('conv', 'act', params('eold_1'))).rejects.toThrow('efresh_40');
  await expect(host.invoke('conv', 'act', params('efresh_45'))).rejects.toThrow('stale');
  expect(contents.sendInputEvent).not.toHaveBeenCalled();
});

it('人工介入导致批次停止时不再读取页面或继续输入', async () => {
  const { host, contents } = await open();
  let reads = 0;
  mock.exec = async (script) => {
    if (script.includes('const snapshotId =')) {
      reads++;
      return {
        text: '',
        entries: [{ ref: 'efresh_1', role: 'textbox', name: '账号', kind: 'fill', depth: 0 }],
        diagnostics: [],
        truncated: false,
      };
    }
    contents.emit('input-event', {}, { type: 'mouseDown' });
    return { x: 10, y: 10 };
  };
  await expect(
    host.invoke('conv', 'act', { steps: [{ action: 'type', target: '账号', text: 'test-user' }] })
  ).rejects.toThrow('User changed the page');
  expect(reads).toBe(1);
  expect(contents.sendInputEvent).not.toHaveBeenCalled();
  expect(contents.insertText).not.toHaveBeenCalled();
});
