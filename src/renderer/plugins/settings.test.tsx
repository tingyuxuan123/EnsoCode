import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import {
  NativePluginsSection,
  PluginRegistryAlert,
  pluginConfigPatch,
} from './NativePluginsSection';

vi.mock('@/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
it('登记表错误明确显示只读及恢复提示，而非仅显示空列表', () => {
  const html = renderToStaticMarkup(
    createElement(PluginRegistryAlert, { error: '坏文件；备份：registry.corrupt' })
  );
  expect(html).toContain('role="alert"');
  expect(html).toContain('registry is read-only');
  expect(html).toContain('Restore the registry');
  expect(html).toContain('registry.corrupt');
});
it('keeps secrets blank without losing explicit deletion or plain values', () => {
  const fields = [
    { key: 'secret', title: 'Secret', secret: true, description: '', set: true },
    { key: 'plain', title: 'Plain', secret: false, description: '', set: false },
  ];
  expect(pluginConfigPatch(fields, { secret: '', plain: 'x', injected: 'bad' })).toEqual({
    plain: 'x',
  });
  expect(pluginConfigPatch(fields, { secret: null })).toEqual({ secret: null });
});
it('server-renders an explicit trust warning and never claims an OS sandbox', () => {
  const html = renderToStaticMarkup(createElement(NativePluginsSection));
  expect(html).toContain('full Node.js access');
  expect(html).toContain('not an OS sandbox');
  expect(html).toContain('disabled until you enable');
  expect(html).toContain('Install from folder');
  expect(html).not.toContain('enso-server');
});
