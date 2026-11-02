import { parseHTML } from 'linkedom';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { NativePluginsSection } from './NativePluginsSection';

vi.mock('@/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));

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
    expect(container.textContent).not.toContain('No Enso plugins installed');
    list.mockResolvedValue({ plugins: [] });
    await act(async () => changed());
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.textContent).toContain('No Enso plugins installed');
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
