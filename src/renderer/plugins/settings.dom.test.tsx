import { parseHTML } from 'linkedom';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { NativePluginsSection } from './NativePluginsSection';

vi.mock('@/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('@/stores/settings', () => ({
  useSettingsStore: (select: (state: unknown) => unknown) =>
    select({ pluginAutoUpdate: true, setPluginAutoUpdate: vi.fn() }),
}));
vi.mock('@/components/ui/switch', () => ({
  Switch: ({
    checked,
    onCheckedChange,
    ...props
  }: {
    checked: boolean;
    onCheckedChange?: (value: boolean) => void;
  }) =>
    createElement('button', {
      type: 'button',
      ...props,
      role: 'switch',
      'aria-checked': checked,
      onClick: () => onCheckedChange?.(!checked),
    }),
}));
vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    variant: _variant,
    size: _size,
    ...props
  }: {
    children?: import('react').ReactNode;
    variant?: string;
    size?: string;
  }) => createElement('button', { ...props, type: 'button' }, children),
}));
it('stages a webpage installation request once and never commits it automatically', async () => {
  const dom = parseHTML('<html><body><div id="root"></div></body></html>');
  const stageFromUrl = vi.fn().mockResolvedValue({ ok: true, cancelled: true });
  const commit = vi.fn();
  vi.stubGlobal(
    'window',
    Object.assign(dom.window, {
      electronAPI: {
        extensionPlugins: {
          list: vi.fn().mockResolvedValue({ plugins: [] }),
          onChanged: () => () => {},
          stageFromUrl,
          commit,
        },
      },
    })
  );
  vi.stubGlobal('document', dom.document);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const root = createRoot(dom.document.getElementById('root')!);
  const request = { serial: 1, pluginInstallUrl: 'https://example.com/plugin.zip' };
  try {
    await act(async () => root.render(createElement(NativePluginsSection, { request })));
    expect(stageFromUrl).toHaveBeenCalledExactlyOnceWith(request.pluginInstallUrl);
    await act(async () => root.render(createElement(NativePluginsSection, { request })));
    expect(stageFromUrl).toHaveBeenCalledTimes(1);
    expect(commit).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});

it('list 的只读错误到达设置页面，恢复后清除提示并显示正常空列表', async () => {
  const dom = parseHTML('<html><body><div id="root"></div></body></html>');
  let changed = () => {};
  const list = vi
    .fn()
    .mockResolvedValue({ plugins: [], registryError: '登记表损坏；备份：registry.corrupt' });
  vi.stubGlobal(
    'window',
    Object.assign(dom.window, {
      electronAPI: {
        extensionPlugins: {
          list,
          onChanged: (listener: () => void) => {
            changed = listener;
            return () => {};
          },
        },
      },
    })
  );
  vi.stubGlobal('document', dom.document);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const container = dom.document.getElementById('root')!;
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(NativePluginsSection)));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'registry is read-only'
    );
    expect(container.textContent).toContain('registry.corrupt');
    expect(container.textContent).not.toContain('No Collabra plugins installed');
    const install = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Install from folder'
    );
    expect(install?.disabled).toBe(true);
    list.mockResolvedValue({ plugins: [] });
    await act(async () => changed());
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.textContent).toContain('No Collabra plugins installed');
    expect(install?.disabled).toBe(false);
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
