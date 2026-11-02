import { join } from 'node:path';
import { IPC_CHANNELS } from '@shared/types';
import { app, Notification, utilityProcess, webContents } from 'electron';
import pluginHostPath from '../../../pluginHost/index?modulePath';
import { getWindowWebContents } from '../../windows/createAppWindow';
import { getMainWindow } from '../../windows/MainWindow';
import { getSettingsWindow } from '../../windows/SettingsWindow';
import { safePluginFetch } from './download';
import { DraftBroker } from './draftBroker';
import type { GateDeps } from './gate';
import { pluginError } from './process';
import { ExtensionPluginService } from './service';

export type PluginMcpBridge = Pick<GateDeps, 'mcpTools' | 'mcpCall'>;
let service: ExtensionPluginService | null = null;
let broker: DraftBroker | null = null;
let messages: ((sessionId: string) => Promise<unknown>) | null = null;
let mcpBridge: PluginMcpBridge | null = null;
let invocationPolicy: GateDeps['invocationPolicy'] | null = null;
const ENV_KEYS = [
  'PATH',
  'HOME',
  'USER',
  'LANG',
  'LC_ALL',
  'TMPDIR',
  'TEMP',
  'TMP',
  'SystemRoot',
  'windir',
  'APPDATA',
  'LOCALAPPDATA',
  'USERPROFILE',
];
/** Full Node code is trusted, but ambient API keys/proxy credentials are not inherited. */
export function pluginHostEnv(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const key of ENV_KEYS) if (source[key] !== undefined) out[key] = source[key];
  return out;
}
export function setPluginMcpBridge(bridge: PluginMcpBridge | null): void {
  mcpBridge = bridge;
}
export function setPluginInvocationPolicy(policy: GateDeps['invocationPolicy'] | null): void {
  invocationPolicy = policy;
}
export function setSessionMessagesReader(
  reader: ((sessionId: string) => Promise<unknown>) | null
): void {
  messages = reader;
}
const unsupported = (): never => {
  throw pluginError('UNSUPPORTED', '当前会话未接通插件宿主能力');
};
export function getDraftBroker(): DraftBroker {
  broker ??= new DraftBroker({
    channel: IPC_CHANNELS.EXTENSION_PLUGINS_DRAFT_REQUEST,
    find: (id) => {
      const valid = [getMainWindow(), getSettingsWindow()].some(
        (win) => win && !win.isDestroyed() && getWindowWebContents(win).id === id
      );
      return valid ? (webContents.fromId(id) ?? null) : null;
    },
  });
  return broker;
}
export function getExtensionPlugins(): ExtensionPluginService {
  if (service) return service;
  service = new ExtensionPluginService({
    root: join(app.getPath('userData'), 'extension-plugins'),
    hostVersion: app.getVersion(),
    hostPath: pluginHostPath,
    env: pluginHostEnv(process.env),
    fork: (modulePath, args, options) => utilityProcess.fork(modulePath, args, options),
    gate: {
      fetch: safePluginFetch,
      notify: (title, body) => {
        if (!Notification.isSupported()) return false;
        new Notification({ title, body }).show();
        return true;
      },
      composer: (target, op, payload) =>
        getDraftBroker().request(target.origin, target.sessionId, op, payload),
      sessionMessages: (sessionId) =>
        messages
          ? messages(sessionId)
          : Promise.reject(pluginError('UNSUPPORTED', '会话消息尚未接通')),
      mcpTools: (target, signal) =>
        mcpBridge
          ? mcpBridge.mcpTools(target, signal)
          : Promise.reject(pluginError('UNSUPPORTED', 'MCP 尚未接通')),
      mcpCall: (target, server, tool, args, signal) =>
        mcpBridge
          ? mcpBridge.mcpCall(target, server, tool, args, signal)
          : Promise.reject(pluginError('UNSUPPORTED', 'MCP 尚未接通')),
      invocationPolicy: (target) =>
        invocationPolicy ? invocationPolicy(target) : Promise.reject(unsupported()),
      now: Date.now,
    },
  });
  app.once('before-quit', () => {
    service?.dispose();
    broker?.dispose();
  });
  return service;
}
