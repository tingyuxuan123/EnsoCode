// @vitest-environment happy-dom
import { parseHTML } from 'linkedom';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ThemeEntry } from './appearanceThemes';

vi.mock('@/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));

const { AppearanceThemeCards } = await import('./AppearanceThemeCards');

const ENTRIES: ThemeEntry[] = [
  {
    kind: 'builtin',
    id: 'builtin:ocean',
    palette: 'ocean',
    nameKey: 'Ocean Light',
    preview: {
      canvas: '#111111',
      surface: '#222222',
      sunken: '#333333',
      border: '#444444',
      accent: '#555555',
    },
  },
  {
    kind: 'plugin',
    id: 'local.demo/mint',
    name: 'Demo Mint',
    pluginName: 'Demo plugin',
    preview: {
      canvas: '#666666',
      surface: '#777777',
      sunken: '#888888',
      border: '#999999',
      accent: '#aaaaaa',
    },
  },
  { kind: 'plugin-unavailable', id: 'local.gone/x', preview: null },
];

let container: HTMLElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  const { window } = parseHTML('<html><body></body></html>');
  vi.stubGlobal('window', window);
  vi.stubGlobal('document', window.document);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
});

function render(selectedId: string, onSelect = vi.fn()) {
  act(() =>
    root.render(
      <AppearanceThemeCards entries={ENTRIES} selectedId={selectedId} onSelect={onSelect} />
    )
  );
  return onSelect;
}

function card(kind: string): HTMLElement {
  const element = container.querySelector<HTMLElement>(`[data-theme-card="${kind}"]`);
  if (!element) throw new Error(`missing card: ${kind}`);
  return element;
}

describe('AppearanceThemeCards', () => {
  it('renders built-in and plugin themes side by side with source labels', () => {
    render('builtin:ocean');
    expect(container.querySelectorAll('[data-theme-card]')).toHaveLength(3);
    expect(card('builtin').textContent).toContain('Ocean Light');
    expect(card('builtin').textContent).toContain('Built-in');
    expect(card('plugin').textContent).toContain('Demo Mint');
    expect(card('plugin').textContent).toContain('Plugin');
    expect(card('plugin').title).toBe('Demo Mint · Demo plugin');
  });

  it('only marks the current theme as pressed', () => {
    render('local.demo/mint');
    expect(card('builtin').getAttribute('aria-pressed')).toBe('false');
    expect(card('plugin').getAttribute('aria-pressed')).toBe('true');
  });

  it('selects whichever card is clicked', () => {
    const onSelect = render('builtin:ocean');
    act(() => card('plugin').click());
    expect(onSelect).toHaveBeenCalledWith(ENTRIES[1]);
  });

  it('keeps an unavailable plugin theme visible but not selectable', () => {
    const onSelect = render('local.gone/x');
    expect(card('plugin-unavailable').textContent).toContain('Plugin theme unavailable');
    expect(card('plugin-unavailable').getAttribute('aria-pressed')).toBe('true');
    expect((card('plugin-unavailable') as HTMLButtonElement).disabled).toBe(true);
    act(() => card('plugin-unavailable').click());
    expect(onSelect).not.toHaveBeenCalled();
  });
});
