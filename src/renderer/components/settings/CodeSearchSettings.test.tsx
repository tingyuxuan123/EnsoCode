import type { OauthCredentialAvailability } from '@shared/defaultModel';
import type { OauthProviderInfo } from '@shared/types';
import { parseHTML } from 'linkedom';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CodeSearchSettings } from './CodeSearchSettings';

const harness = vi.hoisted(() => ({
  selected: null as string | null,
  snapshot: { revision: 1, availability: { status: 'unloaded' } as OauthCredentialAvailability },
  set: vi.fn(),
  list: vi.fn(),
  open: vi.fn(),
  select: undefined as ((value: string | null) => void) | undefined,
}));
vi.mock('@/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('@/stores/settings', () => ({
  useSettingsStore: (selector: (state: unknown) => unknown) =>
    selector({
      codeSearchAccountKey: harness.selected,
      setCodeSearchAccountKey: harness.set,
    }),
}));
vi.mock('@/stores/oauthCredentials', () => ({
  useOauthCredentialStore: (selector: (state: unknown) => unknown) =>
    selector({ snapshot: harness.snapshot }),
}));
vi.mock('@/components/ui/select', () => {
  const Wrap = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    Select: ({
      value,
      onValueChange,
      children,
    }: {
      value: string;
      onValueChange: typeof harness.select;
      children: ReactNode;
    }) => {
      harness.select = onValueChange;
      return <div data-selected={value}>{children}</div>;
    },
    SelectTrigger: Wrap,
    SelectPopup: Wrap,
    SelectValue: () => null,
    SelectItem: ({ value, children }: { value: string; children: ReactNode }) => (
      <div data-account={value}>{children}</div>
    ),
  };
});
vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick }: { children: ReactNode; onClick: () => void }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
}));

let root: Root;
let container: HTMLElement;
const infos: OauthProviderInfo[] = [
  {
    id: 'devin',
    name: 'Devin',
    supportsMultipleAccounts: true,
    models: [],
    accounts: [
      { key: 'devin', providerId: 'devin', email: 'devin@example.test' },
      { key: 'anthropic', providerId: 'anthropic', email: 'other@example.test' },
    ],
  },
];
beforeEach(() => {
  const dom = parseHTML('<html><body><div id="root"></div></body></html>');
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', dom.document);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  Object.assign(dom.window, {
    electronAPI: { providers: { listOauth: harness.list }, window: { openSettings: harness.open } },
  });
  container = dom.document.getElementById('root') as unknown as HTMLElement;
  root = createRoot(container);
  harness.selected = null;
  harness.snapshot = {
    revision: 1,
    availability: { status: 'ready', authenticatedAccountKeys: new Set(['devin', 'anthropic']) },
  };
  harness.set.mockReset();
  harness.open.mockReset();
  harness.list.mockReset().mockResolvedValue(infos);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});
const render = () => act(async () => root.render(<CodeSearchSettings />));

describe('代码搜索设置', () => {
  it('仅列出既有 Devin 账号，展示云端与硬编码秘密风险以及新会话生效说明', async () => {
    await render();
    expect(container.querySelector('[data-account="devin"]')).not.toBeNull();
    expect(container.textContent).not.toContain('other@example.test');
    expect(container.textContent).toContain('hardcoded secrets');
    expect(container.textContent).toContain(
      'queries, directory information and selected code snippets'
    );
    expect(container.textContent).toContain('new conversations');
    expect(harness.set).not.toHaveBeenCalled();
    await act(async () => harness.select?.('devin'));
    expect(harness.set).toHaveBeenCalledWith('devin');
    await act(async () => container.querySelector('button')?.click());
    expect(harness.open).toHaveBeenCalledWith({ category: 'providers', rowId: 'providers.root' });
  });

  it('所选账号失效不自动切到另一个账号，并明确提示', async () => {
    harness.selected = 'devin#2';
    await render();
    expect(container.querySelector('[data-selected="devin#2"]')).not.toBeNull();
    expect(container.textContent).toContain('selected Devin account is unavailable');
    expect(harness.set).not.toHaveBeenCalled();
  });

  it('凭证未就绪及列表请求失败均明确提示且不改账号', async () => {
    harness.snapshot = { revision: 2, availability: { status: 'loading' } };
    await render();
    expect(container.textContent).toContain('Loading');
    harness.snapshot = {
      revision: 3,
      availability: { status: 'ready', authenticatedAccountKeys: new Set(['devin']) },
    };
    harness.list.mockRejectedValueOnce(new Error('offline'));
    await render();
    expect(container.textContent).toContain('Could not load Devin accounts');
    expect(harness.set).not.toHaveBeenCalled();
  });
});
