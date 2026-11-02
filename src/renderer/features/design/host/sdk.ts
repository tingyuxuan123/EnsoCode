/** The public SDK surface actually imported by vetta-ui-design. */

export { __ActivityTabContext, useActivityTab } from '../vetta/sdk/activity-tab';
export type * from '../vetta/sdk/agent';
export type * from '../vetta/sdk/capture';
export type * from '../vetta/sdk/command';
export type * from '../vetta/sdk/conversation';
export type * from '../vetta/sdk/disposable';
export type * from '../vetta/sdk/fs';
export type * from '../vetta/sdk/official';
export { usePluginShortcutScope } from '../vetta/sdk/shortcuts';
export { readJsonFile, writeJsonFile } from '../vetta/sdk/storage';
export type * from '../vetta/sdk/ui';
export { useTranslation } from './translation';
export type { PluginContext, PluginDefinition } from './types';

import type { PluginDefinition } from './types';
export function definePlugin(plugin: PluginDefinition): PluginDefinition {
  return plugin;
}
