import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  dir: '',
  contents: [] as MockContents[],
  exec: async (_script: string): Promise<unknown> => 'ok',
  commands: [] as { method: string; params: unknown }[],
}));
class MockContents extends EventEmitter {
  id = mock.contents.length + 1;
  url = '';
  destroyed = false;
  inputs: unknown[] = [];
  navigationHistory = { canGoBack: () => false, canGoForward: () => false, clear() {} };
  debugger = {
    isAttached: () => true,
    attach() {},
    detach() {},
    on() {},
    sendCommand: async (method: string, params: unknown) => {
      mock.commands.push({ method, params });
      return method === 'Page.captureScreenshot' ? { data: 'image' } : {};
    },
  };
  setWindowOpenHandler() {}
  setDevToolsWebContents() {}
  openDevTools() {}
  getURL() {
    return this.url;
  }
  getUserAgent() {
    return 'MockAgent/1.0';
  }
  getTitle() {
    return 'Page';
  }
  isLoading() {
    return false;
  }
  isDestroyed() {
    return this.destroyed;
  }
  isDevToolsOpened() {
    return false;
  }
  executeJavaScript(script: string) {
    return mock.exec(script);
  }
  async loadURL(url: string) {
    this.url = url;
    this.emit('dom-ready');
    this.emit('did-navigate');
  }
  sendInputEvent(input: unknown) {
    this.inputs.push(input);
    this.emit('input-event', {}, input);
  }
  async insertText(text: string) {
    this.inputs.push(text);
  }
  stop() {}
  reload() {
    this.emit('did-navigate');
  }
  close() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.emit('destroyed');
  }
}
vi.mock('../windows/createAppWindow', () => ({ getWorkbenchView: () => null }));
vi.mock('./proxyConfig', () => ({ getProxyConfig: () => ({ attachSession() {} }) }));
vi.mock('electron', () => ({
  app: { getPath: () => mock.dir, isPackaged: false },
  session: {
    fromPartition: () => ({
      on() {},
      setPermissionRequestHandler() {},
      setPermissionCheckHandler() {},
      webRequest: { onBeforeRequest() {} },
      cookies: { flushStore: async () => {} },
      flushStorageData: async () => {},
    }),
  },
  WebContentsView: class {
    webContents = new MockContents();
    constructor() {
      mock.contents.push(this.webContents);
    }
    setBackgroundColor() {}
    setVisible() {}
    setBounds() {}
    getBounds() {
      return { x: 0, y: 0, width: 1280, height: 800 };
    }
  },
}));

import { BrowserHost } from './browserHost';

mock.dir = mkdtempSync(join(tmpdir(), 'browser-capabilities-'));
afterAll(() => rmSync(mock.dir, { recursive: true, force: true }));
afterEach(() => vi.useRealTimers());
beforeEach(() => {
  mock.contents.length = 0;
  mock.commands.length = 0;
  mock.exec = async () => 'ok';
});
const open = async () => {
  const host = new BrowserHost();
  await host.navigate('conv', 'https://example.test');
  const tabId = host.state('conv').tabId;
  if (!tabId) throw new Error('No tab');
  return { host, tabId, contents: mock.contents[0] };
};

it('指定 tab 仍校验归属，用户操作后普通会话及 raw CDP 无需重新授权', async () => {
  const { host, tabId, contents } = await open();
  await expect(
    host.invoke('other', 'cdp', { tabId, method: 'Runtime.evaluate', params: {} })
  ).rejects.toThrow(/owner|belong/);
  contents.emit('input-event', {}, { type: 'mouseDown' });
  expect(
    await host.invoke('conv', 'cdp', { tabId, method: 'Runtime.evaluate', params: {} })
  ).toEqual({});
  await host.dispose();
});
it('用户点击可协助在途等待完成，排队操作仍可继续', async () => {
  const { host, tabId, contents } = await open();
  let started!: () => void;
  const waiting = new Promise<void>((resolve) => {
    started = resolve;
  });
  let complete!: (value: boolean) => void;
  const result = new Promise<boolean>((resolve) => {
    complete = resolve;
  });
  mock.exec = async () => {
    started();
    return result;
  };
  const wait = host.invoke('conv', 'wait', {
    tabId,
    kind: 'text',
    text: 'not here',
    timeoutMs: 5000,
  });
  const queued = host.invoke('conv', 'press_key', { tabId, key: 'Enter' });
  const completed = Promise.all([
    expect(wait).resolves.toMatchObject({ matched: true }),
    expect(queued).resolves.toMatchObject({ url: 'https://example.test/' }),
  ]);
  await waiting;
  contents.emit('input-event', {}, { type: 'mouseDown' });
  complete(true);
  await completed;
  expect(contents.inputs).toContainEqual(expect.objectContaining({ keyCode: 'Enter' }));
  await host.dispose();
});
it('Agent 原生输入不误判人工操作；人工操作使旧引用失效，新快照可继续', async () => {
  const { host, tabId, contents } = await open();
  mock.exec = async (script) => {
    const snapshotId = /const snapshotId = "([^"]+)"/.exec(script)?.[1] ?? 'x';
    return {
      text: 'Save',
      entries: [{ role: 'button', name: 'Save', depth: 0, ref: `e${snapshotId}_1`, kind: 'click' }],
      diagnostics: [],
      truncated: false,
    };
  };
  const first = (await host.invoke('conv', 'read_elements', { tabId })) as {
    entries: { ref: string }[];
  };
  await host.invoke('conv', 'press_key', { tabId, key: 'Control+A' });
  expect(contents.inputs).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ type: 'keyDown', keyCode: 'A', modifiers: ['control'] }),
    ])
  );
  contents.emit('input-event', {}, { type: 'mouseDown' });
  await expect(host.invoke('conv', 'click', { tabId, ref: first.entries[0].ref })).rejects.toThrow(
    /stale/
  );
  const next = (await host.invoke('conv', 'read_elements', { tabId })) as {
    entries: { ref: string }[];
  };
  expect(next.entries[0].ref).not.toBe(first.entries[0].ref);
  mock.exec = async () => ({ x: 20, y: 30 });
  await expect(host.invoke('conv', 'click', { tabId, ref: next.entries[0].ref })).resolves.toEqual({
    url: 'https://example.test/',
    title: 'Page',
  });
  await host.dispose();
});
it('Agent 清空输入触发 SPA replaceState 后仍能继续填入文字', async () => {
  const { host, tabId, contents } = await open();
  mock.exec = async (script) => {
    const snapshotId = /const snapshotId = "([^"]+)"/.exec(script)?.[1] ?? 'x';
    return {
      text: 'Search',
      entries: [
        { role: 'textbox', name: 'Search', depth: 0, ref: `e${snapshotId}_1`, kind: 'fill' },
      ],
      diagnostics: [],
      truncated: false,
    };
  };
  const snapshot = (await host.invoke('conv', 'read_elements', { tabId })) as {
    entries: { ref: string }[];
  };
  mock.exec = async () => ({ x: 20, y: 30 });
  const send = contents.sendInputEvent.bind(contents);
  contents.sendInputEvent = (input: unknown) => {
    send(input);
    if ((input as { keyCode?: string }).keyCode === 'Backspace') {
      contents.url = 'https://example.test/?q=';
      contents.emit('did-navigate-in-page', {}, contents.url, true);
    }
  };

  await expect(
    host.invoke('conv', 'fill', { tabId, ref: snapshot.entries[0].ref, value: 'new query' })
  ).resolves.toMatchObject({ url: 'https://example.test/?q=' });
  expect(contents.inputs).toContain('new query');
  await host.dispose();
});
it('Agent 滚动触发 hash 更新仅推送 URL，不让已有引用失效', async () => {
  const { host, tabId, contents } = await open();
  mock.exec = async (script) => {
    const snapshotId = /const snapshotId = "([^"]+)"/.exec(script)?.[1] ?? 'x';
    return {
      text: 'Save',
      entries: [{ role: 'button', name: 'Save', depth: 0, ref: `e${snapshotId}_1`, kind: 'click' }],
      diagnostics: [],
      truncated: false,
    };
  };
  const snapshot = (await host.invoke('conv', 'read_elements', { tabId })) as {
    entries: { ref: string }[];
  };
  const urls: string[] = [];
  host.onState((_session, _id, state) => urls.push(state.url));
  mock.exec = async () => {
    contents.url = 'https://example.test/#section';
    contents.emit('did-navigate-in-page', {}, contents.url, true);
    return 'ok';
  };
  await host.invoke('conv', 'scroll', { tabId, direction: 'down' });
  expect(urls).toContain('https://example.test/#section');
  mock.exec = async () => ({ x: 20, y: 30 });
  await expect(
    host.invoke('conv', 'click', { tabId, ref: snapshot.entries[0].ref })
  ).resolves.toMatchObject({ url: 'https://example.test/#section' });
  await host.dispose();
});
it('真实键盘输入不永久暂停成员 Agent，也不影响其他成员的 tab 占用协调', async () => {
  const { host, tabId, contents } = await open();
  const alice = { sessionId: 'alice', name: 'Alice' };
  await host.invoke('conv', 'cdp', { tabId, method: 'Runtime.evaluate' }, alice);
  contents.emit('input-event', {}, { type: 'rawKeyDown' });
  await expect(
    host.invoke('conv', 'press_key', { tabId, key: 'Enter' }, alice)
  ).resolves.toBeDefined();
  await expect(
    host.invoke(
      'conv',
      'cdp',
      { tabId, method: 'Runtime.evaluate' },
      { sessionId: 'bob', name: 'Bob' }
    )
  ).rejects.toThrow(/Alice is using/);
  await host.userNavigate(tabId, 'conv', 'https://example.test/next');
  host.reload(tabId);
  host.stop(tabId);
  await expect(
    host.invoke('conv', 'press_key', { tabId, key: 'Tab' }, alice)
  ).resolves.toBeDefined();
  expect(host.state(tabId).holder?.name).toBe('Alice');
  await host.dispose();
});
it('读取生成快照代际，新读使旧 ref 和游标失效', async () => {
  const { host, tabId } = await open();
  mock.exec = async (script) => {
    const snapshotId = /const snapshotId = "([^"]+)"/.exec(script)?.[1] ?? 'x';
    return {
      text: 'abcdef',
      entries: [{ role: 'button', name: 'Save', depth: 0, ref: `e${snapshotId}_1`, kind: 'click' }],
      diagnostics: [],
      truncated: false,
    };
  };
  const first = (await host.invoke('conv', 'read_elements', { tabId })) as {
    entries: { ref: string }[];
  };
  await host.invoke('conv', 'read_text', { tabId });
  await expect(host.invoke('conv', 'click', { tabId, ref: first.entries[0].ref })).rejects.toThrow(
    /stale/
  );
  await host.dispose();
});
it.each(['read_elements', 'snapshot'] as const)(
  '人工操作期间迟到的 %s 不重新发布失效引用',
  async (op) => {
    const { host, tabId, contents } = await open();
    let started!: () => void;
    const waiting = new Promise<void>((resolve) => {
      started = resolve;
    });
    let complete!: (value: unknown) => void;
    const result = new Promise<unknown>((resolve) => {
      complete = resolve;
    });
    mock.exec = async () => {
      started();
      return result;
    };
    const reading = host.invoke('conv', op, { tabId });
    const rejected = expect(reading).rejects.toThrow(/page changed|refresh/i);
    await waiting;
    contents.emit('input-event', {}, { type: 'mouseDown' });
    complete(op === 'snapshot' ? [] : { text: '', entries: [], diagnostics: [], truncated: false });
    await rejected;
    mock.exec = async () => ({
      text: 'Current page',
      entries: [],
      diagnostics: [],
      truncated: false,
    });
    await expect(host.invoke('conv', 'read_text', { tabId })).resolves.toMatchObject({
      text: 'Current page',
    });
    await host.dispose();
  }
);
it('协作模式仍支持显式取消等待，取消后下次工具可正常执行', async () => {
  const { host, tabId } = await open();
  const controller = new AbortController();
  mock.exec = async () => false;
  const waiting = host.invoke(
    'conv',
    'wait',
    { tabId, kind: 'text', text: 'not yet', timeoutMs: 5000 },
    undefined,
    { signal: controller.signal }
  );
  const rejected = expect(waiting).rejects.toThrow(/abort/i);
  controller.abort();
  await rejected;
  await expect(host.invoke('conv', 'cdp', { tabId, method: 'Runtime.evaluate' })).resolves.toEqual(
    {}
  );
  await host.dispose();
});
it('取消中的迟到点击不得穿透到下一次操作，也不得提前释放 tab 队列', async () => {
  const { host, tabId, contents } = await open();
  mock.exec = async (script) => {
    const snapshotId = /const snapshotId = "([^"]+)"/.exec(script)?.[1] ?? 'x';
    return {
      text: 'Save',
      entries: [{ role: 'button', name: 'Save', depth: 0, ref: `e${snapshotId}_1`, kind: 'click' }],
      diagnostics: [],
      truncated: false,
    };
  };
  const first = (await host.invoke('conv', 'read_elements', { tabId })) as {
    entries: { ref: string }[];
  };
  let started!: () => void;
  const preparing = new Promise<void>((resolve) => {
    started = resolve;
  });
  let complete!: (value: unknown) => void;
  const point = new Promise<unknown>((resolve) => {
    complete = resolve;
  });
  mock.exec = async () => {
    started();
    return point;
  };
  const controller = new AbortController();
  const click = host.invoke('conv', 'click', { tabId, ref: first.entries[0].ref }, undefined, {
    signal: controller.signal,
  });
  const rejected = expect(click).rejects.toThrow(/abort/i);
  await preparing;
  controller.abort();
  await rejected;
  let nextFinished = false;
  const next = host.invoke('conv', 'cdp', { tabId, method: 'Runtime.evaluate' }).then(() => {
    nextFinished = true;
  });
  await Promise.resolve();
  await Promise.resolve();
  expect(nextFinished).toBe(false);
  complete({ x: 20, y: 30 });
  await next;
  expect(contents.inputs).toHaveLength(0);
  await host.dispose();
});
it('永不 settle 的操作取消后在 grace 内保留队列，超时关闭 tab 并回收排队调用', async () => {
  const { host, tabId, contents } = await open();
  vi.useFakeTimers();
  let started!: () => void;
  const preparing = new Promise<void>((resolve) => {
    started = resolve;
  });
  mock.exec = async () => {
    started();
    return new Promise<never>(() => {});
  };
  const controller = new AbortController();
  const waiting = host.invoke('conv', 'wait', { tabId, kind: 'text', text: 'never' }, undefined, {
    signal: controller.signal,
  });
  const rejected = expect(waiting).rejects.toThrow(/abort/i);
  await preparing;
  let queuedError: unknown;
  const queued = host.invoke('conv', 'press_key', { tabId, key: 'Enter' }).catch((error) => {
    queuedError = error;
  });
  controller.abort();
  await rejected;
  await vi.advanceTimersByTimeAsync(1999);
  expect(contents.isDestroyed()).toBe(false);
  expect(queuedError).toBeUndefined();

  await vi.advanceTimersByTimeAsync(1);
  expect(contents.isDestroyed()).toBe(true);
  expect(queuedError).toBeInstanceOf(Error);
  expect(String(queuedError)).toMatch(/closed/i);
  await queued;
  expect(contents.inputs).toHaveLength(0);
  await expect(
    host.invoke('conv', 'navigate', { url: 'https://example.test/recovered' })
  ).resolves.toBeDefined();
  await host.dispose();
});
it('排队 caller 的取消立即拒绝，不必等待占用 tab 的底层操作退出', async () => {
  const { host, tabId, contents } = await open();
  vi.useFakeTimers();
  let started!: () => void;
  const preparing = new Promise<void>((resolve) => {
    started = resolve;
  });
  let complete!: (value: boolean) => void;
  const result = new Promise<boolean>((resolve) => {
    complete = resolve;
  });
  mock.exec = async () => {
    started();
    return result;
  };
  const waiting = host.invoke('conv', 'wait', { tabId, kind: 'text', text: 'ready' });
  await preparing;
  const controller = new AbortController();
  let queuedError: unknown;
  const queued = host
    .invoke('conv', 'press_key', { tabId, key: 'Enter' }, undefined, { signal: controller.signal })
    .catch((error) => {
      queuedError = error;
    });
  controller.abort();
  await vi.advanceTimersByTimeAsync(0);
  expect(queuedError).toBeInstanceOf(Error);
  expect(String(queuedError)).toMatch(/abort/i);
  complete(true);
  await Promise.all([waiting, queued]);
  expect(contents.inputs).toHaveLength(0);
  await host.dispose();
});
it('grace 内底层操作已退出则清掉回收计时器，不关闭仍可协作的 tab', async () => {
  const { host, tabId, contents } = await open();
  vi.useFakeTimers();
  let started!: () => void;
  const preparing = new Promise<void>((resolve) => {
    started = resolve;
  });
  let complete!: (value: boolean) => void;
  const result = new Promise<boolean>((resolve) => {
    complete = resolve;
  });
  mock.exec = async () => {
    started();
    return result;
  };
  const controller = new AbortController();
  const waiting = host.invoke('conv', 'wait', { tabId, kind: 'text', text: 'ready' }, undefined, {
    signal: controller.signal,
  });
  const rejected = expect(waiting).rejects.toThrow(/abort/i);
  await preparing;
  controller.abort();
  await rejected;
  complete(true);
  await expect(host.invoke('conv', 'cdp', { tabId, method: 'Runtime.evaluate' })).resolves.toEqual(
    {}
  );
  await vi.advanceTimersByTimeAsync(2000);
  expect(contents.isDestroyed()).toBe(false);
  await host.dispose();
});
it('取消的旧 tab 在 grace 内被关闭并同 id 重建时，超时不误关新 tab', async () => {
  const { host, tabId } = await open();
  vi.useFakeTimers();
  let started!: () => void;
  const preparing = new Promise<void>((resolve) => {
    started = resolve;
  });
  mock.exec = async () => {
    started();
    return new Promise<never>(() => {});
  };
  const controller = new AbortController();
  const waiting = host.invoke('conv', 'wait', { tabId, kind: 'text', text: 'never' }, undefined, {
    signal: controller.signal,
  });
  const rejected = expect(waiting).rejects.toThrow(/abort/i);
  await preparing;
  controller.abort();
  await rejected;
  await host.closeTab(tabId);
  mock.exec = async () => 'ok';
  await host.userNavigate(tabId, 'conv', 'https://example.test/reopened');

  await vi.advanceTimersByTimeAsync(2000);

  expect(mock.contents[1].isDestroyed()).toBe(false);
  await expect(host.invoke('conv', 'cdp', { tabId, method: 'Runtime.evaluate' })).resolves.toEqual(
    {}
  );
  await host.dispose();
});
it('grace 超时关闭 tab 后，迟到点击结果也不能向恢复后的 tab 发送原生输入', async () => {
  const { host, tabId, contents } = await open();
  mock.exec = async (script) => {
    const snapshotId = /const snapshotId = "([^"]+)"/.exec(script)?.[1] ?? 'x';
    return {
      text: 'Save',
      entries: [{ role: 'button', name: 'Save', depth: 0, ref: `e${snapshotId}_1`, kind: 'click' }],
      diagnostics: [],
      truncated: false,
    };
  };
  const snapshot = (await host.invoke('conv', 'read_elements', { tabId })) as {
    entries: { ref: string }[];
  };
  vi.useFakeTimers();
  let started!: () => void;
  const preparing = new Promise<void>((resolve) => {
    started = resolve;
  });
  let complete!: (point: unknown) => void;
  const point = new Promise<unknown>((resolve) => {
    complete = resolve;
  });
  mock.exec = async () => {
    started();
    return point;
  };
  const controller = new AbortController();
  const click = host.invoke('conv', 'click', { tabId, ref: snapshot.entries[0].ref }, undefined, {
    signal: controller.signal,
  });
  const rejected = expect(click).rejects.toThrow(/abort/i);
  await preparing;
  controller.abort();
  await rejected;
  await vi.advanceTimersByTimeAsync(2000);
  expect(contents.isDestroyed()).toBe(true);
  mock.exec = async () => 'ok';
  await host.invoke('conv', 'navigate', { url: 'https://example.test/recovered' });
  complete({ x: 20, y: 30 });
  await vi.advanceTimersByTimeAsync(100);
  expect(contents.inputs).toHaveLength(0);
  expect(mock.contents[1].inputs).toHaveLength(0);
  await host.dispose();
});
it.each(['destroyed', 'throwing'] as const)(
  '导航取消遇到 %s webContents 仍拒绝调用且不抛 Main 未捕获异常',
  async (mode) => {
    const { host, tabId, contents } = await open();
    let started!: () => void;
    const navigating = new Promise<void>((resolve) => {
      started = resolve;
    });
    let complete!: () => void;
    const loaded = new Promise<void>((resolve) => {
      complete = resolve;
    });
    contents.loadURL = async () => {
      started();
      return loaded;
    };
    const stop = vi.fn(() => {
      throw new Error('webContents already destroyed');
    });
    contents.stop = stop;
    const controller = new AbortController();
    const navigation = host.invoke(
      'conv',
      'navigate',
      { tabId, url: 'https://example.test/next' },
      undefined,
      {
        signal: controller.signal,
      }
    );
    const rejected = expect(navigation).rejects.toThrow(/abort/i);
    await navigating;
    if (mode === 'destroyed') contents.close();
    controller.abort();
    await rejected;
    expect(stop).toHaveBeenCalledTimes(mode === 'destroyed' ? 0 : 1);
    complete();
    await host.dispose();
  }
);
it('取消拖拽会释放已经按下的鼠标，不影响后续协作操作', async () => {
  const { host, tabId, contents } = await open();
  mock.exec = async () => ({ from: { x: 10, y: 20 }, to: { x: 100, y: 200 } });
  const controller = new AbortController();
  const send = contents.sendInputEvent.bind(contents);
  contents.sendInputEvent = (input: unknown) => {
    send(input);
    if ((input as { type: string }).type === 'mouseDown') controller.abort();
  };
  await expect(
    host.invoke('conv', 'drag', { tabId, fromX: 10, fromY: 20, toX: 100, toY: 200 }, undefined, {
      signal: controller.signal,
    })
  ).rejects.toThrow(/abort/i);
  await vi.waitFor(() =>
    expect(contents.inputs).toContainEqual(
      expect.objectContaining({ type: 'mouseUp', button: 'left' })
    )
  );
  await host.dispose();
});
it('DevTools 占用 CDP 时拒绝改设备模拟，但仍允许关闭设备预览', async () => {
  const { host, tabId } = await open();
  await host.setDevice(tabId, 'conv', { enabled: true, width: 393, height: 852 });
  host.setDevTools(tabId, true);
  await expect(
    host.setDevice(tabId, 'conv', { enabled: true, width: 440, height: 956 })
  ).rejects.toThrow(/DevTools/);
  expect(host.state(tabId).device).toMatchObject({ width: 393, height: 852 });
  await expect(host.setDevice(tabId, 'conv', { enabled: false })).resolves.toMatchObject({
    device: { enabled: false },
  });
  await host.dispose();
});
it('关闭走统一路径，不在搜索或持久恢复清单留下已关闭标签', async () => {
  const { host, tabId } = await open();
  await host.invoke('conv', 'close', { tabId });
  expect(host.listSearchableTabs().some((entry) => entry.tabId === tabId)).toBe(false);
  await host.dispose();
});
it('invoke 无 tabId 的 release 释放本会话全部保留标记，显式 tabId 只释放目标', async () => {
  const { host, tabId: first } = await open();
  await host.invoke('conv', 'lock', { tabId: first });
  await host.invoke('conv', 'navigate', { url: 'https://example.test/second', newTab: true });
  const second = host.state('conv').tabId;
  if (!second) throw new Error('No second tab');
  await host.invoke('conv', 'lock', { tabId: second });
  await host.navigate('other', 'https://example.test/other');
  const other = host.state('other').tabId;
  if (!other) throw new Error('No other tab');
  await host.invoke('other', 'lock', { tabId: other });

  expect(await host.invoke('conv', 'lock', { tabId: first, release: true })).toEqual({
    locked: false,
  });
  expect(host.state(first).locked).toBe(false);
  expect(host.state(second).locked).toBe(true);
  await host.invoke('conv', 'lock', { tabId: first });
  expect(await host.invoke('conv', 'lock', { release: true })).toEqual({ locked: false });
  expect(host.state(first).locked).toBe(false);
  expect(host.state(second).locked).toBe(false);
  expect(host.state(other).locked).toBe(true);
  await host.dispose();
});
