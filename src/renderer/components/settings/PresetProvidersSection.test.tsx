// @vitest-environment happy-dom
import type { ListModelsResult, ModelEntry, ModelProvider } from '@shared/types';
import { act, type ComponentProps, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PresetProvidersSection } from './PresetProvidersSection';

const h = vi.hoisted(() => ({
  state: {
    providers: [] as ModelProvider[],
    addProviders: vi.fn(),
    updateProvider: vi.fn(),
  },
  listModels: vi.fn(),
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
vi.mock('@/components/ui/button', () => ({
  Button: ({ children, disabled, onClick, ...rest }: ComponentProps<'button'>) => (
    <button type="button" disabled={disabled} onClick={onClick} {...rest}>
      {children}
    </button>
  ),
}));
vi.mock('@/components/ui/badge', () => ({
  Badge: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock('@/components/ui/switch', () => ({
  Switch: ({
    checked,
    onCheckedChange,
    ...rest
  }: ComponentProps<'button'> & {
    checked?: boolean;
    onCheckedChange?: (next: boolean) => void;
  }) => (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onCheckedChange?.(!checked)}
      {...rest}
    />
  ),
}));
vi.mock('@/components/ui/toast', () => ({ addToast: vi.fn() }));
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: { open?: boolean; children: ReactNode }) =>
    open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}));
vi.mock('@/components/ui/field', () => ({
  Field: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  FieldLabel: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock('@/components/ui/input', () => ({
  Input: (props: ComponentProps<'input'>) => <input {...props} />,
}));

let root: Root;
let container: HTMLDivElement;

const MAGPIE_BASE = 'http://127.0.0.1:3425/v1';

function magpieProvider(overrides: Partial<ModelProvider> = {}): ModelProvider {
  return {
    id: 'preset-magpie',
    name: 'Magpie',
    api: 'openai-completions',
    apiKey: 'magpie',
    baseUrl: MAGPIE_BASE,
    enabled: true,
    catalogId: 'magpie',
    models: [{ id: 'auto/deepseek-v4.1-flash', enabled: true }],
    ...overrides,
  };
}

function ok(models: Array<{ id: string }>): ListModelsResult {
  return { ok: true, models };
}

function buttons() {
  return [...container.querySelectorAll('button')];
}

function buttonByText(text: string) {
  return buttons().find((button) => button.textContent?.trim() === text);
}

async function render() {
  await act(async () => root.render(<PresetProvidersSection />));
}

async function click(element: HTMLElement | undefined) {
  if (!element) throw new Error('element not found');
  await act(async () => element.click());
}

beforeEach(() => {
  vi.resetAllMocks();
  h.state.providers = [];
  h.state.updateProvider.mockImplementation((id: string, patch: Partial<ModelProvider>) => {
    h.state.providers = h.state.providers.map((item) =>
      item.id === id ? { ...item, ...patch } : item
    );
  });
  h.state.addProviders.mockImplementation((incoming: ModelProvider[]) => {
    h.state.providers = [...h.state.providers, ...incoming];
    return incoming.length;
  });
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: { providers: { listModels: h.listModels } },
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

describe('预设服务商：启用', () => {
  it('未启用时显示「启用」按钮与默认地址', async () => {
    await render();
    expect(buttonByText('Enable')).toBeDefined();
    expect(container.textContent).toContain(MAGPIE_BASE);
  });

  it('拉取成功才落盘，条目带 catalogId、内置密钥与模型', async () => {
    h.listModels.mockResolvedValue(ok([{ id: 'a' }, { id: 'b' }]));
    await render();
    await click(buttonByText('Enable'));

    expect(h.listModels).toHaveBeenCalledWith({
      api: 'openai-completions',
      apiKey: 'magpie',
      baseUrl: MAGPIE_BASE,
    });
    expect(h.state.addProviders).toHaveBeenCalledTimes(1);
    const [incoming] = h.state.addProviders.mock.calls[0] as [ModelProvider[]];
    expect(incoming).toHaveLength(1);
    expect(incoming[0]).toMatchObject({
      catalogId: 'magpie',
      apiKey: 'magpie',
      baseUrl: MAGPIE_BASE,
      enabled: true,
    });
    expect(incoming[0].models.map((model: ModelEntry) => model.id)).toEqual(['a', 'b']);
  });

  it('拉取失败不落盘，并给出「本机服务未就绪」提示', async () => {
    h.listModels.mockResolvedValue({ ok: false, models: [], error: 'ECONNREFUSED' });
    await render();
    await click(buttonByText('Enable'));

    expect(h.state.addProviders).not.toHaveBeenCalled();
    expect(h.state.updateProvider).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Could not reach the local service');
  });

  it('返回 200 但清单为空同样不落盘 —— 空壳条目没有意义', async () => {
    h.listModels.mockResolvedValue(ok([]));
    await render();
    await click(buttonByText('Enable'));

    expect(h.state.addProviders).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Could not reach the local service');
  });

  it('已存在同端点同密钥的手动条目时复用它，不新增第二条', async () => {
    // 手动加的条目没有 catalogId，vendorOf 会分到 local 桶，applyIncomingProviders 合并不了
    h.state.providers = [
      magpieProvider({ id: 'manual-row', catalogId: undefined, enabled: false, models: [] }),
    ];
    h.listModels.mockResolvedValue(ok([{ id: 'a' }]));
    await render();
    // 该行仍按「未启用」渲染：catalogId 未标
    await click(buttonByText('Enable'));

    expect(h.state.addProviders).not.toHaveBeenCalled();
    expect(h.state.updateProvider).toHaveBeenCalledWith('manual-row', {
      catalogId: 'magpie',
      enabled: true,
      models: [{ id: 'a', enabled: true }],
    });
  });
});

describe('预设服务商：刷新', () => {
  it('上游少了一个模型时，刷新后该行从清单里消失', async () => {
    h.state.providers = [
      magpieProvider({
        models: [
          { id: 'kept', enabled: true },
          { id: 'retired', enabled: true },
        ],
      }),
    ];
    h.listModels.mockResolvedValue(ok([{ id: 'kept' }]));
    await render();
    await click(
      buttonByText('Refresh models') ??
        buttons().find((b) => b.getAttribute('aria-label') === 'Refresh models')
    );

    expect(h.state.updateProvider).toHaveBeenCalledWith('preset-magpie', {
      models: [{ id: 'kept', enabled: true }],
    });
  });

  it('刷新失败时清单保持原样，只显示错误', async () => {
    h.state.providers = [magpieProvider({ models: [{ id: 'kept', enabled: true }] })];
    h.listModels.mockResolvedValue({ ok: false, models: [], error: 'boom' });
    await render();
    await click(buttons().find((b) => b.getAttribute('aria-label') === 'Refresh models'));

    expect(h.state.updateProvider).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Could not reach the local service');
  });
});

describe('预设服务商：开关与端口', () => {
  it('开关直接翻转 enabled，不发请求', async () => {
    h.state.providers = [magpieProvider()];
    await render();
    await click(container.querySelector('[role="switch"]') as HTMLElement);

    expect(h.listModels).not.toHaveBeenCalled();
    expect(h.state.updateProvider).toHaveBeenCalledWith('preset-magpie', { enabled: false });
  });

  it('端口按钮显示当前端口', async () => {
    h.state.providers = [magpieProvider()];
    await render();
    expect(buttonByText(':3425')).toBeDefined();
  });

  it('改端口先按新地址拉通再保存，模型一并更新', async () => {
    h.state.providers = [magpieProvider({ models: [{ id: 'old', enabled: true }] })];
    h.listModels.mockResolvedValue(ok([{ id: 'fresh' }]));
    await render();
    await click(buttonByText(':3425'));

    const input = container.querySelector('input') as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, '3426');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click(buttonByText('Save'));

    expect(h.listModels).toHaveBeenCalledWith({
      api: 'openai-completions',
      apiKey: 'magpie',
      baseUrl: 'http://127.0.0.1:3426/v1',
    });
    expect(h.state.updateProvider).toHaveBeenCalledWith('preset-magpie', {
      baseUrl: 'http://127.0.0.1:3426/v1',
      apiKey: 'magpie',
      models: [{ id: 'fresh', enabled: true }],
    });
  });

  it('新端口拉不通时不保存，保留原地址', async () => {
    h.state.providers = [magpieProvider()];
    h.listModels.mockResolvedValue({ ok: false, models: [], error: 'ECONNREFUSED' });
    await render();
    await click(buttonByText(':3425'));

    const input = container.querySelector('input') as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, '3426');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click(buttonByText('Save'));

    expect(h.state.updateProvider).not.toHaveBeenCalled();
  });

  it('改端口时不把落盘的 secret 引用当密钥发出去', async () => {
    // 已落盘条目的 apiKey 是 Main 侧的 enso-secret 引用，绑定 scope 是 [api, baseUrl]；
    // 地址一变引用就失效，原样传回 IPC 只会得到 Invalid config。预设密钥固定，用内置值。
    h.state.providers = [magpieProvider({ apiKey: 'enso-secret:deadbeef' })];
    h.listModels.mockResolvedValue(ok([{ id: 'fresh' }]));
    await render();
    await click(buttonByText(':3425'));

    const input = container.querySelector('input') as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, '3426');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click(buttonByText('Save'));

    expect(h.listModels).toHaveBeenCalledWith({
      api: 'openai-completions',
      apiKey: 'magpie',
      baseUrl: 'http://127.0.0.1:3426/v1',
    });
    // 必须连 apiKey 一起写回明文：Main 用 [api, baseUrl] 当 secret 绑定 scope，
    // 只改地址会让旧引用失效，整次写入被拒（弹窗显示成功但磁盘没变）。
    expect(h.state.updateProvider).toHaveBeenCalledWith('preset-magpie', {
      baseUrl: 'http://127.0.0.1:3426/v1',
      apiKey: 'magpie',
      models: [{ id: 'fresh', enabled: true }],
    });
  });

  it('刷新时同样不使用落盘的 secret 引用', async () => {
    h.state.providers = [magpieProvider({ apiKey: 'enso-secret:deadbeef' })];
    h.listModels.mockResolvedValue(ok([{ id: 'kept' }]));
    await render();
    await click(buttons().find((b) => b.getAttribute('aria-label') === 'Refresh models'));

    expect(h.listModels).toHaveBeenCalledWith({
      api: 'openai-completions',
      apiKey: 'magpie',
      baseUrl: MAGPIE_BASE,
    });
  });
});
