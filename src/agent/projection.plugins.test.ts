import { PLUGIN_MESSAGE_TYPE } from '@shared/extensionPlugins/protocol';
import { expect, it } from 'vitest';
import { projectMessage } from './projection';

it('projects plugin message identity, images and artifact references without secrets', () => {
  expect(
    projectMessage({
      role: 'custom',
      customType: PLUGIN_MESSAGE_TYPE,
      content: 'hi',
      details: { pluginId: 'example.demo', pluginName: 'Demo', apiKey: 'secret' },
    })
  ).toMatchObject({
    pluginSource: { pluginId: 'example.demo', pluginName: 'Demo' },
    content: [{ type: 'text', text: 'hi' }],
  });
});
