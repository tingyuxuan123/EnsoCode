import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  dir: '',
  listeners: {} as Record<string, (...args: any[]) => void>,
  url: '',
  request: undefined as any,
  open: undefined as any,
  clearHistory: vi.fn(),
  back: vi.fn(),
  historyUrl: 'file:///etc/passwd',
}));
vi.mock('../windows/createAppWindow', () => ({ getWorkbenchView: () => null }));
vi.mock('./proxyConfig', () => ({ getProxyConfig: () => ({ attachSession: () => {} }) }));
vi.mock('electron', () => ({
  app: { getPath: () => mock.dir, isPackaged: false },
  session: {
    fromPartition: () => ({
      setPermissionRequestHandler() {},
      setPermissionCheckHandler() {},
      webRequest: {
        onBeforeRequest: (_filter: unknown, handler: unknown) => {
          mock.request = handler;
        },
      },
    }),
  },
  WebContentsView: class {
    setBackgroundColor() {}
    webContents = {
      id: 42,
      on: (name: string, fn: (...args: any[]) => void) => {
        mock.listeners[name] = fn;
      },
      once() {},
      setWindowOpenHandler: (fn: unknown) => {
        mock.open = fn;
      },
      getURL: () => mock.url,
      getTitle: () => '',
      isLoading: () => false,
      navigationHistory: {
        clear: mock.clearHistory,
        canGoBack: () => true,
        canGoForward: () => true,
        getActiveIndex: () => 1,
        getEntryAtIndex: () => ({ url: mock.historyUrl }),
        goBack: mock.back,
        goForward: mock.back,
      },
      loadURL: async (url: string) => {
        mock.url = url;
        mock.listeners['did-navigate']?.();
      },
    };
  },
}));

import { setBrowserFileRootResolver } from './browserFileRoot';
import { BrowserHost } from './browserHost';

mock.dir = mkdtempSync(join(tmpdir(), 'browser-host-'));
afterAll(() => rmSync(mock.dir, { recursive: true, force: true }));
it('file 导航清除旧 HTTP 持久化；请求与页内导航守住工作区边界', async () => {
  setBrowserFileRootResolver(() => mock.dir);
  const host = new BrowserHost();
  const pages = join(mock.dir, 'pages');
  mkdirSync(pages);
  writeFileSync(join(pages, 'index.html'), 'ok');
  await host.userNavigate('tab', 'conversation', 'https://example.com');
  const file = pathToFileURL(join(pages, 'index.html')).href;
  await host.userNavigate('tab', 'conversation', file);
  expect(JSON.parse(readFileSync(join(mock.dir, 'browser-tabs.json'), 'utf8'))).not.toHaveProperty(
    'tab'
  );
  const deny = vi.fn();
  mock.listeners['will-navigate']({ preventDefault: deny }, 'file:///etc/passwd');
  mock.listeners['will-redirect']({ preventDefault: deny }, 'file:///etc/passwd');
  expect(deny).toHaveBeenCalledTimes(2);
  expect(mock.open({ url: 'file:///etc/passwd' })).toEqual({ action: 'deny' });
  expect(mock.url).toBe(file);
  const callback = vi.fn();
  mock.request({ url: 'file:///etc/passwd', webContentsId: 42 }, callback);
  expect(callback).toHaveBeenCalledWith({ cancel: true });
  await expect(host.navigate('conversation', 'file:///etc/passwd')).rejects.toThrow();
  await expect(host.userNavigate('tab', 'other-conversation', file)).rejects.toThrow(/owner/);
  expect(mock.clearHistory).toHaveBeenCalledOnce();
  host.goBack('tab');
  host.goForward('tab');
  expect(mock.back).not.toHaveBeenCalled();
  mock.request({ url: file, webContentsId: 42 }, callback);
  expect(callback).toHaveBeenLastCalledWith({ cancel: false });
  mock.request({ url: file, webContentsId: 999 }, callback);
  expect(callback).toHaveBeenLastCalledWith({ cancel: true });
  const outside = mkdtempSync(join(tmpdir(), 'browser-host-outside-'));
  try {
    writeFileSync(join(outside, 'index.html'), 'private');
    rmSync(pages, { recursive: true });
    symlinkSync(outside, pages, 'junction');
    mock.request({ url: file, webContentsId: 42 }, callback);
    expect(callback).toHaveBeenLastCalledWith({ cancel: true });
  } finally {
    rmSync(pages, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

it('模型导航可预览当前工作区文件，但不读取越界、缺失、目录或符号链接逃逸目标', async () => {
  const root = join(mock.dir, 'workspace');
  const outsideDir = join(mock.dir, 'outside');
  mkdirSync(root);
  mkdirSync(outsideDir);
  const preview = join(root, 'preview.html');
  const outside = join(outsideDir, 'outside.html');
  writeFileSync(preview, '<h1>Workspace preview</h1>');
  writeFileSync(outside, 'private');
  symlinkSync(outsideDir, join(root, 'escape'), 'junction');
  setBrowserFileRootResolver((id) => (id === 'preview-conversation' ? root : null));
  const host = new BrowserHost();
  const file = pathToFileURL(preview).href;

  // browser_navigate 实际进入的 Main 分派路径，而不仅是手动地址栏路径。
  await expect(
    host.invoke('preview-conversation', 'navigate', { url: file })
  ).resolves.toMatchObject({
    url: file,
  });
  expect(mock.url).toBe(file);

  for (const target of [
    outside,
    root,
    join(root, 'missing.html'),
    join(root, 'escape/outside.html'),
  ]) {
    await expect(
      host.invoke('preview-conversation', 'navigate', { url: pathToFileURL(target).href })
    ).rejects.toThrow(/security restriction/i);
    expect(mock.url).toBe(file);
  }
  await expect(host.invoke('unbound-conversation', 'navigate', { url: file })).rejects.toThrow(
    /security restriction/i
  );
  expect(mock.url).toBe(file);
});

it('WPS 页面重复拼接的编辑器静态资源仅修正同一 CDN 的路径，不重载文档', async () => {
  const host = new BrowserHost();
  const page = 'https://ap.wps.com/l/test-document';
  await host.userNavigate('wps', 'wps-conversation', page);
  const callback = vi.fn();

  mock.request(
    {
      url: 'https://global-static.wpscdn.com/docs/weboffice-static/weboffice-static/js/chunk/editor.zh-CN.js?v=1',
      webContentsId: 42,
      resourceType: 'script',
    },
    callback
  );

  expect(callback).toHaveBeenCalledWith({
    redirectURL:
      'https://global-static.wpscdn.com/docs/weboffice-static/js/chunk/editor.zh-CN.js?v=1',
  });
  expect(mock.url).toBe(page);
});

it('WPS 重复 CSS 路径同样修正，正常路径不再重定向', async () => {
  const host = new BrowserHost();
  await host.userNavigate('wps-css', 'wps-css-conversation', 'https://ap.wps.com/l/test-document');
  const callback = vi.fn();
  const correct = 'https://global-static.wpscdn.com/docs/weboffice-static/js/editor.zh-CN.css';
  mock.request(
    {
      url: correct.replace('/js/', '/weboffice-static/js/'),
      webContentsId: 42,
      resourceType: 'stylesheet',
    },
    callback
  );
  expect(callback).toHaveBeenLastCalledWith({ redirectURL: correct });

  mock.request({ url: correct, webContentsId: 42, resourceType: 'stylesheet' }, callback);

  expect(callback).toHaveBeenLastCalledWith({ cancel: false });
});

const wpsPage = 'https://ap.wps.com/l/test-document';
const duplicateWpsScript =
  'https://global-static.wpscdn.com/docs/weboffice-static/weboffice-static/js/editor.js';
it.each([
  ['https://other.example/', 42, 'script', duplicateWpsScript],
  ['https://ap.wps.com.evil.example/', 42, 'script', duplicateWpsScript],
  [wpsPage, 999, 'script', duplicateWpsScript],
  [wpsPage, 42, 'mainFrame', duplicateWpsScript],
  [wpsPage, 42, 'xhr', duplicateWpsScript],
  [
    wpsPage,
    42,
    'script',
    'https://evil.example/docs/weboffice-static/weboffice-static/js/editor.js',
  ],
  [wpsPage, 42, 'image', duplicateWpsScript.replace('.js', '.png')],
])(
  'WPS 兼容规则不改其他站点、未知归属、文档导航或API请求：%s / %s / %s',
  async (page, webContentsId, resourceType, url) => {
    const host = new BrowserHost();
    await host.userNavigate('wps-scope', 'wps-scope-conversation', page);
    const callback = vi.fn();

    mock.request({ url, webContentsId, resourceType }, callback);

    expect(callback).toHaveBeenCalledWith({ cancel: false });
    expect(mock.url).toBe(page);
  }
);
