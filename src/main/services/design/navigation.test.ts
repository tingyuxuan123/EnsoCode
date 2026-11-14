import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import {
  type DesignNavigationEvent,
  installDesignNavigationGuard,
  shouldBlockDesignNavigation,
} from './navigation';

it('插件重载的销毁frame不让设计守卫抛错（无法核验时不冒泡，交回原生导航）', () => {
  const handlers: ((event: DesignNavigationEvent) => void)[] = [];
  installDesignNavigationGuard(
    {
      mainFrame: { url: 'file:///app/index.html', name: '', parent: null },
      getURL: () => 'file:///app/index.html',
      on: (_name, fn) => handlers.push(fn),
    },
    () => new Set([3210])
  );
  const preventDefault = vi.fn();
  const event = {
    isMainFrame: false,
    url: 'about:blank',
    preventDefault,
    get frame(): never {
      throw new Error('Render frame was disposed');
    },
  };
  expect(() => handlers[0](event)).not.toThrow();
  expect(preventDefault).not.toHaveBeenCalled();
});
it('没有设计引擎帧时不挂导航监听，只有出现引擎端口后才安装', async () => {
  const ports = new Set<number>();
  const listeners: string[] = [];
  vi.useFakeTimers();
  try {
    installDesignNavigationGuard(
      {
        mainFrame: { url: 'file:///app/index.html', name: '', parent: null },
        getURL: () => 'file:///app/index.html',
        on: (name) => listeners.push(`on:${name}`),
        off: (name) => listeners.push(`off:${name}`),
      },
      () => ports
    );
    expect(listeners).toEqual([]);
    ports.add(3210);
    vi.advanceTimersByTime(1100);
    expect(listeners).toEqual(['on:will-frame-navigate', 'on:will-redirect']);
    ports.clear();
    vi.advanceTimersByTime(1100);
    expect(listeners.slice(-2)).toEqual(['off:will-frame-navigate', 'off:will-redirect']);
  } finally {
    vi.useRealTimers();
  }
});

it('真实主入口 frame-src 只保留插件 shell 同源和 IPv4 回环，不允许 data/blob/外网', () => {
  const html = readFileSync(new URL('../../../renderer/index.html', import.meta.url), 'utf8');
  const policy = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/)?.[1];
  expect(
    policy
      ?.split(';')
      .map((part) => part.trim())
      .filter((part) => part.startsWith('frame-src'))
  ).toEqual(["frame-src 'self' http://127.0.0.1:*"]);
});

it('真实主入口 img-src 允许本页创建的 blob:（设计截图卡）与市场图标源，不放开其他外网', () => {
  const html = readFileSync(new URL('../../../renderer/index.html', import.meta.url), 'utf8');
  const policy = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/)?.[1];
  expect(
    policy
      ?.split(';')
      .map((part) => part.trim())
      .filter((part) => part.startsWith('img-src'))
  ).toEqual(["img-src 'self' data: blob: local-image: https://enso-plugins.j3.do"]);
});

it('子 frame 仅允许已登记的精确 loopback origin，主 frame 不参与', () => {
  const input = { isMainFrame: false, ports: new Set([3210, 3211]) };
  expect(shouldBlockDesignNavigation({ ...input, url: 'http://127.0.0.1:3210/a?q=x#b' })).toBe(
    false
  );
  for (const url of [
    'http://127.0.0.1:9999',
    'http://localhost:3210',
    'http://127.0.0.2:3210',
    'https://127.0.0.1:3210',
    'http://127.0.0.1:3210@evil.example',
    'file:///etc/passwd',
    'data:text/html,hi',
    'about:srcdoc',
    'invalid',
  ])
    expect(shouldBlockDesignNavigation({ ...input, url })).toBe(true);
  // The workbench parent is trusted; blank resets and self-navigation (inherited origin) are safe.
  expect(shouldBlockDesignNavigation({ ...input, url: 'about:blank' })).toBe(false);
  expect(
    shouldBlockDesignNavigation({ ...input, url: 'file:///app/index.html', isMainFrame: true })
  ).toBe(false);
  expect(
    shouldBlockDesignNavigation({
      ...input,
      url: 'http://127.0.0.1:3211',
      origin: 'http://127.0.0.1:3210',
    })
  ).toBe(true);
});

it('导航和重定向绑定首个引擎源；初始化 blank 可用，插件守卫保持原策略', () => {
  const handlers = new Map<string, (event: DesignNavigationEvent) => void>();
  const mainFrame = { url: 'file:///app/index.html', name: '', parent: null };
  const frame = { url: 'about:blank', name: '', parent: mainFrame };
  const ports = new Set([3210, 3211]);
  installDesignNavigationGuard(
    { mainFrame, getURL: () => mainFrame.url, on: (name, fn) => handlers.set(name, fn) },
    () => ports
  );
  const navigate = (
    name: string,
    url: string,
    target: DesignNavigationEvent['frame'] = frame,
    isMainFrame = false
  ) => {
    const preventDefault = vi.fn();
    handlers.get(name)!({ frame: target, isMainFrame, url, preventDefault });
    return preventDefault.mock.calls.length > 0;
  };
  expect(navigate('will-frame-navigate', 'about:blank')).toBe(false);
  expect(navigate('will-frame-navigate', 'http://127.0.0.1:3210/a')).toBe(false);
  frame.url = 'http://127.0.0.1:3210/a';
  for (const name of ['will-frame-navigate', 'will-redirect']) {
    expect(navigate(name, 'http://127.0.0.1:3210/b')).toBe(false);
    for (const url of ['http://127.0.0.1:3211', 'https://evil.example', 'file:///app/index.html'])
      expect(navigate(name, url)).toBe(true);
    expect(navigate(name, 'about:blank')).toBe(false);
    expect(navigate(name, 'https://example.com', mainFrame, true)).toBe(false);
    const plugin = {
      url: 'file:///app/plugin-view.html#nonce',
      name: 'enso-plugin-view',
      parent: mainFrame,
    };
    expect(navigate(name, 'https://evil.example', plugin)).toBe(false);
    expect(navigate(name, 'about:blank', { url: 'about:blank', name: '', parent: plugin })).toBe(
      false
    );
  }
  ports.clear();
  expect(navigate('will-frame-navigate', 'http://127.0.0.1:3210/a')).toBe(true);
});
