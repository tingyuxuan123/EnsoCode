import type { BrowserDevice, BrowserTabState } from '@shared/types/browser';
import { parseHTML } from 'linkedom';
import { act, type ComponentProps, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserDeviceToolbar } from './BrowserDeviceToolbar';

const t = (key: string, params?: Record<string, string | number>) =>
  params ? key.replace(/\{\{(\w+)\}\}/g, (_, token) => String(params[token])) : key;
vi.mock('@/i18n', () => ({ useI18n: () => ({ t }) }));
vi.mock('@/components/ui/button', () => ({
  Button: ({
    variant: _variant,
    size: _size,
    ...props
  }: ComponentProps<'button'> & { variant?: string; size?: string }) => <button {...props} />,
}));
vi.mock('@/components/ui/input', () => ({
  Input: ({
    onChange,
    size: _size,
    ...props
  }: Omit<ComponentProps<'input'>, 'size'> & { size?: string }) => (
    <input {...props} onInput={(event) => onChange?.({ ...event, target: event.currentTarget })} />
  ),
}));
vi.mock('@/components/ui/menu', () => {
  const Wrap = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    Menu: Wrap,
    MenuGroup: Wrap,
    MenuGroupLabel: Wrap,
    MenuPopup: Wrap,
    MenuTrigger: ({ children, ...props }: ComponentProps<'button'>) => (
      <button type="button" {...props}>
        {children}
      </button>
    ),
    MenuItem: ({ children, onClick }: { children?: ReactNode; onClick?: () => void }) => (
      <button type="button" data-menu-item="" onClick={onClick}>
        {children}
      </button>
    ),
  };
});
let root: Root;
let container: HTMLElement;
const initial: BrowserDevice = {
  enabled: true,
  profileId: 'responsive',
  width: 390,
  height: 844,
  deviceScaleFactor: 2,
  mobile: true,
  touch: true,
  orientation: 'portrait',
};
const apply = vi.fn();
const background = vi.fn();
async function render(device = initial, disabled = false, devtoolsOpen = false) {
  await act(async () =>
    root.render(
      <BrowserDeviceToolbar
        device={device}
        scale={0.84}
        disabled={disabled}
        devtoolsOpen={devtoolsOpen}
        background="default"
        onBackgroundChange={background}
        onApply={apply}
      />
    )
  );
}
function item(text: string) {
  const button = Array.from(container.querySelectorAll('[data-menu-item]')).find((entry) =>
    entry.textContent?.startsWith(text)
  ) as HTMLButtonElement | undefined;
  expect(button, text).toBeDefined();
  return button as HTMLButtonElement;
}
function input(label: string) {
  return container.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement;
}
async function type(label: string, value: string) {
  const field = input(label);
  await act(async () => {
    field.value = value;
    field.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
  await act(async () =>
    field
      .closest('form')
      ?.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))
  );
}
beforeEach(() => {
  const dom = parseHTML('<html><body><div id="root"></div></body></html>');
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', dom.document);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = dom.document.getElementById('root') as unknown as HTMLElement;
  root = createRoot(container);
  apply.mockReset().mockResolvedValue({ ok: true, result: {} as BrowserTabState });
  background.mockReset();
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

describe('inline device toolbar', () => {
  it('lists grouped presets with size and DPR, and applies the full preset', async () => {
    await render();
    for (const text of ['Phones', 'Foldable phones', 'Tablets', 'Desktop', '84%'])
      expect(container.textContent).toContain(text);
    expect(item('iPhone 16 Pro Max / 17 Pro Max').textContent).toContain('440 × 956');
    expect(item('Samsung Galaxy S20 Ultra').textContent).toContain('3.5');
    await act(async () => item('Pixel 9').click());
    expect(apply).toHaveBeenLastCalledWith(
      expect.objectContaining({
        enabled: true,
        profileId: 'pixel-9',
        width: 412,
        height: 924,
        deviceScaleFactor: 2.625,
        mobile: true,
      })
    );
  });
  it('commits typed dimensions as a custom viewport in the entered order', async () => {
    await render();
    await type('Viewport width', '1000');
    expect(apply).toHaveBeenLastCalledWith(
      expect.objectContaining({
        profileId: 'responsive',
        width: 1000,
        height: 844,
        orientation: 'landscape',
        deviceScaleFactor: 2,
      })
    );
  });
  it('does not call the host for unchanged or invalid dimensions', async () => {
    await render();
    await type('Viewport height', '844');
    expect(apply).not.toHaveBeenCalled();
    await type('Viewport width', '20');
    expect(apply).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });
  it('rotates by swapping dimensions and closes back to desktop', async () => {
    await render();
    await act(async () =>
      (container.querySelector('[aria-label="Rotate"]') as HTMLElement).click()
    );
    expect(apply).toHaveBeenLastCalledWith(
      expect.objectContaining({ width: 844, height: 390, orientation: 'landscape' })
    );
    await act(async () =>
      (container.querySelector('[aria-label="Close device preview"]') as HTMLElement).click()
    );
    expect(apply).toHaveBeenLastCalledWith({ enabled: false });
  });
  it('surfaces host failures and restores the authoritative size', async () => {
    apply.mockResolvedValueOnce({ ok: false, error: 'Device unavailable while DevTools is open' });
    await render();
    await type('Viewport width', '600');
    expect(container.textContent).toContain('Device unavailable while DevTools is open');
    expect(input('Viewport width').value).toBe('390');
  });
  it('sets preview scale and stage background without touching device size', async () => {
    await render();
    await act(async () => item('50%').click());
    expect(apply).toHaveBeenLastCalledWith(expect.objectContaining({ width: 390, scale: 0.5 }));
    await act(async () => item('Checkerboard').click());
    expect(background).toHaveBeenCalledWith('checker');
  });
  it('locks editing while the agent holds the tab', async () => {
    await render(initial, true);
    expect(input('Viewport width').disabled).toBe(true);
    expect(container.textContent).toContain('Take control before changing the device preview.');
  });
  it('locks metrics while DevTools holds CDP but still allows leaving the preview', async () => {
    await render(initial, false, true);
    expect(input('Viewport width').disabled).toBe(true);
    expect(container.textContent).toContain('Close DevTools to change the device preview.');
    const close = container.querySelector('[aria-label="Close device preview"]') as HTMLElement;
    expect((close as HTMLButtonElement).disabled).toBe(false);
    await act(async () => close.click());
    expect(apply).toHaveBeenLastCalledWith({ enabled: false });
  });
});
