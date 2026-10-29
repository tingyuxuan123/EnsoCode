import type { BrowserTabState } from '@shared/types/browser';
import { parseHTML } from 'linkedom';
import { act, type ComponentProps, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type BrowserSurface, BrowserView } from './BrowserView';

const harness = vi.hoisted(() => ({
  onState: null as ((event: { tabId: string; state: BrowserTabState }) => void) | null,
  navigate: vi.fn(),
  goBack: vi.fn(),
  goForward: vi.fn(),
  stop: vi.fn(),
  reload: vi.fn(),
  setDesignMode: vi.fn(),
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
  BrowserDeviceToolbar: ({ scale, disabled }: { scale: number | null; disabled: boolean }) => (
    <div data-testid="device-toolbar">
      {scale === null ? 'fit' : Math.round(scale * 100)}
      <button type="button" aria-label="Change preview size" disabled={disabled} />
    </div>
  ),
  BROWSER_STAGE_BACKGROUNDS: [],
  DEFAULT_BROWSER_DEVICE: { enabled: true, profileId: 'responsive', width: 393, height: 852 },
}));
vi.mock('./BrowserHistoryPanel', () => ({
  BrowserHistoryPanel: ({
    open,
    navigationDisabled,
    onNavigate,
  }: {
    open: boolean;
    navigationDisabled: boolean;
    onNavigate: (url: string) => Promise<boolean>;
  }) =>
    open ? (
      <button
        type="button"
        disabled={navigationDisabled}
        onClick={() => void onNavigate('https://history.example/')}
      >
        Open history page
      </button>
    ) : null,
}));
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
  devtoolsOpen: false,
  designMode: false,
  holder: null,
};
const holder = { conversationId: 'agent-session', name: 'Browser agent' };
let browserState: BrowserTabState;
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
  browserState = { ...state, ...next };
  await act(async () => harness.onState?.({ tabId: 'exact-tab', state: browserState }));
}
function getButton(text: string, index = 0) {
  const button = Array.from(container.querySelectorAll('button')).filter(
    (item) => item.textContent === text || item.getAttribute('aria-label') === text
  )[index];
  expect(button).toBeDefined();
  return button;
}
async function click(text: string, index = 0) {
  await act(async () => getButton(text, index).click());
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
  browserState = state;
  harness.setViewport.mockReset().mockImplementation(async () => browserState);
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn((callback: () => void) => {
      harness.frame = callback;
      return 1;
    })
  );
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  harness.navigate.mockReset().mockResolvedValue({ ok: true });
  harness.goBack.mockReset().mockResolvedValue({ ok: true });
  harness.goForward.mockReset().mockResolvedValue({ ok: true });
  harness.stop.mockReset().mockResolvedValue({ ok: true });
  harness.reload.mockReset().mockResolvedValue(undefined);
  harness.setDesignMode.mockReset().mockImplementation(async (_tabId, designMode) => {
    browserState = { ...browserState, designMode };
    return browserState;
  });
  harness.setDevice.mockReset().mockImplementation(async (_tabId, _conversationId, device) => {
    browserState = { ...browserState, url: 'https://example.com/', device };
    return { ok: true, result: browserState };
  });
  Object.assign(dom.window, {
    electronAPI: {
      browser: {
        onState: (callback: typeof harness.onState) => {
          harness.onState = callback;
          return vi.fn();
        },
        onDesignMode: () => vi.fn(),
        navigate: harness.navigate,
        goBack: harness.goBack,
        goForward: harness.goForward,
        stop: harness.stop,
        reload: harness.reload,
        setDesignMode: harness.setDesignMode,
        setViewport: harness.setViewport,
        setDevice: harness.setDevice,
        setDevToolsViewport: vi.fn(async () => browserState),
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
  it.each([
    { locked: false, holder: null },
    { locked: false, holder },
    { locked: true, holder },
  ])('has no exclusive control UI for %o', async (ownership) => {
    await emit({ ...ownership, url: 'https://example.com/' });
    for (const text of [
      'Take control',
      'Allow agent to continue',
      'Let me take over',
      'Agent is browsing',
      'In control {{time}}',
    ])
      expect(container.textContent).not.toContain(text);
    expect(container.querySelector('.browser-agent-glow')).toBeNull();
  });
  it('keeps navigation and design controls enabled while an agent retains the tab', async () => {
    await emit({
      locked: true,
      holder,
      url: 'https://example.com/',
      canGoBack: true,
      canGoForward: true,
    });
    const address = container.querySelector<HTMLInputElement>(
      'input[aria-label="Search or enter a URL"]'
    );
    expect(address?.disabled).toBe(false);
    for (const text of ['Back', 'Forward', 'Reload', 'Toggle Design Mode', 'Device preview'])
      expect(getButton(text).disabled).toBe(false);
    const form = container.querySelector('form');
    await act(async () =>
      form?.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))
    );
    expect(harness.navigate).toHaveBeenCalledWith('exact-tab', 'owner', 'https://example.com/');
    await click('Back');
    expect(harness.goBack).toHaveBeenCalledWith('exact-tab');
    await click('Forward');
    expect(harness.goForward).toHaveBeenCalledWith('exact-tab');
    await click('Reload');
    expect(harness.reload).toHaveBeenCalledWith('exact-tab');
    await click('Toggle Design Mode');
    expect(harness.setDesignMode).toHaveBeenCalledWith('exact-tab', true);
  });
  it('keeps device controls and resize handles available while an agent retains the tab', async () => {
    await emit({
      locked: true,
      holder,
      url: 'https://example.com/',
      device: { enabled: true, width: 393, height: 852 },
    });
    await act(async () => harness.frame?.());
    expect(getButton('Change preview size').disabled).toBe(false);
    expect(container.querySelectorAll('[class*="cursor-"][aria-hidden]')).toHaveLength(3);
    expect(getButton('Device preview').disabled).toBe(false);
    await click('Device preview');
    expect(harness.setDevice).toHaveBeenLastCalledWith('exact-tab', 'owner', { enabled: false });
    await click('Device preview');
    expect(harness.setDevice).toHaveBeenLastCalledWith(
      'exact-tab',
      'owner',
      expect.objectContaining({ enabled: true })
    );
  });
  it('allows opening history pages while an agent retains the tab', async () => {
    await emit({ locked: true, holder, url: 'https://example.com/' });
    await click('Browsing history');
    expect(getButton('Open history page').disabled).toBe(false);
    await click('Open history page');
    expect(harness.navigate).toHaveBeenCalledWith('exact-tab', 'owner', 'https://history.example/');
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
  it('covers retained real pages only while an overlay intersects them', async () => {
    await emit({ locked: true, holder, url: 'https://example.com/' });
    await act(async () => harness.frame?.());
    expect(harness.setViewport).toHaveBeenLastCalledWith(
      'exact-tab',
      'owner',
      expect.any(Object),
      false
    );
    const overlay = document.createElement('div');
    overlay.setAttribute('data-slot', 'dialog-popup');
    document.body.append(overlay);
    await act(async () => harness.frame?.());
    expect(harness.setViewport).toHaveBeenLastCalledWith(
      'exact-tab',
      'owner',
      expect.any(Object),
      true
    );
    overlay.remove();
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
