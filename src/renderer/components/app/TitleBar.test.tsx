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
const centered = createElement('div', { 'data-testid': 'mode-switch' });

it('召唤入口使用 Collabra 名称，组件和派发标识不随品牌改变', () => {
  const html = renderToStaticMarkup(createElement(SummonEnsoButton));
  expect(html).toContain('aria-label="Ask Collabra"');
  expect(html).toContain('>Ask Collabra</span>');
  expect(html).not.toContain('Ask Enso');
});

describe('TitleBar centered content', () => {
  it('renders centered content as an overlay sibling of title and actions', () => {
    setPlatform('win32');
    const html = render({
      title: 'Eaves',
      centered,
      actions: createElement('button', { type: 'button' }, 'act'),
    });
    // 居中覆盖层：绝对定位铺满、自身不可点，内部内容可点且不参与拖拽
    expect(html).toContain('absolute inset-0 flex items-center justify-center');
    expect(html).toContain('pointer-events-auto');
    expect(html).toContain('data-testid="mode-switch"');
    // 标题不被居中内容替换，仍在左侧
    expect(html).toContain('Eaves');
    expect(html).toContain('act');
  });

  it('keeps the window drag region under the overlay', () => {
    setPlatform('win32');
    const html = render({ title: 'Eaves', centered });
    // 覆盖层 pointer-events:none，空处仍可拖动窗口
    expect(html).toContain('pointer-events-none absolute inset-0');
    expect(html).toContain('no-drag');
  });

  it('marks the centered lane so the mode switch has one stable visual carrier', () => {
    setPlatform('darwin');
    const html = render({ title: 'Eaves', centered });
    expect(html).toContain('data-slot="title-bar-center"');
    expect(html).toContain('data-testid="mode-switch"');
  });

  it('caps a long heading before the centered lane instead of letting it run underneath', () => {
    setPlatform('darwin');
    const heading = createElement('span', { 'data-testid': 'heading' }, 'Session');
    const centeredHtml = render({ title: 'Eaves', heading, centered });
    const plainHtml = render({ title: 'Eaves', heading });
    // 居中通道出现时标题预留空间，不能被居中的分段控件盖住
    expect(centeredHtml).toContain('data-slot="title-bar-heading"');
    expect(centeredHtml).toContain('data-center-reserve="true"');
    expect(plainHtml).toContain('data-slot="title-bar-heading"');
    expect(plainHtml).not.toContain('data-center-reserve');
  });

  it('macOS: hides the title beside traffic lights when centered', () => {
    setPlatform('darwin');
    const html = render({ title: 'Eaves', centered });
    expect(html).toContain('data-testid="mode-switch"');
    expect(html).not.toContain('Eaves');
    // 红绿灯预留仍在
    expect(html).toContain('pl-[84px]');
  });

  it('heading replaces the title but stays inside the drag region', () => {
    setPlatform('darwin');
    const html = render({
      title: 'Eaves',
      heading: createElement('span', { 'data-testid': 'heading' }, 'Session'),
    });
    expect(html).toContain('data-testid="heading"');
    expect(html).not.toContain('>Eaves<');
    // 只读标题不能挡住窗口拖拽
    expect(html).not.toContain('no-drag');
  });

  it('leading still replaces the title and stays left (no centering)', () => {
    setPlatform('win32');
    const html = render({
      title: 'Eaves',
      leading: createElement('span', { 'data-testid': 'lead' }),
    });
    expect(html).toContain('data-testid="lead"');
    expect(html).not.toContain('absolute inset-0');
    expect(html).not.toContain('Eaves');
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
