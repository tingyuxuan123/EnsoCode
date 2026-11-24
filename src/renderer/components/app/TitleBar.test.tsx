import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { SummonEnsoButton, TitleBar } from './TitleBar';

// SSR 渲染只需要 env.platform；useWindowMaximized 的 effect 不在服务端跑
vi.stubGlobal('window', {
  electronAPI: { env: { platform: 'darwin' } },
});
vi.mock('@/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));

const setPlatform = (platform: 'darwin' | 'win32' | 'linux') => {
  window.electronAPI.env.platform = platform;
};
const render = (props: Parameters<typeof TitleBar>[0]) =>
  renderToStaticMarkup(createElement(TitleBar, props));

it('召唤入口使用 CodeKiln 名称，组件和派发标识不随品牌改变', () => {
  const html = renderToStaticMarkup(createElement(SummonEnsoButton));
  expect(html).toContain('aria-label="Ask CodeKiln"');
  expect(html).toContain('>Ask CodeKiln</span>');
  expect(html).toContain('data-nav-glyph="ask-codekiln"');
  expect(html).not.toContain('lucide-sparkles');
  expect(html).not.toContain('Ask Enso');
});

describe('TitleBar layout', () => {
  it('heading replaces the title but stays inside the drag region', () => {
    setPlatform('darwin');
    const html = render({
      title: 'CodeKiln',
      heading: createElement('span', { 'data-testid': 'heading' }, 'Session'),
    });
    expect(html).toContain('data-testid="heading"');
    expect(html).not.toContain('>CodeKiln<');
    // 只读标题不能挡住窗口拖拽
    expect(html).not.toContain('no-drag');
  });

  it('leading still replaces the title and stays left (no centering)', () => {
    setPlatform('win32');
    const html = render({
      title: 'CodeKiln',
      leading: createElement('span', { 'data-testid': 'lead' }),
    });
    expect(html).toContain('data-testid="lead"');
    expect(html).not.toContain('absolute inset-0');
    expect(html).not.toContain('CodeKiln');
  });

  it('preserves titles and platform-specific caption controls', () => {
    setPlatform('darwin');
    const html = render({ title: 'Settings' });
    expect(html).toContain('Settings');
    expect(html).not.toContain('absolute inset-0');
    // macOS 不渲染自绘窗口控制
    expect(html).not.toContain('aria-label="Close"');
    setPlatform('win32');
    const win = render({ title: 'Settings' });
    expect(win).not.toContain('aria-label="Close"');
    expect(win).not.toContain('aria-label="Maximize"');
    expect(win).toContain('data-native-window-controls="true"');
    setPlatform('linux');
    expect(render({ title: 'Settings' })).toContain('aria-label="Close"');
  });
});
