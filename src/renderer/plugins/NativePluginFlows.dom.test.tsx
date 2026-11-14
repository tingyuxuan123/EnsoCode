import type { ExtensionPluginInstallPreview } from '@shared/extensionPlugins/types';
import { parseHTML } from 'linkedom';
import { act, createElement, type ReactNode, useLayoutEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { NativePluginFlows } from './NativePluginFlows';
import { type NativePluginManager, useNativePluginManager } from './useNativePluginManager';

vi.mock('@/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
// Keep these tests about flow content/actions rather than Base UI's browser focus management.
vi.mock('@/components/ui/dialog', () => {
  const Slot = ({ children }: { children?: ReactNode }) => createElement('div', null, children);
  return {
    Dialog: ({ open, children }: { open: boolean; children?: ReactNode }) =>
      open ? children : null,
    DialogContent: Slot,
    DialogHeader: Slot,
    DialogTitle: Slot,
    DialogPanel: Slot,
    DialogFooter: Slot,
  };
});

const preview: ExtensionPluginInstallPreview = {
  token: 'token',
  id: 'test.plugin',
  name: 'Test plugin',
  version: '2',
  description: 'Description',
  env: [],
  interop: [],
  resident: false,
  styles: false,
  events: [],
  schedules: [],
  permissions: ['fs.read'],
  fsRead: ['workspace/**'],
  fsWrite: ['data/**'],
  netDomains: ['api.example.com'],
  browserDomains: ['example.com'],
  mcpServers: [{ name: 'MCP server', command: 'node', args: ['server.js'], envKeys: ['TOKEN'] }],
  mcpTools: ['mcp-tool'],
  tools: [{ name: 'plugin-tool', description: 'Tool description' }],
  hasRenderer: true,
  warnings: ['Unverified publisher'],
  existingVersion: '1',
  expands: true,
};

function setup() {
  const dom = parseHTML('<html><body><div id="root"></div></body></html>');
  let changed = () => {};
  const api = {
    list: vi.fn().mockResolvedValue({ plugins: [] }),
    onChanged: (listener: () => void) => {
      changed = listener;
      return () => {};
    },
    pickAndStage: vi.fn().mockResolvedValue({ ok: true, preview }),
    discard: vi.fn().mockResolvedValue({ ok: true }),
    commit: vi.fn().mockResolvedValue({ ok: true }),
    uninstall: vi.fn().mockResolvedValue({ ok: true }),
    configGet: vi.fn().mockResolvedValue({
      ok: true,
      fields: [
        { key: 'secret', title: 'Secret', description: '', secret: true, set: true },
        { key: 'plain', title: 'Plain', description: '', secret: false, set: true, value: 'old' },
      ],
    }),
    configSet: vi.fn().mockResolvedValue({ ok: true }),
  };
  vi.stubGlobal('window', Object.assign(dom.window, { electronAPI: { extensionPlugins: api } }));
  vi.stubGlobal('document', dom.document);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const container = dom.document.getElementById('root')!;
  const root = createRoot(container);
  let manager!: NativePluginManager;
  function Harness() {
    const value = useNativePluginManager();
    useLayoutEffect(() => {
      manager = value;
    });
    return createElement(NativePluginFlows, { manager: value });
  }
  dispose = () => act(async () => root.unmount());
  return {
    api,
    container,
    render: () => act(async () => root.render(createElement(Harness))),
    change: () => act(async () => changed()),
    get manager() {
      return manager;
    },
    click: (text: string) =>
      act(async () => {
        const button = [...container.querySelectorAll('button')].find(
          (item) => item.textContent === text
        );
        expect(button, text).toBeDefined();
        button!.click();
      }),
  };
}
let dispose: (() => PromiseLike<void>) | undefined;
afterEach(async () => {
  await dispose?.();
  dispose = undefined;
  vi.unstubAllGlobals();
});

it('renders the full permission preview and only commits after confirmation', async () => {
  const view = setup();
  await view.render();
  await act(async () => view.manager.stage('dir'));
  for (const text of [
    'Review plugin installation',
    'full Node.js access',
    'not an OS sandbox',
    '1 → 2',
    'workspace/**',
    'data/**',
    'api.example.com',
    'MCP server: node server.js (env: TOKEN)',
    'mcp-tool',
    'plugin-tool: Tool description',
    'Unverified publisher',
    'Includes ui.js',
  ]) {
    expect(view.container.textContent).toContain(text);
  }
  expect(view.api.commit).not.toHaveBeenCalled();
  await view.click('Cancel');
  expect(view.api.discard).toHaveBeenCalledExactlyOnceWith(preview.token);
  await act(async () => view.manager.stage('zip'));
  view.api.commit.mockResolvedValueOnce({ ok: false, error: 'Commit failed' });
  await view.click('Confirm install');
  expect(view.container.querySelector('[role="alert"]')?.textContent).toContain('Commit failed');
  expect(view.container.textContent).toContain('Review plugin installation');
  await view.click('Confirm install');
  expect(view.container.textContent).not.toContain('Review plugin installation');
});

it('labels a first install as install-and-enable and blocks a second confirm while busy', async () => {
  const view = setup();
  const { existingVersion: _existing, ...fresh } = preview;
  view.api.pickAndStage.mockResolvedValue({ ok: true, preview: fresh });
  await view.render();
  await act(async () => view.manager.stage('dir'));
  expect(view.container.textContent).toContain('Install and enable');
  expect(view.container.textContent).toContain('enabled as soon as you confirm');
  let finish!: (value: { ok: true; enabled: true }) => void;
  view.api.commit.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await act(async () => {
    void view.manager.confirmInstall(fresh.token);
  });
  const confirm = [...view.container.querySelectorAll('button')].find(
    (item) => item.textContent === 'Install and enable'
  );
  expect(confirm?.disabled).toBe(true);
  expect(view.api.commit).toHaveBeenCalledTimes(1);
  await act(async () => finish({ ok: true, enabled: true }));
  expect(view.container.textContent).not.toContain('Review plugin installation');
});

it('opens uninstall confirmation without deleting, supports cancellation, and displays failures', async () => {
  const view = setup();
  await view.render();
  await act(async () => view.manager.uninstall(preview.id));
  expect(view.container.textContent).toContain('The plugin and its private data will be removed.');
  expect(view.api.uninstall).not.toHaveBeenCalled();
  await view.click('Cancel');
  expect(view.api.uninstall).not.toHaveBeenCalled();
  await act(async () => view.manager.uninstall(preview.id));
  await act(async () => {
    view.manager.cancelUninstall();
    await view.manager.confirmUninstall(preview.id);
  });
  expect(view.api.uninstall).not.toHaveBeenCalled();
  await act(async () => view.manager.uninstall(preview.id));
  view.api.uninstall.mockResolvedValueOnce({ ok: false, reason: 'Files are locked' });
  await view.click('Uninstall');
  expect(view.container.querySelector('[role="alert"]')?.textContent).toContain('Files are locked');
  await view.click('Uninstall');
  expect(view.manager.removing).toBeNull();
});

it('keeps existing secrets blank, saves only edited known fields and permits explicit clearing', async () => {
  const view = setup();
  await view.render();
  await act(async () => view.manager.configure(preview.id));
  const secret = view.container.querySelector('input[aria-label="Secret"]') as HTMLInputElement;
  expect(secret.type).toBe('password');
  expect(secret.value).toBe('');
  expect(view.container.textContent).toContain('Set (leave blank to keep)');
  await act(async () => {
    view.manager.setConfigValue('secret', '');
    view.manager.setConfigValue('plain', 'new');
    view.manager.setConfigValue('injected', 'bad');
  });
  await view.click('Save');
  expect(view.api.configSet).toHaveBeenLastCalledWith(preview.id, { plain: 'new' });
  await act(async () => view.manager.setConfigValue('secret', null));
  expect(view.container.textContent).toContain('Will clear');
  await view.click('Save');
  expect(view.api.configSet).toHaveBeenLastCalledWith(preview.id, { secret: null });
});

it('shows config read/write errors and prevents saving when the registry becomes read-only', async () => {
  const view = setup();
  await view.render();
  view.api.configGet.mockResolvedValueOnce({ ok: false, error: 'Config load failed' });
  await act(async () => view.manager.configure(preview.id));
  expect(view.container.querySelector('[role="alert"]')?.textContent).toContain(
    'Config load failed'
  );
  await act(async () => view.manager.configure(preview.id));
  await act(async () => view.manager.setConfigValue('plain', 'draft'));
  view.api.configSet.mockResolvedValueOnce({ ok: false, reason: 'Config save failed' });
  await view.click('Save');
  expect(view.container.querySelector('[role="alert"]')?.textContent).toContain(
    'Config save failed'
  );
  view.api.list.mockResolvedValue({ plugins: [], registryError: 'registry.corrupt' });
  await view.change();
  expect(view.container.textContent).toContain('registry is read-only');
  const save = [...view.container.querySelectorAll('button')].find(
    (button) => button.textContent === 'Save'
  );
  expect(save?.disabled).toBe(true);
  await act(async () => view.manager.saveConfig());
  expect(view.api.configSet).toHaveBeenCalledTimes(1);
});
