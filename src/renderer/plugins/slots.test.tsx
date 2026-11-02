import { pluginToolName } from '@shared/extensionPlugins/toolName';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it } from 'vitest';
import { clearPluginSlots, registerPluginSlot, resetPluginSlots } from './registry';
import {
  PluginBlock,
  PluginComposerSlots,
  PluginMessageActions,
  PluginToolCardSlot,
} from './slots';

beforeEach(resetPluginSlots);
it('SSR renders only this plugin tools, namespaced blocks, right actions and composer slots', () => {
  const component = () => createElement('button', { type: 'button' }, 'Plugin button');
  registerPluginSlot({ pluginId: 'a.b', slot: 'tool.card', toolName: 'lookup', component });
  registerPluginSlot({ pluginId: 'a.b', slot: 'block', language: 'chart', component });
  registerPluginSlot({ pluginId: 'a.b', slot: 'message.action', position: 'right', component });
  registerPluginSlot({ pluginId: 'a.b', slot: 'composer.right', component });
  const tool = (name: string) =>
    renderToStaticMarkup(createElement(PluginToolCardSlot, { name, output: 'ok', state: 'ok' }));
  expect(tool(pluginToolName('a.b', 'lookup'))).toContain('Plugin button');
  for (const name of ['read', 'lookup', pluginToolName('c.d', 'lookup')])
    expect(tool(name)).toBe('');
  expect(
    renderToStaticMarkup(createElement(PluginBlock, { pluginId: 'c.d', lang: 'chart', source: '' }))
  ).toBe('');
  expect(
    renderToStaticMarkup(createElement(PluginMessageActions, { position: 'right', text: 'reply' }))
  ).toContain('Plugin button');
  clearPluginSlots('a.b');
  expect(tool(pluginToolName('a.b', 'lookup'))).toBe('');
  expect(
    renderToStaticMarkup(
      createElement(PluginComposerSlots, { side: 'right', sessionId: 's1', draft: '', busy: false })
    )
  ).toBe('');
});
