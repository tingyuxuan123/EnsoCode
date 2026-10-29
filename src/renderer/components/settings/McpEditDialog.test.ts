import type { McpServerEntry } from '@shared/types';
import { parseHTML } from 'linkedom';
import { act, createContext, createElement, type ReactNode, useContext } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { McpEditDialog } from './McpEditDialog';

const harness = vi.hoisted(() => ({
  servers: [] as McpServerEntry[],
  addMcpServers: vi.fn(() => 1),
  updateMcpServer: vi.fn(),
  editor: { value: '', onChange: (_value: string) => {} },
}));

vi.mock('@/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('@/stores/settings', () => ({
  useSettingsStore: Object.assign(
    (selector: (state: unknown) => unknown) =>
      selector({
        mcpServers: harness.servers,
        addMcpServers: harness.addMcpServers,
        updateMcpServer: harness.updateMcpServer,
      }),
    { getState: () => ({ mcpServers: harness.servers }) }
  ),
}));
vi.mock('@/components/ui/dialog', () => {
  const Wrap = ({ children }: { children?: ReactNode }) => createElement('div', null, children);
  return {
    Dialog: Wrap,
    DialogContent: Wrap,
    DialogHeader: Wrap,
    DialogTitle: Wrap,
    DialogPanel: Wrap,
    DialogFooter: Wrap,
  };
});
vi.mock('@/components/ui/field', () => {
  const Wrap = ({ children }: { children?: ReactNode }) => createElement('div', null, children);
  return { Field: Wrap, FieldLabel: Wrap };
});
vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    onClick,
    disabled,
  }: {
    children?: ReactNode;
    onClick?: () => void;
    disabled?: boolean;
  }) => createElement('button', { type: 'button', onClick, disabled }, children),
}));
vi.mock('@/components/ui/input', () => ({
  Input: ({
    value,
    onChange,
  }: {
    value?: string;
    onChange?: (event: { target: { value: string } }) => void;
  }) => createElement('input', { value, onInput: onChange }),
}));
vi.mock('@/components/ui/textarea', () => ({ Textarea: () => null }));
vi.mock('@/components/ui/select', () => {
  const Wrap = ({ children }: { children?: ReactNode }) => createElement('div', null, children);
  return {
    Select: Wrap,
    SelectTrigger: Wrap,
    SelectValue: () => null,
    SelectPopup: Wrap,
    SelectItem: Wrap,
  };
});
vi.mock('@/components/ui/tabs', () => {
  const Change = createContext<(value: string) => void>(() => {});
  return {
    Tabs: ({
      children,
      onValueChange,
    }: {
      children?: ReactNode;
      onValueChange: (value: string) => void;
    }) => createElement(Change.Provider, { value: onValueChange }, children),
    TabsList: ({ children }: { children?: ReactNode }) => createElement('div', null, children),
    TabsTab: ({ children, value }: { children?: ReactNode; value: string }) => {
      const change = useContext(Change);
      return createElement('button', { type: 'button', onClick: () => change(value) }, children);
    },
  };
});
vi.mock('./CodeEditor', () => ({
  CodeEditor: (props: typeof harness.editor) => {
    harness.editor = props;
    return createElement('pre', { 'data-editor': true }, props.value);
  },
}));

const headers = { Authorization: 'Bearer fake-test-token', 'X-Test-Tenant': 'fake-tenant' };
const url = 'https://mcp.example.test/service';
type Transport = 'http' | 'sse';
function fixture(transport: Transport): McpServerEntry & { headers: Record<string, string> } {
  return {
    id: 'remote',
    name: 'Remote',
    transport,
    url,
    headers: { ...headers },
    source: 'manual',
    enabled: true,
  };
}

let root: Root | undefined;
beforeEach(() => {
  harness.servers = [];
  harness.addMcpServers.mockClear();
  harness.updateMcpServer.mockClear();
  harness.editor = { value: '', onChange: () => {} };
});
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  vi.unstubAllGlobals();
});

async function mount(server: McpServerEntry | 'new') {
  const dom = parseHTML('<html><body><div id="root"></div></body></html>');
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', dom.document);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  harness.servers = server === 'new' ? [] : [server];
  const container = dom.document.getElementById('root')!;
  root = createRoot(container);
  await act(async () => root?.render(createElement(McpEditDialog, { server, onClose: vi.fn() })));
  return {
    async click(label: string) {
      const button = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
        (node) => node.textContent === label
      );
      expect(button, `Missing ${label} button`).toBeDefined();
      expect(button?.disabled, `${label} must be enabled`).toBe(false);
      await act(async () => button?.click());
    },
    async json(value: object) {
      expect(container.querySelector('[data-editor]')).not.toBeNull();
      await act(async () => harness.editor.onChange(JSON.stringify(value)));
    },
    async name(value: string) {
      const input = container.querySelector('input')!;
      await act(async () => {
        input.value = value;
        input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
      });
    },
    spec: () => JSON.parse(harness.editor.value) as Record<string, unknown>,
  };
}

describe.each(['http', 'sse'] as const)('MCP %s 请求头编辑契约', (transport) => {
  it('打开 JSON 模式回显已有请求头', async () => {
    const ui = await mount(fixture(transport));
    await ui.click('JSON');
    expect(ui.spec()).toMatchObject({ type: transport, url, headers });
  });

  it('JSON 新建服务器时保存请求头', async () => {
    const ui = await mount('new');
    await ui.name('Remote');
    await ui.click('JSON');
    await ui.json({ type: transport, url, headers });
    await ui.click('Save');
    expect(harness.addMcpServers).toHaveBeenCalledWith([
      expect.objectContaining({ transport, url, headers }),
    ]);
  });

  it('JSON 编辑服务器时保存替换后的请求头', async () => {
    const ui = await mount(fixture(transport));
    const replacement = { Authorization: 'Bearer fake-replacement-token' };
    await ui.click('JSON');
    await ui.json({ type: transport, url, headers: replacement });
    await ui.click('Save');
    expect(harness.updateMcpServer).toHaveBeenCalledWith(
      'remote',
      expect.objectContaining({ transport, url, headers: replacement })
    );
  });

  it('格式化 JSON 后保留请求头', async () => {
    const ui = await mount(fixture(transport));
    await ui.click('JSON');
    await ui.json({ type: transport, url, headers });
    await ui.click('Format');
    expect(ui.spec()).toMatchObject({ type: transport, url, headers });
  });

  it('JSON → 表单 → JSON 切换保留请求头', async () => {
    const ui = await mount(fixture(transport));
    await ui.click('JSON');
    await ui.json({ type: transport, url, headers });
    await ui.click('Form');
    await ui.click('JSON');
    expect(ui.spec()).toMatchObject({ type: transport, url, headers });
  });

  it('JSON 切换为表单后保存仍保留请求头', async () => {
    const ui = await mount(fixture(transport));
    await ui.click('JSON');
    await ui.json({ type: transport, url, headers });
    await ui.click('Form');
    await ui.click('Save');
    expect(harness.updateMcpServer).toHaveBeenCalledWith(
      'remote',
      expect.objectContaining({ transport, url, headers })
    );
  });

  it('JSON 删除请求头后确实清除旧凭据', async () => {
    const original = fixture(transport);
    const ui = await mount(original);
    await ui.click('JSON');
    await ui.json({ type: transport, url });
    await ui.click('Save');
    expect(harness.updateMcpServer).toHaveBeenCalledOnce();
    const [id, patch] = harness.updateMcpServer.mock.calls[0] as unknown as [
      string,
      Partial<McpServerEntry> & { headers?: Record<string, string> },
    ];
    expect(id).toBe(original.id);
    // The settings store merges patches: merely omitting headers leaves old credentials in place.
    expect({ ...original, ...patch }.headers).toBeUndefined();
  });
});
