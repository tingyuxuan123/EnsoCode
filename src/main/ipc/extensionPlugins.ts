import { readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ExtensionPluginInstallPreview } from '@shared/extensionPlugins/types';
import { IPC_CHANNELS } from '@shared/types';
import { app, BrowserWindow, dialog, ipcMain, webContents } from 'electron';
import type { DraftBroker } from '../services/extensionPlugins/draftBroker';
import type { ExtensionPluginService, UiCallMethod } from '../services/extensionPlugins/service';
import { getWindowWebContents, sendToAllWindows } from '../windows/createAppWindow';
import { getMainWindow } from '../windows/MainWindow';
import { getSettingsWindow } from '../windows/SettingsWindow';
import { PluginOwnerLifetimes } from './extensionPluginsOwners';

interface PluginSenderEvent {
  sender: { id: number; isDestroyed(): boolean; mainFrame: unknown };
  senderFrame: unknown;
}
interface TrustedWindows {
  mainId: number | null;
  settingsId: number | null;
  mainUrl: string;
  settingsUrl: string;
}
export function isTrustedPluginSender(event: PluginSenderEvent, windows: TrustedWindows): boolean {
  if (
    !event.sender ||
    event.sender.isDestroyed() ||
    !event.senderFrame ||
    event.senderFrame !== event.sender.mainFrame
  )
    return false;
  const frame = event.senderFrame;
  if (
    typeof frame !== 'object' ||
    frame === null ||
    !('url' in frame) ||
    typeof frame.url !== 'string'
  )
    return false;
  return (
    (event.sender.id === windows.mainId && frame.url === windows.mainUrl) ||
    (event.sender.id === windows.settingsId && frame.url === windows.settingsUrl)
  );
}
const record = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const id = (v: unknown): v is string =>
  typeof v === 'string' && v.length <= 40 && /^[a-z][a-z0-9]*(\.[a-z0-9]+)+$/.test(v);
const token = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 128;
const methods = ['command.run', 'trigger.candidates', 'trigger.pick', 'renderer.call'] as const;
const mime: Record<string, string> = {
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.html': 'text/html',
};
type Handler = (event: PluginSenderEvent, ...args: unknown[]) => unknown;
interface HandlerDeps {
  trusted(event: PluginSenderEvent): boolean;
  service(): ExtensionPluginService;
  draft(): DraftBroker;
  projectRoot(sessionId: string): string | null;
  signal?(event: PluginSenderEvent): AbortSignal;
  pick(
    event: PluginSenderEvent,
    kind: 'dir' | 'zip'
  ): Promise<{ canceled: boolean; filePaths: string[] }>;
}
/** Every privileged operation shares the same sender/frame guard, including list/assets/draft replies. */
export function createExtensionPluginHandlers(deps: HandlerDeps) {
  const deny = {
    ok: false,
    error: '仅可信本地桌面主界面或设置窗口可管理插件',
    code: 'PERMISSION_DENIED',
  };
  const guard =
    (handler: Handler): Handler =>
    async (e, ...args) => {
      if (!deps.trusted(e)) return deny;
      try {
        return await handler(e, ...args);
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
          ...(error instanceof Error && 'code' in error && typeof error.code === 'string'
            ? { code: error.code }
            : {}),
        };
      }
    };
  const invalid = { ok: false, error: '参数不合法' };
  return {
    list: guard(() => deps.service().list()),
    pickAndStage: guard(async (e, kind) => {
      if (kind !== 'dir' && kind !== 'zip') return invalid;
      const picked = await deps.pick(e, kind);
      if (picked.canceled || !picked.filePaths[0]) return { ok: true, cancelled: true };
      if (!deps.trusted(e)) return deny;
      return deps
        .service()
        .stage({ kind, path: picked.filePaths[0] }, e.sender.id, deps.signal?.(e));
    }),
    stageUrl: guard((e, url) =>
      typeof url === 'string' && url.length <= 2048
        ? deps.service().stage({ kind: 'url', url }, e.sender.id, deps.signal?.(e))
        : invalid
    ),
    commit: guard((e, value) =>
      token(value) ? deps.service().commit(value, e.sender.id) : invalid
    ),
    discard: guard((e, value) =>
      token(value) ? { ok: deps.service().discard(value, e.sender.id) } : invalid
    ),
    setEnabled: guard((_e, pluginId, enabled) =>
      id(pluginId) && typeof enabled === 'boolean'
        ? deps.service().setEnabled(pluginId, enabled)
        : invalid
    ),
    approvePending: guard((_e, pluginId) =>
      id(pluginId) ? deps.service().approvePending(pluginId) : invalid
    ),
    rejectPending: guard((_e, pluginId) =>
      id(pluginId) ? deps.service().rejectPending(pluginId) : invalid
    ),
    uninstall: guard((_e, pluginId) =>
      id(pluginId) ? deps.service().uninstall(pluginId) : invalid
    ),
    configGet: guard((_e, pluginId) =>
      id(pluginId) ? deps.service().configView(pluginId) : invalid
    ),
    configSet: guard((_e, pluginId, patch) => {
      if (
        !id(pluginId) ||
        !record(patch) ||
        Object.keys(patch).length > 20 ||
        !Object.values(patch).every((v) => v === null || typeof v === 'string')
      )
        return invalid;
      return deps.service().setConfig(pluginId, patch as Record<string, string | null>);
    }),
    call: guard(async (e, raw) => {
      if (
        !record(raw) ||
        !id(raw.pluginId) ||
        !(methods as readonly unknown[]).includes(raw.method) ||
        !record(raw.payload) ||
        (raw.gesture !== undefined && typeof raw.gesture !== 'boolean') ||
        (raw.sessionId !== null &&
          (typeof raw.sessionId !== 'string' || raw.sessionId.length > 128)) ||
        Object.keys(raw).some(
          (k) => !['pluginId', 'method', 'payload', 'sessionId', 'gesture'].includes(k)
        )
      )
        return invalid;
      return {
        ok: true,
        value: await deps.service().callUi({
          pluginId: raw.pluginId,
          method: raw.method as UiCallMethod,
          payload: raw.payload,
          sessionId: raw.sessionId as string | null,
          projectRoot: typeof raw.sessionId === 'string' ? deps.projectRoot(raw.sessionId) : null,
          origin: e.sender.id,
          gesture: raw.gesture === true,
        }),
      };
    }),
    draftResponse: guard((e, raw) => {
      deps.draft().respond(e.sender.id, raw);
      return { ok: true };
    }),
    asset: guard((_e, pluginId, rel) => {
      if (!id(pluginId) || typeof rel !== 'string') return invalid;
      const path = deps.service().assetPath(pluginId, rel);
      if (!path) return { ok: false, error: '资源不存在' };
      if (statSync(path).size > 8 * 1024 * 1024) return { ok: false, error: '资源过大' };
      const bytes = readFileSync(path);
      if (bytes.byteLength > 8 * 1024 * 1024) return { ok: false, error: '资源过大' };
      return {
        ok: true,
        mime: mime[extname(path).toLowerCase()] ?? 'application/octet-stream',
        base64: bytes.toString('base64'),
      };
    }),
  };
}
export type ExtensionPluginStageResult =
  | { ok: true; preview: ExtensionPluginInstallPreview }
  | { ok: false; error: string }
  | { ok: true; cancelled: true };

/** Register synchronously before any window loads. No plugin service initialized for untrusted callers. */
export function registerExtensionPluginHandlers(): void {
  const expected = (entry: string) =>
    !app.isPackaged && process.env.ELECTRON_RENDERER_URL
      ? `${process.env.ELECTRON_RENDERER_URL}/${entry}.html`
      : pathToFileURL(join(import.meta.dirname, `../renderer/${entry}.html`)).href;
  const trusted = (event: PluginSenderEvent) => {
    const main = getMainWindow();
    const settings = getSettingsWindow();
    return isTrustedPluginSender(event, {
      mainId: main && !main.isDestroyed() ? getWindowWebContents(main).id : null,
      settingsId: settings && !settings.isDestroyed() ? getWindowWebContents(settings).id : null,
      mainUrl: expected('index'),
      settingsUrl: expected('settings'),
    });
  };
  let handlers: Promise<ReturnType<typeof createExtensionPluginHandlers>> | null = null;
  let releaseOwner: ((id: number) => void) | undefined;
  const owners = new PluginOwnerLifetimes((id) => {
    // Do not initialize the plugin service just because an unrelated window closed.
    if (releaseOwner) releaseOwner(id);
    else if (handlers) void handlers.then(() => releaseOwner?.(id)).catch(() => {});
  });
  app.on('web-contents-created', (_event, contents) => owners.attach(contents));
  for (const contents of webContents.getAllWebContents()) owners.attach(contents);
  const load = () =>
    (handlers ??= Promise.all([import('../services/extensionPlugins'), import('./agent')]).then(
      ([{ getExtensionPlugins, getDraftBroker }, { pluginProjectRoot }]) => {
        getExtensionPlugins().onChange(() =>
          sendToAllWindows(IPC_CHANNELS.EXTENSION_PLUGINS_CHANGED)
        );
        releaseOwner = (id) => {
          getExtensionPlugins().releaseOwner(id);
          getDraftBroker().releaseOwner(id);
        };
        return createExtensionPluginHandlers({
          trusted,
          service: getExtensionPlugins,
          draft: getDraftBroker,
          projectRoot: pluginProjectRoot,
          signal: (event) => {
            const contents = webContents.fromId(event.sender.id);
            return contents ? owners.signal(contents) : AbortSignal.abort();
          },
          pick: async (event, kind) => {
            const owner = BrowserWindow.getAllWindows().find(
              (w) => getWindowWebContents(w).id === event.sender.id
            );
            if (!owner) throw new Error('窗口不可用');
            return dialog.showOpenDialog(owner, {
              properties: [kind === 'dir' ? 'openDirectory' : 'openFile'],
              ...(kind === 'zip' ? { filters: [{ name: 'ZIP', extensions: ['zip'] }] } : {}),
            });
          },
        });
      }
    ));
  const channels: [string, keyof ReturnType<typeof createExtensionPluginHandlers>][] = [
    [IPC_CHANNELS.EXTENSION_PLUGINS_LIST, 'list'],
    [IPC_CHANNELS.EXTENSION_PLUGINS_PICK_AND_STAGE, 'pickAndStage'],
    [IPC_CHANNELS.EXTENSION_PLUGINS_STAGE_URL, 'stageUrl'],
    [IPC_CHANNELS.EXTENSION_PLUGINS_COMMIT, 'commit'],
    [IPC_CHANNELS.EXTENSION_PLUGINS_DISCARD, 'discard'],
    [IPC_CHANNELS.EXTENSION_PLUGINS_SET_ENABLED, 'setEnabled'],
    [IPC_CHANNELS.EXTENSION_PLUGINS_APPROVE_PENDING, 'approvePending'],
    [IPC_CHANNELS.EXTENSION_PLUGINS_REJECT_PENDING, 'rejectPending'],
    [IPC_CHANNELS.EXTENSION_PLUGINS_UNINSTALL, 'uninstall'],
    [IPC_CHANNELS.EXTENSION_PLUGINS_CONFIG_GET, 'configGet'],
    [IPC_CHANNELS.EXTENSION_PLUGINS_CONFIG_SET, 'configSet'],
    [IPC_CHANNELS.EXTENSION_PLUGINS_CALL, 'call'],
    [IPC_CHANNELS.EXTENSION_PLUGINS_DRAFT_RESPONSE, 'draftResponse'],
    [IPC_CHANNELS.EXTENSION_PLUGINS_ASSET, 'asset'],
  ];
  for (const [channel, key] of channels)
    ipcMain.handle(channel, async (event, ...args: unknown[]) => {
      if (!trusted(event))
        return { ok: false, error: '仅可信本地桌面可调用插件', code: 'PERMISSION_DENIED' };
      try {
        return await (await load())[key](event, ...args);
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    });
}
