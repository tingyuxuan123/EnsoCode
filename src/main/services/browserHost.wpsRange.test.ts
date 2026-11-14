import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, it, vi } from 'vitest';

type Kind =
  | 'ready'
  | 'prepare'
  | 'recheck'
  | 'verify'
  | 'sheet'
  | 'copy-install'
  | 'copy-read'
  | 'copy-cleanup'
  | 'other';

const mock = vi.hoisted(() => ({
  dir: '',
  listeners: {} as Record<string, (...args: any[]) => void>,
  url: '',
  attached: false,
  executed: [] as Kind[],
  cdp: [] as Kind[],
  inserted: [] as string[],
  sent: [] as {
    type?: string;
    keyCode?: string;
    modifiers?: string[];
    x?: number;
    y?: number;
  }[],
  responses: {} as Partial<Record<string, unknown>>,
  onExecute: undefined as undefined | ((kind: string) => void),
  take: (kind: string): unknown => {
    const value = mock.responses[kind];
    if (Array.isArray(value)) return value.length > 0 ? value.shift() : { ok: true };
    return value ?? { ok: true };
  },
  kindOf: (expression: string): string => {
    if (expression.includes('proto.setData = replacement')) return 'copy-install';
    if (expression.includes('deadline')) return 'copy-read';
    if (expression.includes('delete window[key]')) return 'copy-cleanup';
    if (expression.includes('__ensoWpsReady')) return 'ready';
    if (expression.includes('__ensoWpsPrepare')) return 'prepare';
    if (expression.includes('__ensoWpsRecheck')) return 'recheck';
    if (expression.includes('__ensoWpsVerify')) return 'verify';
    if (expression.includes('__ensoWpsSheet')) return 'sheet';
    return 'other';
  },
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
      id: 13,
      on: (name: string, fn: (...args: any[]) => void) => {
        mock.listeners[name] = fn;
      },
      once: (name: string, fn: (...args: any[]) => void) => {
        mock.listeners[name] = fn;
      },
      isDestroyed: () => false,
      setWindowOpenHandler: () => {},
      executeJavaScript: async (code: string) => {
        const kind = mock.kindOf(code);
        mock.executed.push(kind as Kind);
        mock.onExecute?.(kind);
        return mock.take(kind);
      },
      insertText: async (text: string) => {
        mock.inserted.push(text);
      },
      sendInputEvent: (event: { type?: string; keyCode?: string; modifiers?: string[] }) => {
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
          if (method !== 'Runtime.evaluate') return {};
          const kind = mock.kindOf(String(params.expression));
          mock.cdp.push(kind as Kind);
          return { result: { value: mock.take(kind) } };
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

mock.dir = mkdtempSync(join(tmpdir(), 'browser-host-wps-'));
afterAll(() => rmSync(mock.dir, { recursive: true, force: true }));

const WPS_URL = 'https://www.kdocs.cn/l/isolated-fixture';

const reset = (): void => {
  mock.executed.length = 0;
  mock.cdp.length = 0;
  mock.inserted.length = 0;
  mock.sent.length = 0;
  mock.responses = {};
  mock.onExecute = undefined;
};

const openTab = async (host: BrowserHost, sessionId = 'wps-owner') => {
  await host.navigate(sessionId, WPS_URL);
  const tabId = host.state(sessionId).tabId;
  if (!tabId) throw new Error('tab was not opened');
  return tabId;
};

const rangeMeta = (rowTo = 200, colTo = 11) =>
  JSON.stringify({
    srcRange: `sheetIdx:0,rowFrom:0,rowTo:${rowTo},colFrom:0,colTo:${colTo},sheetStId:1`,
    fileId: 'must-not-leak',
    html: '<b>must-not-leak</b>',
  });

const okFlow = () => {
  mock.url = WPS_URL;
  mock.responses = {
    ready: { ok: true, x: 100, y: 60 },
    prepare: { ok: true },
    recheck: { ok: true },
    verify: { ok: true },
    sheet: [
      { ok: true, sheet: '需求清单2026' },
      { ok: true, sheet: '需求清单2026' },
    ],
    'copy-install': { ok: true },
    'copy-read': {
      ok: true,
      seen: true,
      text: '编号\t订单保存失败\t待处理\r\n',
      meta: rangeMeta(),
    },
    'copy-cleanup': { ok: true },
  };
};

it('固定脚本在唯一队列槽位完成 readiness、namebox 定位、原生插入、Enter、复制与严格范围校验', async () => {
  const host = new BrowserHost();
  const tabId = await openTab(host);
  reset();
  okFlow();

  const result = await host.invoke('wps-owner', 'plugin_read_wps_range', {
    tabId,
    address: 'A1:L201',
  });
  expect(result).toEqual({
    text: '编号\t订单保存失败\t待处理\r\n',
    range: { sheetId: '1', rowFrom: 0, rowTo: 200, colFrom: 0, colTo: 11 },
    sheet: '需求清单2026',
    url: WPS_URL,
    tabId,
  });
  expect(JSON.stringify(result)).not.toContain('must-not-leak');
  expect(mock.executed).toEqual(['ready', 'prepare', 'recheck', 'verify', 'sheet', 'sheet']);
  expect(mock.inserted).toEqual(['A1:L201']);
  expect(mock.cdp).toEqual(['copy-install', 'copy-read', 'copy-cleanup']);
  const modifier = process.platform === 'darwin' ? 'meta' : 'control';
  // 先用 readiness 验证过的中心点发原生指针点击（建立 RenderWidget 键盘焦点），
  // 再 Enter 提交范围、Meta/Control+C 复制；不抢 OS / 窗口焦点。
  expect(
    mock.sent
      .filter((event) => String(event.type).startsWith('mouse'))
      .map((event) => [event.type, event.x, event.y])
  ).toEqual([
    ['mouseMove', 100, 60],
    ['mouseDown', 100, 60],
    ['mouseUp', 100, 60],
  ]);
  expect(
    mock.sent
      .filter((event) => !String(event.type).startsWith('mouse'))
      .map((event) => [event.type, event.keyCode, ...(event.modifiers ?? [])])
  ).toEqual([
    ['keyDown', 'Enter'],
    ['keyUp', 'Enter'],
    ['keyDown', 'C', modifier],
    ['keyUp', 'C', modifier],
  ]);
});

it('画布未挂载时只读有界等待：loading 后 ready 继续，超时明确报错', async () => {
  const host = new BrowserHost();
  const tabId = await openTab(host, 'wps-wait');
  reset();
  okFlow();
  mock.responses.ready = [
    { ok: false, reason: 'loading' },
    { ok: true, x: 100, y: 60 },
  ];
  const result = await host.invoke('wps-wait', 'plugin_read_wps_range', {
    tabId,
    address: 'A1:L201',
  });
  expect(result).toMatchObject({ sheet: '需求清单2026' });
  expect(mock.executed.slice(0, 3)).toEqual(['ready', 'ready', 'prepare']);
  expect(mock.inserted).toEqual(['A1:L201']);

  reset();
  mock.responses = { ready: { ok: false, reason: 'loading' } };
  const now = vi.spyOn(Date, 'now');
  now.mockReturnValueOnce(0).mockReturnValue(20_000);
  try {
    await expect(
      host.invoke('wps-wait', 'plugin_read_wps_range', { tabId, address: 'A1:L201' })
    ).rejects.toThrow(/加载超时/);
  } finally {
    now.mockRestore();
  }
  expect(mock.executed).toEqual(['ready']);
  expect(mock.inserted).toEqual([]);
  expect(mock.sent).toEqual([]);
});

it('非金山/WPS 文档页与脏参数在动手前拒绝', async () => {
  const host = new BrowserHost();
  const elsewhere = 'browser:wps-guard';
  await host.navigate(elsewhere, 'https://example.com/');
  const otherTab = host.state(elsewhere).tabId;
  if (!otherTab) throw new Error('tab was not opened');
  reset();
  await expect(
    host.invoke(elsewhere, 'plugin_read_wps_range', { tabId: otherTab, address: 'A1:L201' })
  ).rejects.toThrow(/金山|WPS/);
  expect(mock.executed).toEqual([]);

  const tabId = await openTab(host, 'wps-params');
  reset();
  for (const params of [
    { tabId },
    { tabId, address: 'A1:M1' },
    { tabId, address: 'A1:L202' },
    { tabId, address: 'B2:A1' },
    { tabId, address: 'A1:B2:C3' },
    { tabId, address: 'A1', url: WPS_URL },
    { tabId, address: 'A1', selector: 'input.edit-box' },
  ])
    await expect(host.invoke('wps-params', 'plugin_read_wps_range', params)).rejects.toThrow();
  expect(mock.executed).toEqual([]);
  expect(mock.inserted).toEqual([]);
});

it('readiness 对编辑态/登录/遮挡明确失败，prepare 失败不重试、不插入', async () => {
  const host = new BrowserHost();
  const tabId = await openTab(host, 'wps-blocked');
  for (const [reason, pattern] of [
    ['editing', /编辑/],
    ['login', /登录/],
    ['covered', /提示|挡住/],
    ['hidden', /地址框/],
    ['missing', /地址框/],
  ] as const) {
    reset();
    mock.responses = { ready: { ok: false, reason } };
    await expect(
      host.invoke('wps-blocked', 'plugin_read_wps_range', { tabId, address: 'A1:L201' })
    ).rejects.toThrow(pattern);
    expect(mock.executed).toEqual(['ready']);
    expect(mock.inserted).toEqual([]);
    expect(mock.sent).toEqual([]);
  }

  for (const [reason, pattern] of [
    ['focus', /焦点/],
    ['selection', /地址框/],
  ] as const) {
    reset();
    mock.responses = { ready: { ok: true, x: 100, y: 60 }, prepare: { ok: false, reason } };
    await expect(
      host.invoke('wps-blocked', 'plugin_read_wps_range', { tabId, address: 'A1:L201' })
    ).rejects.toThrow(pattern);
    expect(mock.executed).toEqual(['ready', 'prepare']);
    expect(mock.inserted).toEqual([]);
    expect(mock.sent.every((event) => event.keyCode === undefined)).toBe(true);
  }
});

it('prepare 与原生输入之间焦点变化时 recheck 拦截，不向未知元素输入', async () => {
  const host = new BrowserHost();
  const tabId = await openTab(host, 'wps-recheck');
  for (const [reason, pattern] of [
    ['blurred', /焦点已变化|未输入/],
    ['selection', /选择已变化|未输入/],
    ['hidden', /不可见|未输入/],
    ['covered', /提示|挡住|未输入/],
  ] as const) {
    reset();
    mock.responses = {
      ready: { ok: true, x: 100, y: 60 },
      prepare: { ok: true },
      recheck: { ok: false, reason },
    };
    await expect(
      host.invoke('wps-recheck', 'plugin_read_wps_range', { tabId, address: 'A1:L201' })
    ).rejects.toThrow(pattern);
    expect(mock.executed).toEqual(['ready', 'prepare', 'recheck']);
    expect(mock.inserted).toEqual([]);
    expect(mock.sent.every((event) => event.keyCode === undefined)).toBe(true);
  }
});

it('输入后焦点离开或 value 不符时在 Enter 前停止，不提交业务格', async () => {
  const host = new BrowserHost();
  const tabId = await openTab(host, 'wps-verify');
  for (const [reason, pattern] of [
    ['blurred', /焦点|地址输入/],
    ['value', /地址输入/],
    ['covered', /提示|挡住/],
  ] as const) {
    reset();
    mock.responses = {
      ready: { ok: true, x: 100, y: 60 },
      prepare: { ok: true },
      recheck: { ok: true },
      verify: { ok: false, reason },
    };
    await expect(
      host.invoke('wps-verify', 'plugin_read_wps_range', { tabId, address: 'A1:L201' })
    ).rejects.toThrow(pattern);
    expect(mock.inserted).toEqual(['A1:L201']);
    expect(mock.sent.every((event) => event.keyCode === undefined)).toBe(true);
    expect(mock.cdp).toEqual([]);
  }
});

it('无法确认唯一高亮工作表时不复制；复制后工作表变化也拒绝', async () => {
  const host = new BrowserHost();
  const tabId = await openTab(host, 'wps-sheet');
  for (const sheet of [
    { ok: false, reason: 'sheet' },
    { ok: true, sheet: '' },
  ]) {
    reset();
    mock.responses = {
      ready: { ok: true, x: 100, y: 60 },
      prepare: { ok: true },
      recheck: { ok: true },
      verify: { ok: true },
      sheet,
    };
    await expect(
      host.invoke('wps-sheet', 'plugin_read_wps_range', { tabId, address: 'B2:C3' })
    ).rejects.toThrow(/工作表/);
    expect(mock.cdp).toEqual([]);
  }

  reset();
  okFlow();
  mock.responses.sheet = [
    { ok: true, sheet: '需求清单2026' },
    { ok: true, sheet: '另一张表' },
  ];
  await expect(
    host.invoke('wps-sheet', 'plugin_read_wps_range', { tabId, address: 'A1:L201' })
  ).rejects.toThrow(/工作表/);
  expect(mock.cdp).toEqual(['copy-install', 'copy-read', 'copy-cleanup']);
});

it('复制范围与请求地址不一致或缺少范围时拒绝', async () => {
  const host = new BrowserHost();
  const tabId = await openTab(host, 'wps-range');

  reset();
  okFlow();
  mock.responses['copy-read'] = {
    ok: true,
    seen: true,
    text: 'x',
    meta: rangeMeta(2, 2),
  };
  await expect(
    host.invoke('wps-range', 'plugin_read_wps_range', { tabId, address: 'A1:L201' })
  ).rejects.toThrow(/范围/);
  expect(mock.cdp).toEqual(['copy-install', 'copy-read', 'copy-cleanup']);

  reset();
  okFlow();
  mock.responses['copy-read'] = { ok: true, seen: true, text: 'x', meta: '' };
  await expect(
    host.invoke('wps-range', 'plugin_read_wps_range', { tabId, address: 'A1:L201' })
  ).rejects.toThrow(/范围/);
});

it('取消、guard 与中途 URL 变化都在输入或 Enter 前拦截', async () => {
  const host = new BrowserHost();
  const tabId = await openTab(host, 'wps-abort');
  reset();
  const before = new AbortController();
  before.abort();
  await expect(
    host.invoke('wps-abort', 'plugin_read_wps_range', { tabId, address: 'A1:L201' }, undefined, {
      signal: before.signal,
    })
  ).rejects.toThrow();
  expect(mock.executed).toEqual([]);

  reset();
  await expect(
    host.invoke('wps-abort', 'plugin_read_wps_range', { tabId, address: 'A1:L201' }, undefined, {
      guard: () => {
        throw new Error('document changed');
      },
    })
  ).rejects.toThrow('document changed');
  expect(mock.executed).toEqual([]);

  reset();
  okFlow();
  const during = new AbortController();
  mock.onExecute = (kind) => {
    if (kind === 'prepare') during.abort();
  };
  await expect(
    host.invoke('wps-abort', 'plugin_read_wps_range', { tabId, address: 'A1:L201' }, undefined, {
      signal: during.signal,
    })
  ).rejects.toThrow();
  expect(mock.executed).toEqual(['ready', 'prepare']);
  expect(mock.inserted).toEqual([]);
  expect(mock.sent.every((event) => event.keyCode === undefined)).toBe(true);

  // prepare 后、原生输入前页面跳走：先复查 URL，不向新页面输入
  reset();
  okFlow();
  mock.onExecute = (kind) => {
    if (kind === 'prepare') mock.url = 'https://example.com/evil';
  };
  await expect(
    host.invoke('wps-abort', 'plugin_read_wps_range', { tabId, address: 'A1:L201' })
  ).rejects.toThrow(/金山|WPS/);
  expect(mock.executed).toEqual(['ready', 'prepare']);
  expect(mock.inserted).toEqual([]);
  expect(mock.sent.every((event) => event.keyCode === undefined)).toBe(true);

  // verify 后、Enter 前页面跳走：复查 URL，不按 Enter
  reset();
  okFlow();
  mock.onExecute = (kind) => {
    if (kind === 'verify') mock.url = 'https://example.com/evil';
  };
  await expect(
    host.invoke('wps-abort', 'plugin_read_wps_range', { tabId, address: 'A1:L201' })
  ).rejects.toThrow(/金山|WPS/);
  expect(mock.inserted).toEqual(['A1:L201']);
  expect(mock.sent.some((event) => event.keyCode === 'Enter')).toBe(false);
});

it('跨会话与未知 tab 被拒绝，不执行 DOM 脚本', async () => {
  const host = new BrowserHost();
  const tabId = await openTab(host, 'wps-owner2');
  reset();
  await expect(
    host.invoke('someone-else', 'plugin_read_wps_range', { tabId, address: 'A1:L201' })
  ).rejects.toThrow(/owner/i);
  await expect(
    host.invoke('wps-owner2', 'plugin_read_wps_range', {
      tabId: 'browser:404',
      address: 'A1:L201',
    })
  ).rejects.toThrow();
  expect(mock.executed).toEqual([]);
});
