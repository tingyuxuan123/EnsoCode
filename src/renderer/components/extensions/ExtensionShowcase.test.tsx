// @vitest-environment happy-dom
import type {
  ExtensionPluginMarketEntry,
  ExtensionPluginReadmeResult,
  ExtensionPluginSummary,
} from '@shared/extensionPlugins/types';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PLUGIN_TRUST_WARNING } from '@/plugins/NativePluginFlows';
import { useNativePluginManager } from '@/plugins/useNativePluginManager';
import { ExtensionShowcase, type ExtensionShowcaseProps } from './ExtensionShowcase';

const language = vi.hoisted(() => ({ locale: 'en' as 'en' | 'zh' }));
vi.mock('@/i18n', async () => {
  const { translate } = await import('@shared/i18n');
  return {
    useI18n: () => ({
      locale: language.locale,
      t: (key: string, params?: Record<string, string | number>) =>
        translate(language.locale, key, params),
    }),
  };
});
vi.mock('@/components/settings/PluginModelConfigField', () => ({
  PluginModelConfigField: () => null,
}));

const api = {
  list: vi.fn(),
  onChanged: vi.fn(),
  marketStage: vi.fn(),
  stageFromUrl: vi.fn(),
  commit: vi.fn(),
  discard: vi.fn(),
  readme: vi.fn(),
  setCrossSessionInject: vi.fn(),
};
const onManageInstalled = vi.fn();

const paper: ExtensionPluginMarketEntry = {
  id: 'collabra.paper',
  name: 'Paper',
  description: 'A clean reading surface.',
  tier: 'community',
  tags: ['quiet'],
  category: 'themes',
  latest: '2.1.0',
  permissions: ['app.theme'],
  compatibility: { minAppVersion: '0.2.100', testedSurfaces: ['desktop'] },
  updateAvailable: false,
};
const local: ExtensionPluginSummary = {
  id: 'local.notes',
  name: 'Local Notes',
  description: 'Notes on this device.',
  version: '1.0.0',
  build: 'installed-build',
  source: { kind: 'dir' },
  state: 'crashed',
  configurable: true,
  permissions: ['agent.tool'],
  hasRenderer: false,
  tools: [{ name: 'notes', description: 'Look up notes' }],
  views: [],
  commands: [],
  fileViewers: [],
  statusItems: [],
  themes: [],
  triggers: [],
  presets: [],
};

function Harness({
  entry,
  documentationReady,
}: Pick<ExtensionShowcaseProps, 'entry' | 'documentationReady'>) {
  const manager = useNativePluginManager();
  return (
    <div data-slot="extension-showcase-scroll">
      <ExtensionShowcase
        entry={entry}
        manager={manager}
        onManageInstalled={onManageInstalled}
        documentationReady={documentationReady}
      />
      <output>{manager.preview ? `Pending review: ${manager.preview.name}` : ''}</output>
    </div>
  );
}

let root: Root;
let container: HTMLDivElement;

async function render(entry: ExtensionShowcaseProps['entry'], documentationReady?: boolean) {
  await act(async () =>
    root.render(<Harness entry={entry} documentationReady={documentationReady} />)
  );
}

function button(name: string) {
  const match = [...container.querySelectorAll('button')].find(
    (item) => item.textContent === name || item.getAttribute('aria-label') === name
  );
  if (!match) throw new Error(`Missing button: ${name}`);
  return match;
}

const text = () => container.textContent ?? '';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('electronAPI', { extensionPlugins: api });
  vi.resetAllMocks();
  language.locale = 'en';
  api.list.mockResolvedValue({ plugins: [] });
  api.onChanged.mockReturnValue(() => {});
  api.discard.mockResolvedValue({ ok: true });
  api.readme.mockResolvedValue({ ok: true, text: '' });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it('shows actions immediately while opening, and requests and parses documentation only once ready', async () => {
  const entry = { kind: 'market', plugin: paper } as const;
  api.readme.mockResolvedValue({ ok: true, text: '### Extension manual' });
  await render(entry, false);
  expect(text()).toContain('Paper');
  expect(button('Install').disabled).toBe(false);
  expect(button('Permissions & data access')).not.toBeNull();
  expect(api.readme).not.toHaveBeenCalled();
  expect([...container.querySelectorAll('h3')].map((node) => node.textContent)).not.toContain(
    'Extension manual'
  );
  await render(entry, true);
  expect(api.readme).toHaveBeenCalledExactlyOnceWith({ id: paper.id, from: 'market' });
  expect([...container.querySelectorAll('h3')].map((node) => node.textContent)).toContain(
    'Extension manual'
  );
});

it('stages the signed market package for review and does not commit or install by URL', async () => {
  const staging = deferred<object>();
  api.marketStage.mockReturnValue(staging.promise);
  await render({ kind: 'market', plugin: paper });
  await act(async () => button('Install').click());
  expect(button('Install').disabled).toBe(true);
  await act(async () =>
    staging.resolve({ ok: true, preview: { token: 'preview', name: 'Paper' } })
  );
  expect(api.marketStage).toHaveBeenCalledExactlyOnceWith('collabra.paper');
  expect(text()).toContain('Pending review: Paper');
  expect(api.commit).not.toHaveBeenCalled();
  expect(api.stageFromUrl).not.toHaveBeenCalled();
});

it.each(['catalog', 'installed registry'] as const)(
  'blocks overwriting another source reported by the %s, even with an update flagged',
  async (reportedBy) => {
    if (reportedBy === 'installed registry') {
      api.list.mockResolvedValue({ plugins: [{ ...local, id: paper.id }] });
    }
    await render({
      kind: 'market',
      plugin: {
        ...paper,
        installedSource: reportedBy === 'catalog' ? 'other' : undefined,
        updateAvailable: true,
      },
    });
    const action = button('Installed from another source');
    expect(action.disabled).toBe(true);
    await act(async () => action.click());
    expect(text()).toContain('cross-market migration is not supported yet');
    expect(api.marketStage).not.toHaveBeenCalled();
    expect(api.commit).not.toHaveBeenCalled();
  }
);

it('does not let the catalog stage from a read-only registry', async () => {
  api.list.mockResolvedValue({ plugins: [], registryError: 'Registry is damaged' });
  await render({ kind: 'market', plugin: paper });
  const action = button('Install');
  expect(action.disabled).toBe(true);
  await act(async () => action.click());
  expect(api.marketStage).not.toHaveBeenCalled();
});

it('opens a dedicated permissions page, distinguishes pending scopes, and restores the overview', async () => {
  await render({
    kind: 'installed',
    plugin: { ...local, pendingVersion: '1.1.0', pendingPermissions: ['agent.observe'] },
  });
  expect(text()).toContain('Plugin crashed');
  expect(text()).toContain('Pending permission approval');
  const action = button('Permissions & data access');
  const scroller = container.querySelector<HTMLElement>('[data-slot="extension-showcase-scroll"]')!;
  scroller.scrollTop = 112;
  expect(text()).not.toContain(PLUGIN_TRUST_WARNING);
  await act(async () => action.click());
  const permissions = container.querySelector('[data-slot="extension-permissions-page"]');
  expect(permissions?.textContent).toContain(PLUGIN_TRUST_WARNING);
  expect(permissions?.textContent).toContain('agent.tool');
  expect(permissions?.textContent).not.toContain('agent.observe');
  expect(container.querySelector('[data-extension-overview]')?.hasAttribute('hidden')).toBe(true);
  expect(scroller.scrollTop).toBe(0);
  await act(async () => button('Pending version 1.1.0').click());
  expect(permissions?.textContent).toContain('agent.observe');
  expect(permissions?.textContent).not.toContain('agent.tool');
  await act(async () => button('Back to extension details').click());
  expect(container.querySelector('[data-slot="extension-permissions-page"]')).toBeNull();
  expect(container.querySelector('[data-extension-overview]')?.hasAttribute('hidden')).toBe(false);
  expect(scroller.scrollTop).toBe(112);
  expect(document.activeElement).toBe(action);
  await act(async () => button('Review update permissions').click());
  expect(onManageInstalled).toHaveBeenCalledExactlyOnceWith('local.notes');
});

it('shows the requested update version without exposing the installed permission controls', async () => {
  api.list.mockResolvedValue({
    plugins: [
      {
        ...local,
        id: paper.id,
        source: { kind: 'market', marketId: 'collabra' },
        permissions: ['agent.inject'],
      },
    ],
  });
  await render({ kind: 'market', plugin: { ...paper, updateAvailable: true } });
  await act(async () => button('Permissions & data access').click());
  const permissions = container.querySelector('[data-slot="extension-permissions-page"]');
  expect(permissions?.textContent).toContain(paper.latest);
  expect(permissions?.textContent).toContain('app.theme');
  expect(permissions?.textContent).not.toContain('agent.inject');
  expect(permissions?.querySelector('[role="switch"]')).toBeNull();
  expect(api.setCrossSessionInject).not.toHaveBeenCalled();
});

it('keeps a plugin error out of the reading flow until asked, and can copy the full trace', async () => {
  const clipboard = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: clipboard } });
  const message =
    'llmdoc 输出超过 48 KiB；请缩小搜索范围或拆分过长文档。\n    at file:///plugin/main.mjs:444:25';
  await render({
    kind: 'installed',
    plugin: { ...local, lastError: { at: Date.UTC(2026, 10, 24, 13, 49), message } },
  });
  expect(text()).toContain('The plugin reported an error');
  expect(container.querySelector('pre')).toBeNull();
  expect(container.querySelector('[role="alert"]')).toBeNull();
  await act(async () => button('Show details').click());
  expect(container.querySelector('pre')?.textContent).toContain(
    'at file:///plugin/main.mjs:444:25'
  );
  await act(async () => button('Copy error').click());
  expect(clipboard).toHaveBeenCalledExactlyOnceWith(message);
  await act(async () => button('Hide details').click());
  expect(container.querySelector('pre')).toBeNull();
});

it('keeps the existing user confirmation for enabling cross-session access', async () => {
  const confirm = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
  vi.stubGlobal('confirm', confirm);
  api.setCrossSessionInject.mockResolvedValue({ ok: true });
  await render({
    kind: 'installed',
    plugin: {
      ...local,
      state: 'enabled',
      permissions: ['agent.inject'],
      crossSessionInject: false,
    },
  });
  await act(async () => button('Permissions & data access').click());
  const control = container.querySelector<HTMLInputElement>(
    '[data-slot="extension-permissions-page"] input[type="checkbox"]'
  );
  expect(control).not.toBeNull();
  await act(async () => control?.click());
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(api.setCrossSessionInject).not.toHaveBeenCalled();
  await act(async () => control?.click());
  expect(api.setCrossSessionInject).toHaveBeenCalledExactlyOnceWith(local.id, true);
});

it('reads the exact selected source, ignores late content, and retries a rejected request', async () => {
  const stale = deferred<ExtensionPluginReadmeResult>();
  api.readme
    .mockReturnValueOnce(stale.promise)
    .mockRejectedValueOnce(new Error('Offline'))
    .mockResolvedValueOnce({
      ok: true,
      text: '## Local guide\n\n<script>alert(1)</script>\n\n![Not an index image](https://example.com/raw.png)',
    });
  await render({ kind: 'market', plugin: paper });
  const screenshot = { url: 'https://example.com/signed.png', alt: 'Paper reading mode' };
  // The same id can be viewed from both sources; do not fall back across them.
  expect(api.readme).toHaveBeenNthCalledWith(1, { id: paper.id, from: 'market' });
  await render({ kind: 'installed', plugin: { ...local, id: paper.id } });
  expect(api.readme).toHaveBeenNthCalledWith(2, { id: paper.id, from: 'installed' });
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('Offline');
  await act(async () => button('Retry').click());
  expect(api.readme).toHaveBeenNthCalledWith(3, { id: paper.id, from: 'installed' });
  expect(text()).toContain('Local guide');
  expect(container.querySelector('script, img')).toBeNull();
  await act(async () => stale.resolve({ ok: true, text: 'Stale market guide' }));
  expect(text()).not.toContain('Stale market guide');
  await render({ kind: 'market', plugin: { ...paper, screenshots: [screenshot] } });
  expect(container.querySelector('img[alt="Paper reading mode"]')?.getAttribute('src')).toBe(
    screenshot.url
  );
});

it('shows a bilingual, explicitly illustrated llmdoc workflow and leaves generic entries factual', async () => {
  await render({
    kind: 'installed',
    plugin: { ...local, id: 'codekiln.llmdoc', name: '知识地图' },
  });
  expect(text()).toContain('Workflow illustration');
  expect(text()).toContain('Review the impact of changes');
  expect(text()).toContain('Which docs need review after I changed sign-in?');
  expect(text()).toContain('With Knowledge Map');
  expect(container.querySelectorAll('[data-story-block]')).toHaveLength(4);
  expect(text()).toContain('Node.js 22.13+');
  expect(text()).toContain('No documentation yet');
  expect(text()).not.toContain('CodeKiln market');
  language.locale = 'zh';
  await render({
    kind: 'installed',
    plugin: { ...local, id: 'codekiln.llmdoc', name: '知识地图' },
  });
  expect(text()).toContain('流程示意');
  expect(text()).toContain('复核变更影响');
  expect(text()).toContain('改了登录逻辑，哪些文档需要复核？');
  await render({ kind: 'installed', plugin: local });
  expect(text()).not.toContain('流程示意');
  expect(container.querySelector('[data-story-block]')).toBeNull();
  expect(text()).toContain(local.description);
  expect(text()).toContain('本地文件夹');
});
