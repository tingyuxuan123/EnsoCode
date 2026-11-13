import { parseHTML } from 'linkedom';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { TitleBar } from './TitleBar';
import { WorkbenchTitle } from './WorkbenchTitle';

vi.stubGlobal('window', {
  electronAPI: { env: { platform: 'darwin' } },
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
});
vi.mock('@/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));

function render(extra: { centered?: boolean } = {}) {
  return parseHTML(
    renderToStaticMarkup(
      createElement(TitleBar, {
        heading: createElement(WorkbenchTitle),
        ...(extra.centered ? { centered: createElement('div', { 'data-testid': 'mode' }) } : {}),
      })
    )
  ).document;
}

describe('标题栏左侧只保留品牌', () => {
  it('会话标题由聊天页签承载，标题栏不再重复一份', () => {
    const document = render();
    expect(document.querySelector('[data-slot="workbench-brand"]')?.textContent).toContain(
      'Collabra'
    );
    expect(document.querySelector('[data-slot="workbench-session-title"]')).toBeNull();
    expect(document.querySelector('[data-slot="workbench-project-chip"]')).toBeNull();
  });

  it.each(['darwin', 'win32', 'linux'] as const)(
    'keeps the %s native-control inset around the brand',
    (platform) => {
      window.electronAPI.env.platform = platform;
      const header = render().querySelector('header');
      expect(header?.className).toContain(platform === 'darwin' ? 'pl-[84px]' : 'pl-3');
    }
  );

  it('居中分段出现时品牌提前收住，不会被分段控件盖住', () => {
    const document = render({ centered: true });
    const heading = document.querySelector('[data-slot="title-bar-heading"]');
    expect(heading?.getAttribute('data-center-reserve')).toBe('true');
    expect(document.querySelector('[data-slot="workbench-brand"]')?.textContent).toContain(
      'Collabra'
    );
  });
});
