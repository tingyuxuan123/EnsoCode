import { expect, it } from 'vitest';
import { pluginUiSessionAllowed } from './pluginSessionPolicy';

it('插件窗口操作只接Main权威本机会话目录，不按id形状猜权限', () => {
  expect(pluginUiSessionAllowed('local', [{ id: 'local' }])).toBe(true);
  for (const id of ['remote', 'bot', 'local::child', 'retired'])
    expect(pluginUiSessionAllowed(id, [{ id: 'local' }])).toBe(false);
  expect(pluginUiSessionAllowed('local', null)).toBe(false);
});
