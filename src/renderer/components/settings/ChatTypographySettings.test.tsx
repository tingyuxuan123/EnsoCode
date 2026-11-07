import { normalizeChatTypography } from '@shared/chatTypography';
import { parseHTML } from 'linkedom';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({ value: {} as unknown, update: vi.fn() }));
vi.mock('@/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('@/stores/settings', () => ({
  useSettingsStore: (select: (s: unknown) => unknown) =>
    select({ chatTypography: harness.value, setChatTypography: harness.update }),
}));
vi.mock('@/components/chat/Markdown', () => ({
  Markdown: ({ text }: { text: string }) => <span data-preview="">{text}</span>,
}));
vi.mock('@/components/ui/input', () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));
vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    variant: _variant,
    size: _size,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string; size?: string }) => (
    <button {...props}>{children}</button>
  ),
}));
vi.mock('@/components/ui/select', () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value: string;
    onValueChange: (value: string) => void;
    children: React.ReactNode;
  }) => (
    <select value={value} onChange={(event) => onValueChange(event.target.value)}>
      {children}
    </select>
  ),
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectValue: () => null,
  SelectPopup: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}));

const { ChatTypographySettings } = await import('./ChatTypographySettings');
let container: HTMLElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  const { window } = parseHTML('<html><body></body></html>');
  vi.stubGlobal('window', window);
  vi.stubGlobal('document', window.document);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  harness.value = normalizeChatTypography({ body: { fontSize: 24 } });
  harness.update.mockClear();
  container = document.createElement('div');
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});
describe('聊天排版设置', () => {
  it('五组独立控件、实时预览与恢复默认', async () => {
    await act(async () => root.render(<ChatTypographySettings />));
    expect(container.querySelectorAll('input[type=number]')).toHaveLength(5);
    expect(container.querySelectorAll('select')).toHaveLength(5);
    expect(
      container.querySelector('[data-chat-typography-preview]')?.getAttribute('style')
    ).toContain('--chat-body-scale:1.6');
    expect(container.querySelector('[data-preview]')).not.toBeNull();
    const reset = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Restore default typography'
    );
    expect(reset).toBeDefined();
    await act(async () => reset?.click());
    expect(harness.update).toHaveBeenCalledWith(normalizeChatTypography(undefined));
  });
});
