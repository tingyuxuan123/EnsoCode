import { describe, expect, it, vi } from 'vitest';
import {
  installPluginViewNavigationGuard,
  type PluginNavigationEvent,
  shouldBlockPluginViewNavigation,
} from './viewNavigation';

it('热重载销毁frame后，getter抛错不冒泡；无法判定祖先时放行交给sandbox/CSP', () => {
  const handlers: ((event: PluginNavigationEvent) => void)[] = [];
  installPluginViewNavigationGuard({
    mainFrame: { url: 'file:///app/index.html', name: '', parent: null },
    getURL: () => 'file:///app/index.html',
    on: (_name, fn) => handlers.push(fn),
  });
  const preventDefault = vi.fn();
  const event = {
    isMainFrame: false,
    url: 'https://external.example',
    preventDefault,
    get frame(): never {
      throw new Error('Render frame was disposed');
    },
  };
  expect(() => handlers[0](event)).not.toThrow();
  expect(preventDefault).not.toHaveBeenCalled();
});
it('祖先包装器循环时遍历有界，仍按已识别插件帧拦截外站导航', () => {
  const handlers: ((event: PluginNavigationEvent) => void)[] = [];
  let hops = 0;
  const cyclic: NonNullable<PluginNavigationEvent['frame']> = {
    url: 'file:///app/plugin-view.html',
    name: 'enso-plugin-view',
    get parent(): NonNullable<PluginNavigationEvent['frame']> {
      if (++hops > 64) throw new Error('cycle');
      return cyclic;
    },
  };
  installPluginViewNavigationGuard({
    mainFrame: { url: 'file:///app/index.html', name: '', parent: null },
    getURL: () => 'file:///app/index.html',
    on: (_name, fn) => handlers.push(fn),
  });
  const preventDefault = vi.fn();
  handlers[0]({
    frame: cyclic,
    isMainFrame: false,
    url: 'https://external.example',
    preventDefault,
  });
  expect(hops).toBeLessThanOrEqual(32);
  expect(preventDefault).toHaveBeenCalledOnce();
});

it('接线逐级识别插件祖先，导航及重定向均拦截且不误伤其他 frame', () => {
  const handlers = new Map<string, (event: PluginNavigationEvent) => void>();
  const mainFrame = { url: 'file:///app/index.html', name: '', parent: null };
  const plugin = { url: 'file:///app/plugin-view.html#nonce', name: '', parent: mainFrame };
  installPluginViewNavigationGuard({
    mainFrame,
    getURL: () => mainFrame.url,
    on: (name, handler) => {
      handlers.set(name, handler);
    },
  });
  for (const name of ['will-frame-navigate', 'will-redirect']) {
    const handler = handlers.get(name)!;
    for (const [frame, isMainFrame, blocked] of [
      [{ url: 'about:blank', name: '', parent: plugin }, false, true],
      [mainFrame, true, false],
      [{ url: 'https://preview.example', name: '', parent: mainFrame }, false, false],
    ] as const) {
      const preventDefault = vi.fn();
      handler({ frame, isMainFrame, url: 'https://external.example', preventDefault });
      expect(preventDefault.mock.calls.length).toBe(blocked ? 1 : 0);
    }
  }
});

describe('插件侧栏导航边界', () => {
  for (const mainUrl of ['file:///app/renderer/index.html', 'http://localhost:5173/index.html']) {
    const viewUrl = new URL('plugin-view.html', mainUrl).href;
    const input = { mainUrl, isMainFrame: false, frameUrls: [`${viewUrl}#nonce`] };
    it(`只允许插件自身页面：${mainUrl}`, () => {
      expect(shouldBlockPluginViewNavigation({ ...input, url: `${viewUrl}#other` })).toBe(false);
      for (const url of [
        'https://evil.example',
        'data:text/html,hi',
        'file:///etc/passwd',
        `${viewUrl}?other`,
        viewUrl.replace('plugin-view', 'index'),
      ])
        expect(shouldBlockPluginViewNavigation({ ...input, url })).toBe(true);
      expect(shouldBlockPluginViewNavigation({ ...input, url: 'about:blank' })).toBe(false);
    });
    it('不误伤主窗口与工作区预览，插件后代仍受约束', () => {
      expect(
        shouldBlockPluginViewNavigation({ ...input, isMainFrame: true, url: 'https://example.com' })
      ).toBe(false);
      expect(
        shouldBlockPluginViewNavigation({
          ...input,
          frameUrls: ['http://localhost:3000'],
          url: 'http://localhost:3000/a',
        })
      ).toBe(false);
      expect(
        shouldBlockPluginViewNavigation({
          ...input,
          frameUrls: ['about:blank', viewUrl],
          url: 'https://example.com',
        })
      ).toBe(true);
      expect(
        shouldBlockPluginViewNavigation({
          ...input,
          frameUrls: ['about:blank'],
          frameName: 'enso-plugin-view',
          url: 'https://example.com',
        })
      ).toBe(true);
    });
  }
});
