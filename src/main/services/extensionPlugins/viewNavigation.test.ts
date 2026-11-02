import { describe, expect, it, vi } from 'vitest';
import {
  installPluginViewNavigationGuard,
  type PluginNavigationEvent,
  shouldBlockPluginViewNavigation,
} from './viewNavigation';

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
        'about:blank',
        'data:text/html,hi',
        'file:///etc/passwd',
        `${viewUrl}?other`,
        viewUrl.replace('plugin-view', 'index'),
      ])
        expect(shouldBlockPluginViewNavigation({ ...input, url })).toBe(true);
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
