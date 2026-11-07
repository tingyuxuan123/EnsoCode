// @vitest-environment happy-dom
import type { ListModelsResult, ModelEntry, ModelProvider } from '@shared/types';
import { act, type ComponentProps, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProvidersSettings } from './ProvidersSettings';

const h = vi.hoisted(() => ({
  state: {
    providers: [] as ModelProvider[],
    updateProvider: vi.fn(),
    addProviders: vi.fn(),
    removeProvider: vi.fn(),
  },
  listModels: vi.fn(),
  modelMeta: vi.fn(),
}));
vi.mock('@/i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string | number>) =>
      key.replace(/\{\{(\w+)\}\}/g, (_, token) => String(params?.[token] ?? token)),
  }),
}));
vi.mock('@/stores/settings', () => ({
  useSettingsStore: Object.assign(
    (selector: (state: typeof h.state) => unknown) => selector(h.state),
    { getState: () => h.state }
  ),
}));
vi.mock('@/stores/modelDirectory/useProviders', () => ({
  useMaterializedProviders: () => h.state.providers,
}));
vi.mock('@/stores/oauthCredentials', () => ({
  useOauthCredentialStore: (selector: (state: unknown) => unknown) =>
    selector({ snapshot: { revision: 1 } }),
}));
vi.mock('@/hooks/useAccountUsage', () => ({ useCachedAccountUsage: () => null }));
vi.mock('@/components/oauth/OauthCredentialBootstrap', () => ({
  refreshOauthCredentialState: vi.fn(),
}));
vi.mock('@/components/ui/button', () => ({
  Button: ({ children, disabled, onClick }: ComponentProps<'button'>) => (
    <button type="button" disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
}));
vi.mock('@/components/ui/badge', () => ({
  Badge: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock('@/components/ui/switch', () => ({ Switch: () => null }));
vi.mock('@/components/chat/ConfirmDialog', () => ({ ConfirmDialog: () => null }));
vi.mock('./DefaultModelPicker', () => ({ DefaultModelPicker: () => null }));
vi.mock('./VirtualModelsSettings', () => ({ VirtualModelsSettings: () => null }));
vi.mock('./TitleSummaryPicker', () => ({ TitleSummaryPicker: () => null }));
vi.mock('./ApprovalReviewerPicker', () => ({ ApprovalReviewerPicker: () => null }));
vi.mock('./SubagentModelsSettings', () => ({ SubagentModelsSettings: () => null }));
vi.mock('./LocalImportDialog', () => ({ LocalImportDialog: () => null }));
vi.mock('./ProviderSetupWizard', () => ({ ProviderSetupWizard: () => null }));
vi.mock('./ProviderEditDialog', () => ({ ProviderEditDialog: () => null }));
vi.mock('./NewSessionBadge', () => ({ NewSessionBadge: () => null }));
vi.mock('./OauthProvidersDialog', () => ({ AccountUsageBlock: () => null }));

let root: Root;
let container: HTMLDivElement;

function apiProvider(id: string): ModelProvider {
  return {
    id,
    name: id,
    api: 'openai-completions',
    apiKey: `enso-secret:${id}`,
    baseUrl: `https://${id}.example`,
    enabled: true,
    models: [],
  };
}

function refreshButton() {
  return [...container.querySelectorAll('button')].find((button) =>
    button.textContent?.includes('Refresh all models')
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  h.state.providers = [];
  h.state.updateProvider.mockImplementation((id: string, patch: { models: ModelEntry[] }) => {
    h.state.providers = h.state.providers.map((item) =>
      item.id === id ? { ...item, ...patch } : item
    );
  });
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: {
      providers: { listModels: h.listModels, modelMeta: h.modelMeta, listOauth: async () => [] },
    },
  });
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('模型中心批量刷新入口', () => {
  it('没有供应商时头部按钮禁用', async () => {
    await act(async () => root.render(<ProvidersSettings />));
    expect(refreshButton()).toBeDefined();
    expect(refreshButton()?.disabled).toBe(true);
  });

  it('执行中禁用且防重复请求，完成后显示每项结果及成功失败汇总', async () => {
    h.state.providers = [apiProvider('good'), apiProvider('bad')];
    let finish!: (value: ListModelsResult) => void;
    const pending = new Promise<ListModelsResult>((resolve) => {
      finish = resolve;
    });
    h.listModels.mockImplementation(({ apiKey }: { apiKey: string }) =>
      apiKey === 'enso-secret:good'
        ? pending
        : Promise.resolve({ ok: false, models: [], error: 'Denied' })
    );
    await act(async () => root.render(<ProvidersSettings />));
    expect(refreshButton()?.disabled).toBe(false);
    await act(async () => {
      refreshButton()?.click();
      refreshButton()?.click();
    });
    expect(h.listModels).toHaveBeenCalledTimes(2);
    expect(refreshButton()?.disabled).toBe(true);
    expect(container.querySelector('[data-settings-row="providers.bad"]')?.textContent).toContain(
      'Model refresh failed: Denied'
    );
    await act(async () => finish({ ok: true, models: [{ id: 'new' }] }));
    expect(refreshButton()?.disabled).toBe(false);
    expect(container.querySelector('[data-settings-row="providers.good"]')?.textContent).toContain(
      'Fetched 1 models'
    );
    expect(container.textContent).toContain('Model refresh: 1 succeeded, 1 failed, 0 skipped');
  });
});
