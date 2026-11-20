// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettingsStore } from '@/stores/settings';
import { ChatWidthToggle } from './ChatWidthToggle';

const api = vi.hoisted(() => {
  const electronAPI = {
    settings: {
      read: async () => ({}),
      writeKey: vi.fn(async () => {}),
      onChanged: () => () => {},
    },
    sourceAuthority: {
      read: async () => ({ projects: [], conversations: [] }),
      onChanged: () => () => {},
    },
  };
  (window as unknown as { electronAPI: unknown }).electronAPI = electronAPI;
  return electronAPI;
});

vi.mock('@/i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

describe('ChatWidthToggle', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('electronAPI', api);
    useSettingsStore.getState().setChatWide(false);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    useSettingsStore.getState().setChatWide(false);
    vi.unstubAllGlobals();
  });

  it('点击在阅读宽度与全宽之间切换，并同步根元素 enso-chat-wide 类名', async () => {
    await act(async () => root.render(createElement(ChatWidthToggle)));

    const btn = () => container.querySelector<HTMLButtonElement>('[data-slot="chat-width-toggle"]');
    expect(btn()?.getAttribute('aria-pressed')).toBe('false');
    expect(btn()?.getAttribute('aria-label')).toBe('Use full chat width');
    expect(document.documentElement.classList.contains('enso-chat-wide')).toBe(false);

    await act(async () => btn()?.click());
    expect(btn()?.getAttribute('aria-pressed')).toBe('true');
    expect(btn()?.getAttribute('aria-label')).toBe('Use reading width');
    expect(document.documentElement.classList.contains('enso-chat-wide')).toBe(true);

    await act(async () => btn()?.click());
    expect(btn()?.getAttribute('aria-pressed')).toBe('false');
    expect(document.documentElement.classList.contains('enso-chat-wide')).toBe(false);
  });
});
