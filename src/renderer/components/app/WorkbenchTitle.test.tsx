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
vi.mock('@/stores/sessions', () => ({
  useSessionsStore: (select: (state: object) => unknown) =>
    select({
      activeId: 'session',
      conversations: { session: { id: 'session', title: 'Current task', projectId: 'project' } },
    }),
}));
vi.mock('@/stores/settings', () => ({
  useSettingsStore: (select: (state: object) => unknown) =>
    select({ projects: [{ id: 'project', name: 'Workspace' }] }),
}));

function render(sidebarWidth: number, sidebarCollapsed = false) {
  return parseHTML(
    renderToStaticMarkup(
      createElement(TitleBar, {
        heading: createElement(WorkbenchTitle, { sidebarWidth, sidebarCollapsed }),
      })
    )
  ).document;
}

describe('workbench title follows the navigation boundary', () => {
  it.each([200, 264, 420])('reserves the actual %ipx sidebar plus rail and divider', (width) => {
    const document = render(width);
    const leading = document.querySelector<HTMLElement>('[data-slot="workbench-title-leading"]');
    expect(leading?.style.width).toBe(`${56 + width + 1}px`);
    expect(document.querySelector('[data-slot="workbench-session-title"]')?.textContent).toBe(
      'Current task'
    );
  });

  it.each(['darwin', 'win32', 'linux'] as const)(
    'uses the %s native inset without moving the rail boundary',
    (platform) => {
      window.electronAPI.env.platform = platform;
      const document = render(420);
      expect(
        document.querySelector('header')?.style.getPropertyValue('--titlebar-left-inset')
      ).toBe(platform === 'darwin' ? '84px' : '12px');
      const leading = document.querySelector<HTMLElement>('[data-slot="workbench-title-leading"]');
      expect(leading?.style.marginLeft).toBe('calc(-1 * var(--titlebar-left-inset))');
      expect(leading?.style.minWidth).toBe('var(--titlebar-left-inset)');
      expect(leading?.style.width).toBe('477px');
    }
  );

  it('drops the sidebar and brand when collapsed, while retaining the native-control safe inset', () => {
    const document = render(420, true);
    const leading = document.querySelector<HTMLElement>('[data-slot="workbench-title-leading"]');
    expect(leading?.style.width).toBe('56px');
    expect(leading?.textContent).toBe('');
    expect(document.querySelector('[data-slot="workbench-session-title"]')?.textContent).toBe(
      'Current task'
    );
  });
});
