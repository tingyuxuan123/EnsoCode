// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { Markdown } from '@/components/chat/Markdown';
import { registerPluginSlot, resetPluginSlots } from './registry';

vi.mock('@/stores/settings', () => ({
  useSettingsStore: (select: (state: unknown) => unknown) =>
    select({
      contextMenuOpen: [],
      projects: [],
      disabledBuiltinTools: [],
      openLinksInBuiltinBrowser: false,
    }),
}));
vi.mock('@/stores/sessions', () => ({
  useSessionsStore: (select: (state: unknown) => unknown) => select({ conversations: {} }),
}));
vi.mock('@/i18n', () => ({ useI18n: () => ({ t: (value: string) => value }) }));
vi.mock('@/lib/sidePanelDock', () => ({
  openSidePanelFile: vi.fn(),
  openSidePanelBrowserUrl: vi.fn(),
}));
vi.mock('@/components/chat/CodeBlock', () => ({ CodeBlock: () => null }));
vi.mock('@/components/chat/MermaidRenderer', () => ({ MermaidRenderer: () => null }));
afterEach(resetPluginSlots);
it('renders a namespaced plugin fence and assistant-only leaves without recursive addons', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  registerPluginSlot({
    pluginId: 'local.test',
    slot: 'block',
    language: 'chart',
    component: ({ source }) => createElement('span', { 'data-plugin-chart': '' }, String(source)),
  });
  const sources: string[] = [];
  registerPluginSlot({
    pluginId: 'local.test',
    slot: 'message.leaf',
    component: ({ source, Markdown: Render }) => {
      sources.push(String(source));
      return createElement(Render as (props: { text: string }) => import('react').ReactNode, {
        text: 'Translation',
      });
    },
  });
  const container = document.createElement('div');
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        createElement(Markdown, {
          text: '```local.test:chart\ndata\n```\n\nOriginal',
          leaf: { messageIndex: 1, sessionId: 'session' },
        })
      )
    );
    expect(container.querySelector('[data-plugin-chart]')?.textContent).toContain('data');
    expect(sources).toEqual(['Original']);
    expect(container.textContent).toContain('Translation');
    sources.length = 0;
    await act(async () => root.render(createElement(Markdown, { text: 'Documentation' })));
    expect(sources).toEqual([]);
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
