// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ExtensionsPage } from './ExtensionsPage';

const fixture = vi.hoisted(() => ({
  stage: vi.fn(),
  checkUpdates: vi.fn(),
  setPluginAutoUpdate: vi.fn(),
  empty: false,
  nativeError: '',
  native: {
    id: 'enso.example.notes',
    name: 'Local Notes',
    version: '1.0.0',
    description: 'Local plugin',
    state: 'disabled',
    permissions: [],
    configurable: false,
    icon: 'icon.svg' as string | undefined,
  },
  asset: vi.fn(),
  updateSkill: vi.fn(),
  updateMcp: vi.fn(),
}));

vi.mock('@/i18n', () => ({ useI18n: () => ({ t: (key: string) => key, locale: 'en' }) }));
vi.mock('@/stores/settings', () => ({
  useSettingsStore: (select: (state: object) => unknown) =>
    select({
      skills: fixture.empty
        ? []
        : [
            {
              id: 'skill',
              name: 'review',
              description: 'Review code changes',
              path: '/example/skills/review',
              source: 'Local',
              enabled: true,
            },
          ],
      mcpServers: fixture.empty
        ? []
        : [
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
      plugins: fixture.empty
        ? []
        : [
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
      pluginAutoUpdate: false,
      setPluginAutoUpdate: fixture.setPluginAutoUpdate,
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
    plugins: fixture.empty ? [] : [fixture.native],
    available: true,
    canManage: true,
    busy: null,
    loading: false,
    error: fixture.nativeError,
    registryError: '',
    stage: fixture.stage,
    checkUpdates: fixture.checkUpdates,
  }),
}));
vi.mock('@/plugins/NativePluginFlows', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/plugins/NativePluginFlows')>()),
  NativePluginFlows: () => null,
}));
vi.mock('@/components/settings/LocalAssetImportDialog', () => ({
  LocalAssetImportDialog: ({ kind, open }: { kind: string; open?: boolean }) =>
    open ? <div data-kind={kind} data-slot="asset-import-dialog" /> : null,
}));
vi.mock('@/components/settings/McpEditDialog', () => ({
  McpEditDialog: ({ server }: { server: unknown }) => (
    <div data-server={server === 'new' ? 'new' : 'existing'} data-slot="mcp-edit-dialog" />
  ),
}));
vi.mock('@/components/settings/PluginMarket', () => ({
  PluginMarket: () => (
    <section data-slot="plugin-market">
      <h3>Plugin market</h3>
      <article data-slot="market-card">Community search</article>
    </section>
  ),
}));

let root: Root;
let container: HTMLDivElement;
const ICON_DATA = 'data:image/svg+xml;base64,PHN2Zy8+';
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.clearAllMocks();
  fixture.empty = false;
  fixture.nativeError = '';
  fixture.native.icon = 'icon.svg';
  fixture.native.state = 'disabled';
  fixture.asset.mockReset();
  fixture.asset.mockResolvedValue({
    ok: true,
    mime: 'image/svg+xml',
    base64: ICON_DATA.slice(ICON_DATA.indexOf(',') + 1),
  });
  Object.assign(window, {
    electronAPI: {
      extensionPlugins: { asset: fixture.asset },
      window: { openSettings: vi.fn() },
    },
  });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<ExtensionsPage onBack={() => {}} />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.replaceChildren();
  Reflect.deleteProperty(window, 'electronAPI');
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

it('旧安装深链在扩展页进入同一预览流程，重渲染不重复安装预览', async () => {
  const request = { serial: 1, pluginInstallUrl: 'https://example.test/plugin.zip' };
  await act(async () => root.render(<ExtensionsPage onBack={() => {}} request={request} />));
  expect(fixture.stage).toHaveBeenCalledExactlyOnceWith('url', request.pluginInstallUrl);
  await act(async () => root.render(<ExtensionsPage onBack={() => {}} request={request} />));
  expect(fixture.stage).toHaveBeenCalledTimes(1);
});

it('原生插件通知定位打开扩展详情，而不是 Claude Code 设置', async () => {
  await act(async () =>
    root.render(
      <ExtensionsPage onBack={() => {}} request={{ serial: 1, pluginId: fixture.native.id }} />
    )
  );
  expect(document.querySelector('[data-slot="sheet-popup"]')?.textContent).toContain('Local Notes');
  expect(fixture.stage).not.toHaveBeenCalled();
});

async function typeSearch(value: string) {
  const input = document.querySelector<HTMLInputElement>('input[aria-label="Search extensions"]')!;
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setValue.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

it('真正没有扩展时展示首个扩展引导，三个入口复用现有安装/导入动作', async () => {
  fixture.empty = true;
  await act(async () => root.render(<ExtensionsPage onBack={() => {}} />));
  expect(container.textContent).toContain('Add your first extension');
  expect(container.querySelector('[data-slot="extensions-empty"]')).not.toBeNull();
  await act(async () => button('Import skills').click());
  expect(
    container.querySelector('[data-slot="asset-import-dialog"]')?.getAttribute('data-kind')
  ).toBe('skill');
  await act(async () => button('Connect MCP').click());
  expect(
    container.querySelector('[data-slot="mcp-edit-dialog"]')?.getAttribute('data-server')
  ).toBe('new');
  await act(async () => button('Install plugin').click());
  expect(fixture.stage).toHaveBeenCalledWith('dir');
});

it('分类为空与搜索无结果提示不同，并能清除筛选回到首次空态', async () => {
  fixture.empty = true;
  await act(async () => root.render(<ExtensionsPage onBack={() => {}} />));
  await act(async () => button('MCP').click());
  expect(container.textContent).toContain('No extensions in this category');
  expect(container.textContent).not.toContain('Add your first extension');
  await act(async () => button('Show all extensions').click());
  expect(container.textContent).toContain('Add your first extension');

  await typeSearch('zzz');
  expect(container.textContent).toContain('No results');
  expect(container.textContent).not.toContain('Add your first extension');
  await act(async () => button('Clear search').click());
  expect(container.textContent).toContain('Add your first extension');
});

it('技能启停保存后在页面可见位置提示新会话生效，当前会话保持不变', async () => {
  const row = [
    ...container.querySelectorAll<HTMLButtonElement>('[data-slot="extension-item"]'),
  ].find((entry) => entry.textContent?.includes('review'))!;
  await act(async () => row.click());
  expect(container.textContent).not.toContain(
    'Changes apply to new conversations. The current conversation keeps what it already loaded.'
  );
  const toggle = document.querySelector<HTMLElement>('[role="switch"][aria-label="Enabled"]')!;
  await act(async () => toggle.click());
  expect(fixture.updateSkill).toHaveBeenCalledWith('skill', { enabled: false });
  expect(container.textContent).toContain(
    'Changes apply to new conversations. The current conversation keeps what it already loaded.'
  );
});

it('MCP 启停保存后同样提示新会话生效，不把启用说成已连接', async () => {
  const row = [
    ...container.querySelectorAll<HTMLButtonElement>('[data-slot="extension-item"]'),
  ].find((entry) => entry.textContent?.includes('Docs'))!;
  await act(async () => row.click());
  const toggle = document.querySelector<HTMLElement>('[role="switch"][aria-label="Enabled"]')!;
  await act(async () => toggle.click());
  expect(fixture.updateMcp).toHaveBeenCalledWith('mcp', { enabled: false });
  expect(container.textContent).toContain(
    'Changes apply to new conversations. The current conversation keeps what it already loaded.'
  );
  expect(document.querySelector('[data-slot="sheet-popup"]')?.textContent).not.toContain(
    'Connected'
  );
});

it('更多菜单保留检查插件更新和自动更新开关的真实能力', async () => {
  const more = document.querySelector<HTMLButtonElement>(
    'button[aria-label="More extension actions"]'
  )!;
  await act(async () => more.click());
  const check = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((entry) =>
    entry.textContent?.includes('Check plugin updates')
  )!;
  expect(check).toBeDefined();
  await act(async () => check.click());
  expect(fixture.checkUpdates).toHaveBeenCalledTimes(1);

  await act(async () => more.click());
  const autoUpdate = [...document.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"]')].find(
    (entry) => entry.textContent?.includes('Automatically update plugins')
  )!;
  expect(autoUpdate).toBeDefined();
  await act(async () => autoUpdate.click());
  expect(fixture.setPluginAutoUpdate.mock.calls[0]?.[0]).toBe(true);
});

const contentRegion = () =>
  container.querySelector<HTMLElement>('[data-slot="extensions-content"]')!;
const headerRegion = () => container.querySelector<HTMLElement>('[data-slot="extensions-header"]')!;
const itemRows = () => [...container.querySelectorAll<HTMLElement>('[data-slot="extension-item"]')];

it('打开插件市场后只显示市场内容，已安装管理工具栏、列表和空态不再堆在下面', async () => {
  await act(async () => button('Browse plugin market').click());
  expect(contentRegion().querySelector('[data-slot="plugin-market"]')).not.toBeNull();
  expect(container.textContent).toContain('Community search');
  expect(container.querySelector('input[aria-label="Search extensions"]')).toBeNull();
  expect(container.querySelector('[data-slot="tabs-list"]')).toBeNull();
  expect(itemRows()).toHaveLength(0);
  expect(container.querySelector('[data-slot="extensions-empty"]')).toBeNull();
  expect(container.querySelector('[data-slot="extension-notice"]')).toBeNull();

  await act(async () => button('Back to installed').click());
  expect(container.querySelector('[data-slot="plugin-market"]')).toBeNull();
  expect(itemRows()).toHaveLength(4);
  expect(container.querySelector('input[aria-label="Search extensions"]')).not.toBeNull();
});

it('没有已安装扩展时打开市场也不会冒出首个扩展空态', async () => {
  fixture.empty = true;
  await act(async () => root.render(<ExtensionsPage onBack={() => {}} />));
  expect(container.querySelector('[data-slot="extensions-empty"]')).not.toBeNull();
  await act(async () => button('Browse plugin market').click());
  expect(container.querySelector('[data-slot="extensions-empty"]')).toBeNull();
  expect(container.textContent).not.toContain('Add your first extension');
});

it('往返插件市场后已安装页的搜索词与分类筛选保持不变', async () => {
  await act(async () => button('Plugins').click());
  await typeSearch('Local');
  expect(itemRows()).toHaveLength(1);
  expect(itemRows()[0].textContent).toContain('Local Notes');

  await act(async () => button('Browse plugin market').click());
  await act(async () => button('Back to installed').click());

  const input = container.querySelector<HTMLInputElement>('input[aria-label="Search extensions"]');
  expect(input?.value).toBe('Local');
  expect(itemRows()).toHaveLength(1);
  expect(itemRows()[0].textContent).toContain('Local Notes');
});

it('切换市场与管理时把内容滚动位置归零，避免从市场底部回来看到空白', async () => {
  contentRegion().scrollTop = 320;
  expect(contentRegion().scrollTop).toBe(320);
  await act(async () => button('Browse plugin market').click());
  expect(contentRegion().scrollTop).toBe(0);
  contentRegion().scrollTop = 640;
  await act(async () => button('Back to installed').click());
  expect(contentRegion().scrollTop).toBe(0);
});

it('标题和顶部操作不在内容滚动区里，整页只有一个纵向滚动区', async () => {
  const scrollers = () =>
    [...container.querySelectorAll<HTMLElement>('*')]
      .filter((element) =>
        (element.getAttribute('class') ?? '')
          .split(/\s+/)
          .some(
            (name) =>
              name === 'overflow-y-auto' || name === 'overflow-y-scroll' || name === 'overflow-auto'
          )
      )
      .map((element) => element.getAttribute('data-slot'));
  expect(scrollers()).toEqual(['extensions-content']);
  expect(headerRegion().querySelector('h1')?.textContent).toBe('Extensions');
  expect(headerRegion().textContent).toContain('Add extension');
  expect(contentRegion().contains(headerRegion())).toBe(false);
  expect(contentRegion().contains(button('Add extension'))).toBe(false);

  await act(async () => button('Browse plugin market').click());
  expect(scrollers()).toEqual(['extensions-content']);
  expect(headerRegion().textContent).toContain('Back to installed');
  expect(contentRegion().querySelector('[data-slot="plugin-market"]')).not.toBeNull();
});

it('插件市场操作失败的提示在市场态仍然可见', async () => {
  fixture.nativeError = 'Could not reach plugin registry';
  await act(async () => root.render(<ExtensionsPage onBack={() => {}} />));
  await act(async () => button('Browse plugin market').click());
  expect(container.querySelector('[data-slot="plugin-market"]')).not.toBeNull();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    'Could not reach plugin registry'
  );
});

it('市场打开时收到插件定位请求会退出市场并直接打开该插件详情', async () => {
  await act(async () => button('Browse plugin market').click());
  expect(container.querySelector('[data-slot="plugin-market"]')).not.toBeNull();
  await act(async () =>
    root.render(
      <ExtensionsPage onBack={() => {}} request={{ serial: 1, pluginId: fixture.native.id }} />
    )
  );
  expect(container.querySelector('[data-slot="plugin-market"]')).toBeNull();
  expect(document.querySelector('[data-slot="sheet-popup"]')?.textContent).toContain('Local Notes');
  expect(fixture.stage).not.toHaveBeenCalled();
});

const rowOf = (name: string) =>
  itemRows().find((row) => row.textContent?.includes(name)) as HTMLElement;
const rowIconSrc = (name: string) =>
  rowOf(name).querySelector<HTMLImageElement>('[data-slot="plugin-icon"]')?.getAttribute('src') ??
  null;
const rerender = async () => act(async () => root.render(<ExtensionsPage onBack={() => {}} />));

it('原生插件列表用安装包里的清单图标，停用状态不依赖运行期也能读到', async () => {
  expect(fixture.native.state).toBe('disabled');
  expect(fixture.asset).toHaveBeenCalledWith(fixture.native.id, 'icon.svg');
  expect(rowIconSrc('Local Notes')).toBe(ICON_DATA);
  expect(rowOf('Local Notes').querySelector('[data-slot="plugin-icon-fallback"]')).toBeNull();
});

it('插件启用或崩溃后沿用同一图标，技能、MCP 和 Claude 插件不冒用原生图标', async () => {
  for (const state of ['enabled', 'crashed'] as const) {
    fixture.native.state = state;
    await rerender();
    expect(rowIconSrc('Local Notes')).toBe(ICON_DATA);
  }
  expect(fixture.asset.mock.calls.every(([id]) => id === fixture.native.id)).toBe(true);
  for (const name of ['review', 'Docs', 'Claude review']) {
    const row = rowOf(name);
    expect(row.querySelector('[data-slot="plugin-icon"]')).toBeNull();
    expect(row.querySelector('[data-slot="plugin-icon-fallback"]')).toBeNull();
    expect(row.querySelector('svg')).not.toBeNull();
  }
});

it('图标读取失败或类型不受支持时回退到默认图标，不渲染破图', async () => {
  fixture.native.icon = 'missing.svg';
  fixture.asset.mockResolvedValueOnce({ ok: false, error: '资源不存在' });
  await rerender();
  expect(rowIconSrc('Local Notes')).toBeNull();
  expect(rowOf('Local Notes').querySelector('[data-slot="plugin-icon-fallback"]')).not.toBeNull();

  fixture.native.icon = 'page.html';
  fixture.asset.mockResolvedValueOnce({ ok: true, mime: 'text/html', base64: 'PHNjcmlwdD4=' });
  await rerender();
  expect(rowIconSrc('Local Notes')).toBeNull();
  expect(rowOf('Local Notes').querySelector('[data-slot="plugin-icon-fallback"]')).not.toBeNull();
});

it('返回了图片 mime 但内容损坏时，图片 error 事件回退到默认图标', async () => {
  const img = rowOf('Local Notes').querySelector<HTMLImageElement>('[data-slot="plugin-icon"]')!;
  expect(img.getAttribute('src')).toBe(ICON_DATA);
  await act(async () => img.dispatchEvent(new Event('error')));
  expect(rowIconSrc('Local Notes')).toBeNull();
  expect(rowOf('Local Notes').querySelector('[data-slot="plugin-icon-fallback"]')).not.toBeNull();
});

it('清单没声明图标时不请求 asset，保持默认图标', async () => {
  fixture.native.icon = undefined;
  fixture.asset.mockClear();
  await rerender();
  expect(fixture.asset).not.toHaveBeenCalled();
  expect(rowIconSrc('Local Notes')).toBeNull();
  expect(rowOf('Local Notes').querySelector('[data-slot="plugin-icon-fallback"]')).not.toBeNull();
});

it('详情标题用同一 PluginIcon 渲染插件的真实图标', async () => {
  await act(async () => rowOf('Local Notes').click());
  const title = document.querySelector('[data-slot="sheet-title"]');
  const icon = title?.querySelector<HTMLImageElement>('[data-slot="plugin-icon"]');
  expect(icon?.getAttribute('src')).toBe(ICON_DATA);
  expect(fixture.asset).toHaveBeenCalledWith(fixture.native.id, 'icon.svg');
});

it('换图标后旧请求晚到不会覆盖当前图标', async () => {
  let resolveOld!: (value: { ok: true; mime: string; base64: string }) => void;
  fixture.asset.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveOld = resolve;
      })
  );
  fixture.native.icon = 'old.svg';
  await rerender();
  fixture.native.icon = 'new.svg';
  await rerender();
  expect(rowIconSrc('Local Notes')).toBe(ICON_DATA);

  await act(async () => resolveOld({ ok: true, mime: 'image/svg+xml', base64: 'T0xE' }));
  expect(rowIconSrc('Local Notes')).toBe(ICON_DATA);
});
