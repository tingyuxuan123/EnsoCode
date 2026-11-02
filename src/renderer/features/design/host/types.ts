import type { PluginAgentApi } from '../vetta/sdk/agent';
import type { PluginCaptureApi } from '../vetta/sdk/capture';
import type { PluginCommandApi } from '../vetta/sdk/command';
import type { PluginConversationApi } from '../vetta/sdk/conversation';
import type { Disposable } from '../vetta/sdk/disposable';
import type { PluginFileExplorerApi } from '../vetta/sdk/file-explorer';
import type { PluginFsApi } from '../vetta/sdk/fs';
import type { PluginI18nApi } from '../vetta/sdk/i18n';
import type { PluginNetworkApi } from '../vetta/sdk/network';
import type { PluginOfficialApi } from '../vetta/sdk/official';
import type { PluginStorageApi } from '../vetta/sdk/storage';
import type { PluginUiApi } from '../vetta/sdk/ui';

export interface PluginContext {
  plugin: { id: string; version: string; iconUrl?: string };
  ui: PluginUiApi;
  fileExplorer: PluginFileExplorerApi;
  conversation: PluginConversationApi;
  agent: PluginAgentApi;
  official: PluginOfficialApi;
  fs: PluginFsApi;
  command: PluginCommandApi;
  capture?: PluginCaptureApi;
  network: PluginNetworkApi;
  storage: PluginStorageApi;
  i18n: PluginI18nApi;
  getAgentMode(): string;
  onAgentModeChanged(listener: (mode: string) => void): Disposable;
}
export interface PluginDefinition {
  activate(
    ctx: PluginContext
  ):
    | void
    | Disposable
    | (() => void | Promise<void>)
    | Promise<void | Disposable | (() => void | Promise<void>)>;
  deactivate?(): void | Promise<void>;
}
