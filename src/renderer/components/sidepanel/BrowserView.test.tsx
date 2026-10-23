import type { BrowserTabState } from '@shared/types/browser';
import { parseHTML } from 'linkedom';
import { act, type ComponentProps, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type BrowserSurface, BrowserView } from './BrowserView';

const harness = vi.hoisted(() => ({
  onState: null as ((event: { tabId: string; state: BrowserTabState }) => void) | null,
  setControl: vi.fn(),
  navigate: vi.fn(),
  stop: vi.fn(),
  reload: vi.fn(),
  setViewport: vi.fn(),
  setDevice: vi.fn(),
  frame: null as (() => void) | null,
  t: (key: string) => key,
}));
vi.mock('@/i18n', () => ({ useI18n: () => ({ t: harness.t }) }));
vi.mock('@/stores/sessions', () => ({
  useSessionsStore: (select: (value: unknown) => unknown) =>
    select({ conversations: {}, activeId: 'owner' }),
}));
vi.mock('@/stores/sidePanel', () => ({
  useSidePanelStore: Object.assign(
    (select: (value: unknown) => unknown) =>
      select({ uiByConversation: { owner: { open: true } } }),
    { getState: () => ({ setBrowserHole: vi.fn() }) }
  ),
}));
vi.mock('@/lib/sidePanelDockId', () => ({ resolveSidePanelDockConversationId: () => 'owner' }));
vi.mock('@/lib/overlayGuard', () => ({ syncOverlayGuard: vi.fn() }));
vi.mock('@/components/chat/composerMentionBridge', () => ({
  insertComposerImage: vi.fn(),
  insertUiElementMention: vi.fn(),
  requestFocusComposer: vi.fn(),
}));
vi.mock('@/components/ui/toast', () => ({ addToast: vi.fn() }));
vi.mock('@/components/ui/button', () => ({
  Button: ({
    variant: _variant,
    size: _size,
    ...props
  }: ComponentProps<'button'> & { variant?: string; size?: string }) => <button {...props} />,
}));
vi.mock('@/components/ui/menu', () => {
  const Wrap = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    Menu: Wrap,
    MenuPopup: Wrap,
    MenuSeparator: () => null,
    MenuTrigger: ({ children, ...props }: ComponentProps<'button'>) => (
      <button type="button" {...props}>
        {children}
      </button>
    ),
    MenuItem: ({
      children,
      onClick,
      disabled,
    }: {
      children?: ReactNode;
      onClick?: () => void;
      disabled?: boolean;
    }) => (
      <button type="button" disabled={disabled} onClick={onClick}>
        {children}
      </button>
    ),
  };
});
vi.mock('./BrowserDeviceToolbar', () => ({
  BrowserDeviceToolbar: ({ scale }: { scale: number | null }) => (
    <div data-testid="device-toolbar">{scale === null ? 'fit' : Math.round(scale * 100)}</div>
  ),
  BROWSER_STAGE_BACKGROUNDS: [],
  DEFAULT_BROWSER_DEVICE: { enabled: true, profileId: 'responsive', width: 393, height: 852 },
}));
vi.mock('./BrowserHistoryPanel', () => ({ BrowserHistoryPanel: () => null }));
vi.mock('./BrowserDownloadsPanel', () => ({ BrowserDownloadsPanel: () => null }));
const state: BrowserTabState = {
  tabId: 'exact-tab',
  url: '',
  title: '',
  favicon: null,
  loading: false,
  canGoBack: false,
  canGoForward: false,
  locked: false,
  control: 'agent',
  devtoolsOpen: false,
  designMode: false,
  holder: null,
};
let root: Root;
let container: HTMLElement;
const surface: BrowserSurface = {
  id: 'exact-tab',
  isActive: true,
  isVisible: true,
  setTitle: vi.fn(),
  getParameters: () => ({}),
  updateParameters: vi.fn(),
};
async function emit(next: Partial<BrowserTabState>) {
  await act(async () => harness.onState?.({ tabId: 'exact-tab', state: { ...state, ...next } }));
}
async function click(text: string, index = 0) {
  const button = Array.from(container.querySelectorAll('button')).filter(
    (item) => item.textContent === text || item.getAttribute('aria-label') === text
  )[index];
  expect(button).toBeDefined();
  await act(async () => button?.click());
}

beforeEach(async () => {
  const dom = parseHTML('<html><body><div id="root"></div></body></html>');
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', dom.document);
  Object.defineProperty(dom.document, 'visibilityState', { value: 'visible' });
  Object.defineProperty(dom.window.HTMLElement.prototype, 'isConnected', {
    get: () => true,
    configurable: true,
  });
  dom.window.HTMLElement.prototype.getBoundingClientRect = () => ({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    bottom: 500,
    right: 500,
    width: 500,
    height: 500,
    toJSON: () => ({}),
  });
  harness.frame = null;
  harness.setViewport.mockReset().mockResolvedValue(state);
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn((callback: () => void) => {
      harness.frame = callback;
      return 1;
    })
  );
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  harness.setControl.mockReset().mockImplementation(async (_tabId, _conversationId, control) => ({
    ok: true,
    result: { ...state, control },
  }));
  harness.navigate.mockReset().mockResolvedValue({ ok: true });
  harness.stop.mockReset().mockResolvedValue({ ok: true });
  harness.reload.mockReset().mockResolvedValue(undefined);
  harness.setDevice.mockReset().mockImplementation(async (_tabId, _conversationId, device) => ({
    ok: true,
    result: { ...state, url: 'https://example.com/', device },
  }));
  Object.assign(dom.window, {
    electronAPI: {
      browser: {
        onState: (callback: typeof harness.onState) => {
          harness.onState = callback;
          return vi.fn();
        },
        onDesignMode: () => vi.fn(),
        navigate: harness.navigate,
        setControl: harness.setControl,
        stop: harness.stop,
        reload: harness.reload,
        setViewport: harness.setViewport,
        setDevice: harness.setDevice,
        setDevToolsViewport: vi.fn(async () => state),
      },
    },
  });
  container = dom.document.getElementById('root') as unknown as HTMLElement;
  root = createRoot(container);
  await act(async () =>
    root.render(<BrowserView conversationId="owner" panelApi={surface} active />)
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

describe('BrowserView controls', () => {
  it('shows all five capabilities on a new tab', () => {
    for (const text of [
      'Browse the web',
      'Read pages',
      'Interact with pages',
      'Test layouts',
      'Retrace your steps',
    ])
      expect(container.textContent).toContain(text);
  });
  it('takes over an unlocked exact tab and only resumes on an explicit click', async () => {
    await emit({});
    expect(harness.setControl).not.toHaveBeenCalled();
    await click('Take control');
    expect(harness.setControl).toHaveBeenLastCalledWith('exact-tab', 'owner', 'manual');
    expect(container.textContent).toContain('Allow agent to continue');
    await emit({ control: 'manual', url: 'https://example.com/' });
    expect(harness.setControl).toHaveBeenCalledTimes(1);
    await click('Allow agent to continue');
    expect(harness.setControl).toHaveBeenLastCalledWith('exact-tab', 'owner', 'agent');
  });
  it('surfaces control failure without pretending takeover succeeded', async () => {
    harness.setControl.mockResolvedValueOnce({ ok: false, error: 'Takeover failed' });
    await click('Take control');
    expect(container.textContent).toContain('Takeover failed');
    expect(container.textContent).not.toContain('Allow agent to continue');
  });
  it('shows the floating takeover pill while the agent holds the tab', async () => {
    await emit({ locked: true, url: 'https://example.com/' });
    expect(container.textContent).toContain('Agent is browsing');
    expect(container.textContent).toContain('In control {{time}}');
    expect(container.querySelector('.browser-agent-glow')).not.toBeNull();
    const address = container.querySelector('input[aria-label="Search or enter a URL"]');
    expect((address as HTMLInputElement).disabled).toBe(true);
    await click('Let me take over');
    expect(harness.setControl).toHaveBeenLastCalledWith('exact-tab', 'owner', 'manual');
    await emit({ locked: true, control: 'manual', url: 'https://example.com/' });
    expect(container.querySelector('.browser-agent-glow')).toBeNull();
  });
  it('opens device preview from the menu and sizes the guest to the centered frame', async () => {
    await emit({ url: 'https://example.com/' });
    await act(async () => harness.frame?.());
    await click('Device preview');
    expect(harness.setDevice).toHaveBeenLastCalledWith(
      'exact-tab',
      'owner',
      expect.objectContaining({ enabled: true, width: 393, height: 852 })
    );
    expect(container.querySelector('[data-testid="device-toolbar"]')?.textContent).toBe(
      String(Math.round((452 / 852) * 100))
    );
    // 舞台底色必须让出设备框：guest 沉到 workbench 之下时才能从洞里透出网页
    expect(
      container.querySelector('[data-slot="browser-stage-backdrop"]')?.getAttribute('style')
    ).toContain('clip-path');
    await click('Device preview');
    expect(harness.setDevice).toHaveBeenLastCalledWith('exact-tab', 'owner', { enabled: false });
    expect(container.querySelector('[data-testid="device-toolbar"]')).toBeNull();
  });
  it('stops loading instead of reloading and retains reload when idle', async () => {
    await emit({ loading: true });
    await click('Stop loading');
    expect(harness.stop).toHaveBeenCalledWith('exact-tab');
    expect(harness.reload).not.toHaveBeenCalled();
    await emit({ loading: false });
    await click('Reload');
    expect(harness.reload).toHaveBeenCalledWith('exact-tab');
  });
  it('keeps the blank guest behind the new tab UI, then raises real pages', async () => {
    await act(async () => harness.frame?.());
    expect(harness.setViewport).toHaveBeenLastCalledWith(
      'exact-tab',
      'owner',
      expect.objectContaining({ width: 500, height: 500 }),
      true
    );
    await emit({ url: 'https://example.com/' });
    await act(async () => harness.frame?.());
    expect(harness.setViewport).toHaveBeenLastCalledWith(
      'exact-tab',
      'owner',
      expect.any(Object),
      false
    );
  });
  it('does not navigate on state changes or for a blocked address', async () => {
    await emit({ url: 'javascript:alert(1)' });
    const form = container.querySelector('form');
    await act(async () =>
      form?.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))
    );
    expect(harness.navigate).not.toHaveBeenCalled();
    expect(container.textContent).toContain(
      'Only HTTP, HTTPS, or workspace file URLs can be opened here. Workspace files are validated by Enso.'
    );
  });
});
