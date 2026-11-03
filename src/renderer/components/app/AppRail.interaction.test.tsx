// @vitest-environment happy-dom
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { AppRail } from './AppRail';

vi.mock('@/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('@/stores/settings', () => ({
  useSettingsStore: (select: (state: object) => unknown) => select({ keybindings: {} }),
}));
vi.mock('./RailTip', () => ({ RailTip: ({ children }: { children: ReactNode }) => children }));
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

describe('AppRail design toggle', () => {
  it('invokes gallery navigation and updates the pressed state on open and close', async () => {
    const host = document.createElement('div');
    const root = createRoot(host);
    const onToggle = vi.fn();
    const render = (active: boolean) =>
      root.render(<AppRail designGallery={{ label: 'Design', active, onToggle }} />);
    await act(async () => render(false));
    const button = () => host.querySelector<HTMLButtonElement>('[aria-label="Design"]');
    await act(async () => button()?.click());
    expect(onToggle).toHaveBeenCalledOnce();
    await act(async () => render(true));
    expect(button()?.getAttribute('aria-pressed')).toBe('true');
    await act(async () => button()?.click());
    expect(onToggle).toHaveBeenCalledTimes(2);
    await act(async () => render(false));
    expect(button()?.getAttribute('aria-pressed')).toBe('false');
    await act(async () => root.unmount());
  });
});
