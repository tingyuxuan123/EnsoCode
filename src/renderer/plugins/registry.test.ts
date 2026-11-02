import { beforeEach, expect, it } from 'vitest';
import {
  clearPluginSlots,
  parsePluginFence,
  pluginBlock,
  pluginComposerSlots,
  pluginMessageActions,
  pluginToolCard,
  registerPluginSlot,
  resetPluginSlots,
} from './registry';

beforeEach(resetPluginSlots);
const component = () => null;
it('registers only supported namespaced slots and clears one plugin', () => {
  registerPluginSlot({ pluginId: 'a.b', slot: 'block', language: 'Chart', component });
  registerPluginSlot({ pluginId: 'c.d', slot: 'composer.left', component });
  registerPluginSlot({ pluginId: 'a.b', slot: 'tool.card', toolName: 'lookup', component });
  const dispose = registerPluginSlot({
    pluginId: 'a.b',
    slot: 'message.action',
    position: 'right',
    component,
  });
  expect(pluginBlock('a.b', 'CHART')).toBeTruthy();
  expect(pluginToolCard('c.d', 'lookup')).toBeUndefined();
  expect(pluginToolCard('a.b', 'read')).toBeUndefined();
  expect(pluginMessageActions('right')).toHaveLength(1);
  expect(pluginMessageActions('left')).toHaveLength(0);
  dispose();
  expect(pluginMessageActions('right')).toHaveLength(0);
  clearPluginSlots('a.b');
  expect(pluginBlock('a.b', 'chart')).toBeUndefined();
  expect(pluginComposerSlots('left')).toHaveLength(1);
});
it('rejects foreign namespaces, builtin tools and unmounted slots', () => {
  for (const entry of [
    { slot: 'tool.card', toolName: 'plugin_c-d__read' },
    { slot: 'tool.card', toolName: 'read' + '__x' },
    { slot: 'block', language: 'c.d:chart' },
    { slot: 'message.action', position: 'left' },
    { slot: 'composer.dock' },
    { slot: 'unknown' },
  ])
    expect(() => registerPluginSlot({ pluginId: 'a.b', component, ...entry } as never)).toThrow();
  expect(parsePluginFence('a.b:chart')).toEqual({ pluginId: 'a.b', lang: 'chart' });
  for (const value of ['mermaid', 'a.b:', 'A.B:x', 'a.b:x:y', 'a.b:../x'])
    expect(parsePluginFence(value)).toBeNull();
});
