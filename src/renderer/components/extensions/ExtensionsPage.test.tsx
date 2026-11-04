// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ExtensionsPage } from './ExtensionsPage';

const fixture = vi.hoisted(() => ({
  stage: vi.fn(),
  native: {
    id: 'enso.example.notes',
    name: 'Local Notes',
    version: '1.0.0',
    description: 'Local plugin',
    state: 'disabled',
    permissions: [],
    configurable: false,
  },
  updateSkill: vi.fn(),
  updateMcp: vi.fn(),
}));

vi.mock('@/i18n', () => ({ useI18n: () => ({ t: (key: string) => key, locale: 'en' }) }));
vi.mock('@/stores/settings', () => ({
  useSettingsStore: (select: (state: object) => unknown) =>
    select({
      skills: [
        {
          id: 'skill',
          name: 'review',
          description: 'Review code changes',
          path: '/example/skills/review',
          source: 'Local',
          enabled: true,
        },
      ],
      mcpServers: [
        {
          id: 'mcp',
          name: 'Docs',
          description: 'Project docs',
          source: 'Manual',
          transport: 'http',
          url: 'https://user:password-secret@example.test/mcp?token=query-secret',
          env: { TOKEN: 'env-secret' },
          headers: { Authorization: 'header-secret' },
          enabled: true,
        },
      ],
      plugins: [
        {
          id: 'claude',
          key: 'review@example',
          name: 'Claude review',
          source: 'Claude Code',
          enabled: true,
        },
      ],
      updateSkill: fixture.updateSkill,
      updateMcpServer: fixture.updateMcp,
      setPluginEnabled: vi.fn(),
      removeSkill: vi.fn(),
      removeMcpServer: vi.fn(),
    }),
}));
vi.mock('@/stores/mcpStatus', () => {
  const state = {
    statuses: {},
    authorized: {},
    pending: {},
    bind: () => () => {},
    authorize: vi.fn(),
    revoke: vi.fn(),
  };
  const useMcpStatusStore = Object.assign((select: (state: object) => unknown) => select(state), {
    getState: () => state,
  });
  return { useMcpStatusStore };
});
vi.mock('@/plugins/useNativePluginManager', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/plugins/useNativePluginManager')>()),
  useNativePluginManager: () => ({
    plugins: [fixture.native],
    available: true,
    canManage: true,
    busy: null,
    loading: false,
    error: '',
    registryError: '',
    stage: fixture.stage,
  }),
}));
vi.mock('@/plugins/NativePluginFlows', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/plugins/NativePluginFlows')>()),
  NativePluginFlows: () => null,
}));
vi.mock('@/components/settings/LocalAssetImportDialog', () => ({
  LocalAssetImportDialog: () => null,
}));
vi.mock('@/components/settings/McpEditDialog', () => ({ McpEditDialog: () => null }));

let root: Root;
let container: HTMLDivElement;
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.clearAllMocks();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<ExtensionsPage onBack={() => {}} />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

function button(text: string): HTMLButtonElement {
  const match = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (entry) => entry.textContent?.trim() === text
  );
  if (!match) throw new Error(`Button not found: ${text}`);
  return match;
}

it('统一显示已注册技能、MCP、原生插件和 Claude Code 插件，分类筛选作用于真实目录', async () => {
  expect(container.querySelectorAll('[data-slot="extension-item"]')).toHaveLength(4);
  await act(async () => button('Plugins').click());
  const rows = [...container.querySelectorAll('[data-slot="extension-item"]')];
  expect(rows).toHaveLength(2);
  expect(rows.every((row) => row.getAttribute('data-kind') === 'plugin')).toBe(true);
  expect(container.textContent).toContain('Local Notes');
  expect(container.textContent).toContain('Claude review');
  expect(container.textContent).not.toContain('Project docs');
});

it('MCP 详情只展示用途和状态，不泄漏 URL 凭证、请求头或环境变量', async () => {
  const docs = [
    ...container.querySelectorAll<HTMLButtonElement>('[data-slot="extension-item"]'),
  ].find((entry) => entry.textContent?.includes('Docs'))!;
  await act(async () => docs.click());
  expect(document.body.textContent).toContain('Not connected');
  for (const value of ['password-secret', 'query-secret', 'env-secret', 'header-secret']) {
    expect(document.body.innerHTML).not.toContain(value);
  }
  expect(document.querySelector('[data-slot="sheet-popup"]')?.textContent).toContain(
    'Project docs'
  );
});

it('文件夹和 ZIP 安装都进入原有预览流程', async () => {
  await act(async () => button('Add extension').click());
  const folder = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((entry) =>
    entry.textContent?.includes('Install plugin from folder')
  )!;
  expect(folder).toBeDefined();
  await act(async () => folder.click());
  expect(fixture.stage).toHaveBeenCalledWith('dir');
  await act(async () => button('Add extension').click());
  const zip = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((entry) =>
    entry.textContent?.includes('Install plugin from ZIP')
  )!;
  await act(async () => zip.click());
  expect(fixture.stage).toHaveBeenCalledWith('zip');
});

it('作者指南展示本地模板和校验命令，不触发安装', async () => {
  await act(async () => button('Add extension').click());
  const guide = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((entry) =>
    entry.textContent?.includes('Build your own plugin')
  );
  expect(guide).toBeDefined();
  await act(async () => guide?.click());
  expect(document.body.textContent).toContain('pnpm plugin:init');
  expect(document.body.textContent).toContain('pnpm plugin:validate');
  expect(document.body.textContent).toContain('Enable it explicitly');
  expect(fixture.stage).not.toHaveBeenCalled();
});

it('链接安装先收集地址，不接受明文 HTTP 和带凭证的地址', async () => {
  await act(async () => button('Add extension').click());
  await act(async () =>
    document.querySelector<HTMLElement>('[data-install-source="url"]')?.click()
  );
  const input = document.querySelector<HTMLInputElement>('input[aria-label="Plugin URL"]')!;
  const preview = button('Preview URL');
  const inputValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  async function type(value: string) {
    await act(async () => {
      inputValue.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
  await type('http://example.test/plugin.zip');
  expect(preview.disabled).toBe(true);
  await type('https://user:pass@example.test/plugin.zip');
  expect(preview.disabled).toBe(true);
  await type('https://example.test/plugin.zip');
  expect(preview.disabled).toBe(false);
  expect(fixture.stage).not.toHaveBeenCalled();
  await act(async () => preview.click());
  expect(fixture.stage).toHaveBeenCalledExactlyOnceWith('url', 'https://example.test/plugin.zip');
});
