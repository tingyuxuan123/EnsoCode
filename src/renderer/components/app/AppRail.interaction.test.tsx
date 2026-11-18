// @vitest-environment happy-dom
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { AppRail } from './AppRail';

vi.mock('@/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('@/stores/settings', () => ({
  useSettingsStore: (select: (state: object) => unknown) =>
    select({ keybindings: {}, autoUpdate: true }),
}));
vi.mock('./RailTip', () => ({ RailTip: ({ children }: { children: ReactNode }) => children }));
vi.mock('./StatusBar', () => ({ StatusBar: () => <div data-slot="status-bar" /> }));
vi.mock('./ReleaseNotesDialog', () => ({ ReleaseNotesDialog: () => null }));
vi.mock('@/components/ui/popover', () => {
  const Wrap = ({ children }: { children?: ReactNode }) => <>{children}</>;
  const Trigger = ({ children, ...rest }: { children?: ReactNode; [key: string]: unknown }) => (
    <button type="button" {...rest}>
      {children}
    </button>
  );
  return { Popover: Wrap, PopoverPopup: Wrap, PopoverTrigger: Trigger };
});
let publishUpdate: ((status: unknown) => void) | null = null;
vi.stubGlobal('electronAPI', {
  updater: {
    onStatus: (callback: (status: unknown) => void) => {
      publishUpdate = callback;
      return () => {};
    },
    downloadUpdate: async () => {},
    quitAndInstall: async () => {},
  },
});
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

  it('更新进度落到底部分组：在状态项之前，且不再有顶部横幅', async () => {
    const host = document.createElement('div');
    const root = createRoot(host);
    await act(async () => root.render(<AppRail />));
    expect(host.querySelector('[data-slot="update-rail"]')).toBeNull();
    await act(async () => publishUpdate?.({ status: 'downloading', progress: { percent: 8 } }));
    const rail = host.querySelector('[data-slot="app-rail"]');
    const update = rail?.querySelector('[data-slot="update-rail"]');
    const statusBar = rail?.querySelector('[data-slot="status-bar"]');
    expect(update).not.toBeNull();
    expect(statusBar).not.toBeNull();
    // 同一个分组里，更新入口排在状态项之前（图标轨底部那一组的最上面）。
    expect(
      update &&
        statusBar &&
        update.compareDocumentPosition(statusBar) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(host.querySelector('[data-slot="update-banner"]')).toBeNull();
    await act(async () => root.unmount());
  });
});
