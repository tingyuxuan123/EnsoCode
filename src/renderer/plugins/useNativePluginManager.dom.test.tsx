import type { ExtensionPluginInstallPreview } from '@shared/extensionPlugins/types';
import { parseHTML } from 'linkedom';
import { act, createElement, useLayoutEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { type NativePluginManager, useNativePluginManager } from './useNativePluginManager';

const preview: ExtensionPluginInstallPreview = {
  env: [],
  interop: [],
  resident: false,
  styles: false,
  events: [],
  schedules: [],
  token: 'preview-token',
  id: 'test.plugin',
  name: 'Test plugin',
  version: '1.0.0',
  description: '',
  permissions: [],
  fsRead: [],
  fsWrite: [],
  netDomains: [],
  mcpServers: [],
  mcpTools: [],
  tools: [],
  hasRenderer: false,
  warnings: [],
  expands: false,
};

function setup() {
  const dom = parseHTML('<html><body><div id="root"></div></body></html>');
  let changed = () => {};
  const unsubscribe = vi.fn();
  const api = {
    list: vi.fn().mockResolvedValue({ plugins: [] }),
    onChanged: (listener: () => void) => {
      changed = listener;
      return unsubscribe;
    },
    pickAndStage: vi.fn().mockResolvedValue({ ok: true, preview }),
    stageFromUrl: vi.fn().mockResolvedValue({ ok: true, preview }),
    discard: vi.fn().mockResolvedValue({ ok: true }),
    commit: vi.fn().mockResolvedValue({ ok: true }),
    setEnabled: vi.fn().mockResolvedValue({ ok: true }),
    approvePending: vi.fn().mockResolvedValue({ ok: true }),
    rejectPending: vi.fn().mockResolvedValue({ ok: true }),
    uninstall: vi.fn().mockResolvedValue({ ok: true }),
  };
  vi.stubGlobal('window', Object.assign(dom.window, { electronAPI: { extensionPlugins: api } }));
  vi.stubGlobal('document', dom.document);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const root = createRoot(dom.document.getElementById('root')!);
  let manager!: NativePluginManager;
  function Harness() {
    const value = useNativePluginManager();
    useLayoutEffect(() => {
      manager = value;
    });
    return null;
  }
  dispose = () => act(async () => root.unmount());
  return {
    api,
    unsubscribe,
    render: () => act(async () => root.render(createElement(Harness))),
    change: () => act(async () => changed()),
    get manager() {
      return manager;
    },
  };
}

let dispose: (() => PromiseLike<void>) | undefined;
afterEach(async () => {
  await dispose?.();
  dispose = undefined;
  vi.unstubAllGlobals();
});

it('only stages valid HTTPS URLs and requires explicit commit without enabling the new plugin', async () => {
  const view = setup();
  await view.render();
  for (const url of [
    'http://public.example/plugin.zip',
    'https://user@public.example',
    'https://',
  ]) {
    await act(async () => view.manager.stage('url', url));
    expect(view.manager.error).toContain('HTTPS');
  }
  expect(view.api.stageFromUrl).not.toHaveBeenCalled();
  await act(async () => view.manager.stage('url', ' https://public.example/plugin.zip '));
  expect(view.api.stageFromUrl).toHaveBeenCalledWith('https://public.example/plugin.zip');
  expect(view.manager.preview).toEqual(preview);
  expect(view.api.commit).not.toHaveBeenCalled();
  await act(async () => view.manager.confirmInstall(preview.token));
  expect(view.api.commit).toHaveBeenCalledExactlyOnceWith(preview.token);
  expect(view.api.setEnabled).not.toHaveBeenCalled();
  expect(view.manager.preview).toBeNull();
});

it('discards replaced and cancelled previews, and stale confirmations cannot commit a new preview', async () => {
  const view = setup();
  await view.render();
  await act(async () => view.manager.stage('dir'));
  const next = { ...preview, token: 'next-preview' };
  view.api.pickAndStage.mockResolvedValue({ ok: true, preview: next });
  await act(async () => view.manager.stage('zip'));
  expect(view.api.discard).toHaveBeenCalledExactlyOnceWith(preview.token);
  await act(async () => view.manager.confirmInstall(preview.token));
  expect(view.api.commit).not.toHaveBeenCalled();
  expect(view.manager.preview).toEqual(next);
  await act(async () => view.manager.cancelPreview());
  expect(view.api.discard).toHaveBeenLastCalledWith(next.token);
  expect(view.manager.preview).toBeNull();
});

it('discards a staged token that arrives after unmount', async () => {
  const view = setup();
  await view.render();
  let resolve!: (result: { ok: true; preview: typeof preview }) => void;
  view.api.pickAndStage.mockImplementation(
    () =>
      new Promise((complete) => {
        resolve = complete;
      })
  );
  let staging!: Promise<void>;
  await act(async () => {
    staging = view.manager.stage('dir');
  });
  expect(view.manager.busy).not.toBeNull();
  await dispose?.();
  dispose = undefined;
  await act(async () => {
    resolve({ ok: true, preview });
    await staging;
  });
  expect(view.api.discard).toHaveBeenCalledExactlyOnceWith(preview.token);
  expect(view.api.commit).not.toHaveBeenCalled();
});

it('surfaces returned failures and cannot write after the registry becomes read-only', async () => {
  const view = setup();
  await view.render();
  view.api.setEnabled.mockResolvedValue({ ok: false, reason: 'Runtime could not start' });
  await act(async () => view.manager.setEnabled(preview.id, true));
  expect(view.manager.error).toContain('Runtime could not start');
  await act(async () => view.manager.stage('dir'));
  view.api.list.mockResolvedValue({ plugins: [], registryError: 'corrupt registry' });
  await view.change();
  expect(view.manager.registryError).toBe('corrupt registry');
  await act(async () => {
    await view.manager.confirmInstall(preview.token);
    await view.manager.setEnabled(preview.id, true);
    await view.manager.approvePending(preview.id);
    await view.manager.rejectPending(preview.id);
    await view.manager.stage('zip');
    view.manager.uninstall(preview.id);
  });
  expect(view.api.pickAndStage).toHaveBeenCalledTimes(1);
  expect(view.api.setEnabled).toHaveBeenCalledTimes(1);
  expect(view.api.commit).not.toHaveBeenCalled();
  expect(view.api.approvePending).not.toHaveBeenCalled();
  expect(view.api.rejectPending).not.toHaveBeenCalled();
  expect(view.manager.removing).toBeNull();
});

it('keeps the newest registry snapshot and ignores a stale rejected list request', async () => {
  const view = setup();
  let reject!: (error: Error) => void;
  view.api.list.mockImplementationOnce(
    () =>
      new Promise((_, fail) => {
        reject = fail;
      })
  );
  await view.render();
  expect(view.manager.loading).toBe(true);
  expect(view.manager.canManage).toBe(false);
  view.api.list.mockResolvedValue({ plugins: [], registryError: 'new registry error' });
  await view.change();
  expect(view.manager.loading).toBe(false);
  expect(view.manager.registryError).toBe('new registry error');
  await act(async () => reject(new Error('stale list failure')));
  expect(view.manager.error).toBe('');
  view.api.list.mockResolvedValue({ plugins: [] });
  await view.change();
  expect(view.manager.canManage).toBe(true);
  await dispose?.();
  dispose = undefined;
  expect(view.unsubscribe).toHaveBeenCalledTimes(1);
});

it('does not open a preview when the picker is cancelled and blocks same-tick duplicate stages', async () => {
  const view = setup();
  await view.render();
  view.api.pickAndStage.mockResolvedValue({ ok: true, cancelled: true });
  await act(async () => {
    await Promise.all([view.manager.stage('dir'), view.manager.stage('zip')]);
  });
  expect(view.api.pickAndStage).toHaveBeenCalledExactlyOnceWith('dir');
  expect(view.manager.preview).toBeNull();
  expect(view.manager.error).toBe('');
  expect(view.manager.busy).toBeNull();
});

it('discards the current token on unmount and surfaces cleanup failures while still mounted', async () => {
  const view = setup();
  await view.render();
  await act(async () => view.manager.stage('dir'));
  view.api.discard.mockResolvedValueOnce({ ok: false, error: 'Cannot discard token' });
  await act(async () => view.manager.cancelPreview());
  expect(view.manager.error).toBe('Cannot discard token');
  await act(async () => view.manager.stage('zip'));
  await dispose?.();
  dispose = undefined;
  expect(view.api.discard).toHaveBeenCalledTimes(2);
  expect(view.api.discard).toHaveBeenLastCalledWith(preview.token);
});

it('refreshes after enabling, approving and rejecting updates, and reports rejected operations', async () => {
  const view = setup();
  await view.render();
  await act(async () => view.manager.setEnabled(preview.id, true));
  await act(async () => view.manager.approvePending(preview.id));
  await act(async () => view.manager.rejectPending(preview.id));
  expect(view.api.setEnabled).toHaveBeenCalledExactlyOnceWith(preview.id, true);
  expect(view.api.approvePending).toHaveBeenCalledExactlyOnceWith(preview.id);
  expect(view.api.rejectPending).toHaveBeenCalledExactlyOnceWith(preview.id);
  expect(view.api.list).toHaveBeenCalledTimes(4);
  view.api.rejectPending.mockRejectedValue(new Error('Reject update failed'));
  await act(async () => view.manager.rejectPending(preview.id));
  expect(view.manager.error).toBe('Reject update failed');
  expect(view.manager.busy).toBeNull();
});
