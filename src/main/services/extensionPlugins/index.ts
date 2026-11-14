import { join } from 'node:path';
import type { PluginHostCapabilities } from '@shared/extensionPlugins/protocol';
import { IPC_CHANNELS } from '@shared/types';
import { app, clipboard, Notification, shell, utilityProcess, webContents } from 'electron';
import pluginHostPath from '../../../pluginHost/index?modulePath';
import { readSettings } from '../../ipc/settings';
import { getWindowWebContents, sendToWindow } from '../../windows/createAppWindow';
import { getMainWindow } from '../../windows/MainWindow';
import { getSettingsWindow } from '../../windows/SettingsWindow';
import { setNativeAgentTypeSource, setNativePluginRuntimeSource } from '../pluginRuntime';
import { pluginUiSessionAllowed } from '../pluginSessionPolicy';
import { BUILTIN_MARKET } from './builtinMarket';
import { pinnedArchiveFetch, safePluginFetch } from './download';
import { DraftBroker } from './draftBroker';
import type { GateDeps } from './gate';
import { envMarketSources, MARKET_ID, marketPublicKeys, PluginMarket } from './market';
import { pluginError } from './process';
import { ExtensionPluginService, type PluginSessionBridge } from './service';

export type { PluginSessionBridge };
export type PluginSessionDirectory = Required<NonNullable<GateDeps['sessions']>>;

export type PluginMcpBridge = Pick<GateDeps, 'mcpTools' | 'mcpCall'>;
let service: ExtensionPluginService | null = null;
let broker: DraftBroker | null = null;
let messages: ((sessionId: string) => Promise<unknown>) | null = null;
let mcpBridge: PluginMcpBridge | null = null;
let invocationPolicy: GateDeps['invocationPolicy'] | null = null;
let sessionBridge: PluginSessionBridge | null = null;
let sessionDirectory: PluginSessionDirectory | null = null;
export function setPluginSessionBridge(bridge: PluginSessionBridge | null): void {
  sessionBridge = bridge;
}
export function setPluginSessionDirectory(directory: PluginSessionDirectory | null): void {
  sessionDirectory = directory;
}
export function pluginHostCapabilities(input: {
  host: 'desktop' | 'server';
  hostVersion: string;
  notify: boolean;
  clipboard: boolean;
  openExternal: boolean;
}): PluginHostCapabilities {
  return {
    ...input,
    clipboard: input.host === 'desktop' && input.clipboard,
    openExternal: input.host === 'desktop' && input.openExternal,
    mcp: true,
    composer: input.host === 'desktop',
  };
}
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
  const root = join(app.getPath('userData'), 'extension-plugins');
  const capabilities = pluginHostCapabilities({
    host: 'desktop',
    hostVersion: app.getVersion(),
    notify: Notification.isSupported(),
    clipboard: true,
    openExternal: true,
  });
  service = new ExtensionPluginService({
    root,
    hostVersion: app.getVersion(),
    hostPath: pluginHostPath,
    env: pluginHostEnv(process.env),
    sourceEnv: process.env,
    capabilities,
    sessionBridge: () => sessionBridge,
    autoUpdatePlugins: () => {
      const state = readSettings()?.['enso-settings'];
      return !(
        state &&
        typeof state === 'object' &&
        'state' in state &&
        state.state &&
        typeof state.state === 'object' &&
        'pluginAutoUpdate' in state.state &&
        state.state.pluginAutoUpdate === false
      );
    },
    market: new PluginMarket({
      root,
      // 市场身份固定为 Collabra；镜像与缓存都按它隔离，renderer 无法指定别的市场
      marketId: MARKET_ID,
      fetch: pinnedArchiveFetch,
      hostVersion: app.getVersion(),
      publicKeys: marketPublicKeys(),
      builtin: BUILTIN_MARKET,
      ...(envMarketSources(process.env)
        ? { sources: () => envMarketSources(process.env) ?? [] }
        : {}),
    }),
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
      sessions: {
        list: (id) => sessionDirectory?.list(id) ?? [],
        listAll: () => sessionDirectory?.listAll() ?? [],
        status: (id) =>
          sessionDirectory?.status(id) ?? {
            sessionId: id,
            state: 'idle',
            pendingAsks: 0,
            pendingApprovals: 0,
          },
      },
      sessionUi: (target, op, payload) => {
        if (!pluginUiSessionAllowed(target.sessionId, sessionDirectory?.listAll() ?? null))
          throw pluginError('NO_SESSION', '插件只能操作本机有效根会话');
        return getDraftBroker().request(
          target.origin ?? (op === 'openPluginView' ? mainRendererId() : null),
          target.sessionId,
          op,
          payload,
          15_000
        );
      },
      wakeSession: async (id, origin) => {
        if (!pluginUiSessionAllowed(id, sessionDirectory?.listAll() ?? null))
          throw pluginError('NO_SESSION', '插件只能启动本机有效根会话');
        await getDraftBroker().request(origin ?? mainRendererId(), id, 'ensureSession', {}, 15_000);
      },
      viewEvent: (pluginId, name, data) => {
        const main = getMainWindow();
        if (main && !main.isDestroyed())
          sendToWindow(main, IPC_CHANNELS.EXTENSION_PLUGINS_VIEW_EVENT, { pluginId, name, data });
      },
      clipboard: (text) => clipboard.writeText(text),
      openExternal: (url) => shell.openExternal(url),
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
  setNativeAgentTypeSource(service.agentTypeSource());
  service.startUpdateChecks();
  service.startBackground();
  app.once('before-quit', () => {
    service?.dispose();
    broker?.dispose();
  });
  return service;
}
function mainRendererId(): number | null {
  const main = getMainWindow();
  return main && !main.isDestroyed() ? getWindowWebContents(main).id : null;
}
setNativePluginRuntimeSource({
  get: getExtensionPlugins,
  setSessionBridge: setPluginSessionBridge,
});
