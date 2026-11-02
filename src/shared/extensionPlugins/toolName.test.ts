import { describe, expect, it } from 'vitest';
import { parsePluginToolName, pluginToolName } from './toolName';

describe('upstream 插件工具对外名', () => {
  it('点号换成 - 并用 __ 分隔工具名', () => {
    expect(pluginToolName('example.demo', 'lookup')).toBe('plugin_example-demo__lookup');
  });

  it('不同 (id, 工具名) 组合不会撞名', () => {
    expect(pluginToolName('a.b', 'c_d')).not.toBe(pluginToolName('a.b.c', 'd'));
    expect(pluginToolName('a.bc', 'd')).not.toBe(pluginToolName('a.b', 'cd'));
  });

  it('对外名可以反解', () => {
    expect(parsePluginToolName(pluginToolName('a.b.c', 'x_y'))).toEqual({
      pluginId: 'a.b.c',
      toolName: 'x_y',
    });
  });

  it.each([
    'lookup',
    'plugin_',
    'plugin_a-b',
    'plugin___x',
    'mcp_a__b',
    'plugin_a-b__',
    'plugin_A-b__x',
  ])('非插件工具名返回 null：%j', (name) => {
    expect(parsePluginToolName(name)).toBeNull();
  });
});
