import type { BrowserDownloadEntry, BrowserHistoryEntry } from '@shared/types/browser';
import { parseHTML } from 'linkedom';
import { act, type ComponentProps, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserDownloadsPanel } from './BrowserDownloadsPanel';
import { BrowserHistoryPanel } from './BrowserHistoryPanel';

const t = (key: string) => key;
vi.mock('@/i18n', () => ({ useI18n: () => ({ t, locale: 'en' }) }));
vi.mock('@/components/ui/dialog', () => {
  const Wrap = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    Dialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
      open ? <div>{children}</div> : null,
    DialogContent: Wrap,
    DialogHeader: Wrap,
    DialogTitle: Wrap,
    DialogDescription: Wrap,
    DialogPanel: Wrap,
    DialogFooter: Wrap,
  };
});
vi.mock('@/components/ui/button', () => ({
  Button: ({
    variant: _variant,
    size: _size,
    ...props
  }: ComponentProps<'button'> & { variant?: string; size?: string }) => <button {...props} />,
}));
vi.mock('@/components/ui/input', () => ({
  Input: (props: ComponentProps<'input'>) => <input {...props} />,
}));
let root: Root;
let container: HTMLElement;
const history = vi.fn();
const downloads = vi.fn();
const navigate = vi.fn();
const close = vi.fn();
let onDownloadsChanged: ((event: { conversationId: string }) => void) | undefined;
const unsubscribe = vi.fn();
const visit: BrowserHistoryEntry = {
  id: 'visit-id',
  tabId: 'old-tab',
  conversationId: 'owner',
  url: 'https://example.com/page',
  title: 'Visited page',
  visitedAt: 1,
};
const download = (state: BrowserDownloadEntry['state']): BrowserDownloadEntry => ({
  id: state,
  conversationId: 'owner',
  tabId: 'old-tab',
  url: 'https://example.com/file',
  filename: `${state}.txt`,
  receivedBytes: 50,
  totalBytes: 100,
  state,
  startedAt: 1,
  updatedAt: 2,
});
async function click(label: string) {
  const button = Array.from(container.querySelectorAll('button')).find(
    (item) => item.textContent === label || item.getAttribute('aria-label') === label
  );
  expect(button).toBeDefined();
  await act(async () => button?.click());
}
beforeEach(() => {
  const dom = parseHTML('<html><body><div id="root"></div></body></html>');
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', dom.document);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  Object.assign(dom.window, {
    electronAPI: {
      browser: {
        history,
        downloads,
        onDownloadsChanged: (callback: typeof onDownloadsChanged) => {
          onDownloadsChanged = callback;
          return unsubscribe;
        },
      },
    },
  });
  history.mockReset().mockResolvedValue({ ok: true, result: { items: [visit], total: 1 } });
  downloads.mockReset().mockResolvedValue({
    ok: true,
    result: {
      items: ['progressing', 'paused', 'completed', 'cancelled', 'interrupted'].map((state) =>
        download(state as BrowserDownloadEntry['state'])
      ),
      total: 5,
    },
  });
  navigate.mockReset().mockResolvedValue(true);
  close.mockReset();
  unsubscribe.mockReset();
  container = dom.document.getElementById('root') as unknown as HTMLElement;
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('browser history panel', () => {
  const mount = async () => {
    await act(async () =>
      root.render(
        <BrowserHistoryPanel
          open
          onOpenChange={close}
          conversationId="owner"
          onNavigate={navigate}
          navigationDisabled={false}
        />
      )
    );
  };
  it('opens the recorded URL and removes only the selected record', async () => {
    await mount();
    await click('Open history page');
    expect(navigate).toHaveBeenCalledWith(visit.url);
    expect(close).toHaveBeenCalledWith(false);
    await click('Remove history record');
    expect(history).toHaveBeenCalledWith('owner', { action: 'remove', id: 'visit-id' });
  });
  it('requires a separate destructive confirmation before clearing history', async () => {
    await mount();
    await click('Clear all history');
    expect(history).not.toHaveBeenCalledWith('owner', { action: 'clear' });
    expect(container.textContent).toContain('This permanently removes the visit records');
    const confirm = Array.from(container.querySelectorAll('button')).find(
      (item) => item.textContent === 'Clear all history'
    );
    await act(async () => confirm?.click());
    expect(history).toHaveBeenCalledWith('owner', { action: 'clear' });
  });
  it('keeps failed navigation visible in the dialog', async () => {
    navigate.mockResolvedValueOnce(false);
    await mount();
    await click('Open history page');
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Navigation failed');
    expect(close).not.toHaveBeenCalled();
  });
});

describe('browser downloads panel', () => {
  const mount = async () => {
    await act(async () =>
      root.render(<BrowserDownloadsPanel open onOpenChange={close} conversationId="owner" />)
    );
  };
  it('renders progress and dispatches user actions with record IDs, never paths', async () => {
    await mount();
    expect(container.querySelector('progress')?.getAttribute('value')).toBe('50');
    for (const [label, id, action] of [
      ['Pause download', 'progressing', 'pause'],
      ['Resume download', 'paused', 'resume'],
      ['Cancel download', 'progressing', 'cancel'],
      ['Reveal in file manager', 'completed', 'reveal'],
      ['Remove download record', 'completed', 'remove'],
    ]) {
      await click(label);
      expect(downloads).toHaveBeenCalledWith('owner', { action, id });
    }
    expect(container.textContent).toContain(
      'Removing a record does not delete the downloaded file.'
    );
  });
  it('refreshes only for this conversation and cleans up its subscription', async () => {
    await mount();
    vi.useFakeTimers();
    const calls = downloads.mock.calls.length;
    await act(async () => {
      onDownloadsChanged?.({ conversationId: 'other' });
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(downloads).toHaveBeenCalledTimes(calls);
    await act(async () => {
      onDownloadsChanged?.({ conversationId: 'owner' });
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(downloads).toHaveBeenCalledTimes(calls + 1);
    await act(async () =>
      root.render(
        <BrowserDownloadsPanel open={false} onOpenChange={close} conversationId="owner" />
      )
    );
    expect(unsubscribe).toHaveBeenCalled();
  });
});
