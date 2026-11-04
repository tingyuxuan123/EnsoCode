// @vitest-environment happy-dom
import type { UpdateStatus } from '@shared/types/updater';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UpdateSection } from './GeneralSettings';

const settings = vi.hoisted(() => ({ autoUpdate: false, autoRestartWhenIdle: false }));
vi.mock('@/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('@/stores/settings', () => ({
  useSettingsStore: (select: (state: typeof settings) => unknown) => select(settings),
}));
vi.mock('./CompactReserveTokensSection', () => ({ CompactReserveTokensSection: () => null }));
vi.mock('./ConfigSyncSettings', () => ({ ConfigSyncSettings: () => null }));
vi.mock('./FileOpeningSettings', () => ({ FileOpeningSettings: () => null }));
vi.mock('./SmartCompactPicker', () => ({ SmartCompactPicker: () => null }));
vi.mock('./NewSessionBadge', () => ({ NewSessionBadge: () => null }));

describe('UpdateSection', () => {
  const downloadUpdate = vi.fn(async () => {});
  const checkForUpdates = vi.fn(async () => {});
  let listener: (next: UpdateStatus) => void;
  let root: Root;
  const info = { version: '0.2.13', releaseNotes: '- Actual personal changes' };
  const button = (text: string) =>
    Array.from(document.querySelectorAll('button')).find((entry) => entry.textContent === text);

  beforeEach(async () => {
    settings.autoUpdate = false;
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('electronAPI', {
      updater: {
        onStatus: (callback: typeof listener) => {
          listener = callback;
          return () => {};
        },
        downloadUpdate,
        checkForUpdates,
      },
    });
    root = createRoot(document.body.appendChild(document.createElement('div')));
    await act(async () => root.render(<UpdateSection />));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('晚开设置不猜测状态；收到可用状态后可手动下载，已下载后可查看同版日志', async () => {
    expect(button('Release notes')).toBeUndefined();
    expect(button('Download')).toBeUndefined();
    expect(checkForUpdates).not.toHaveBeenCalled();
    await act(async () => button('Check for updates')?.click());
    expect(checkForUpdates).toHaveBeenCalledOnce();
    await act(async () => listener({ status: 'available', info }));
    await act(async () => button('Download')?.click());
    expect(downloadUpdate).toHaveBeenCalledOnce();
    await act(async () => listener({ status: 'downloaded', info }));
    expect(button('Restart to update')).toBeDefined();
    await act(async () => button('Release notes')?.click());
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      'Actual personal changes'
    );
    await act(async () => listener({ status: 'error', error: 'Signature rejected' }));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(button('Restart to update')).toBeUndefined();
    expect(document.body.textContent).toContain('Signature rejected');
  });

  it('无日志的旧状态不捏造日志入口', async () => {
    await act(async () => listener({ status: 'available', info: { version: '0.2.12' } }));
    expect(button('Release notes')).toBeUndefined();
    expect(button('Download')).toBeDefined();
  });
});
