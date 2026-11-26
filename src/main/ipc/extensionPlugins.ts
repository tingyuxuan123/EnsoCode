import { lstatSync, readFileSync, statSync } from 'node:fs';
import { copyFile } from 'node:fs/promises';
import { extname, isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type {
  ExtensionPluginInstallPreview,
  ExtensionPluginReadmeResult,
  PluginAuthoringOptions,
} from '@shared/extensionPlugins/types';
import { IPC_CHANNELS } from '@shared/types';
import { app, BrowserWindow, dialog, ipcMain, webContents } from 'electron';
import type { DraftBroker } from '../services/extensionPlugins/draftBroker';
import { PluginAuthoring } from '../services/extensionPlugins/pluginAuthoring';
import type { ExtensionPluginService, UiCallMethod } from '../services/extensionPlugins/service';
import { setPluginAssetResolver } from '../services/localImageProtocol';
import { getWindowWebContents, sendToAllWindows } from '../windows/createAppWindow';
import { designWindowSession } from '../windows/DesignWindow';
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
const authoringSessionId = (v: unknown): v is string =>
  typeof v === 'string' && /^[A-Za-z0-9-]{1,128}$/.test(v);
function authoringOptions(raw: unknown): PluginAuthoringOptions | null {
  if (
    !record(raw) ||
    Object.keys(raw).some((key) => !['template', 'request'].includes(key)) ||
    typeof raw.request !== 'string' ||
    raw.request.length > 4000 ||
    !raw.request.trim()
  )
    return null;
  const template = raw.template;
  if (
    template !== 'workspace' &&
    template !== 'sidebar' &&
    template !== 'command' &&
    template !== 'tool'
  )
    return null;
  return { template, request: raw.request.trim() };
}
const methods = ['command.run', 'trigger.candidates', 'trigger.pick', 'renderer.call'] as const;
const CONFIG_KEY = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;
const safeKey = (key: string) => !['__proto__', 'constructor', 'prototype'].includes(key);
export function parseConfigPatch(
  raw: unknown
): Record<string, string | number | boolean | null> | null {
  if (!record(raw) || Object.keys(raw).length > 20) return null;
  const patch: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!CONFIG_KEY.test(key) || !safeKey(key)) return null;
    if (
      value === null ||
      typeof value === 'boolean' ||
      (typeof value === 'string' && Buffer.byteLength(value) <= 4096) ||
      (typeof value === 'number' && Number.isFinite(value))
    )
      patch[key] = value;
    else return null;
  }
  return patch;
}
export function parseViewStatePatch(raw: unknown): Record<string, string | null> | null {
  if (!record(raw) || Object.keys(raw).length > 500) return null;
  const patch: Record<string, string | null> = {};
  let size = 0;
  for (const [key, value] of Object.entries(raw)) {
    if (
      !key ||
      key.length > 256 ||
      key.includes('\0') ||
      !safeKey(key) ||
      (value !== null && typeof value !== 'string')
    )
      return null;
    size += Buffer.byteLength(key) + (typeof value === 'string' ? Buffer.byteLength(value) : 0);
    if (size > 1024 * 1024) return null;
    patch[key] = value;
  }
  return patch;
}
const artifactId = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value) && !value.includes('..');
const mime: Record<string, string> = {
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.html': 'text/html',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.woff2': 'font/woff2',
};
type Handler = (event: PluginSenderEvent, ...args: unknown[]) => unknown;
interface HandlerDeps {
  trusted(event: PluginSenderEvent): boolean;
  authoringTrusted?(event: PluginSenderEvent): boolean;
  authoring?: Pick<PluginAuthoring, 'create' | 'validate' | 'stage'> &
    Partial<
      Pick<
        PluginAuthoring,
        | 'context'
        | 'open'
        | 'inspect'
        | 'test'
        | 'export'
        | 'stageTrial'
        | 'trialLoaded'
        | 'finishTrial'
        | 'editInstalled'
        | 'evidence'
        | 'rollback'
      >
    >;
  /**
   * 只读插件摘要/素材的额外发送方：协作看板、独立设计窗口等跟随应用外观的应用窗口
   * 也要读插件调色板（`list` + `asset`）。管理、安装、调用类通道一律不走这条路径。
   */
  readTrusted?(event: PluginSenderEvent): boolean;
  service(): ExtensionPluginService;
  draft(): DraftBroker;
  projectRoot(sessionId: string): string | null;
  sessionGeneration?(sessionId: string): string | null;
  signal?(event: PluginSenderEvent): AbortSignal;
  pickPath?(event: PluginSenderEvent, kind: 'file' | 'directory'): Promise<string | null>;
  save?(event: PluginSenderEvent, name: string): Promise<string | null>;
  pick(
    event: PluginSenderEvent,
    kind: 'dir' | 'zip'
  ): Promise<{ canceled: boolean; filePaths: string[] }>;
}
/**
 * Every privileged operation shares the same sender/frame guard, including draft replies.
 * `list` / `asset` also accept `readTrusted` senders: windows that only follow the app
 * appearance need the palette, and reading plugin metadata must not grant management rights.
 */
export function createExtensionPluginHandlers(deps: HandlerDeps) {
  const deny = {
    ok: false,
    error: '仅可信本地桌面主界面或设置窗口可管理插件',
    code: 'PERMISSION_DENIED',
  };
  const guard =
    (handler: Handler, readOnly = false): Handler =>
    async (e, ...args) => {
      if (!deps.trusted(e) && !(readOnly && deps.readTrusted?.(e))) return deny;
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
  const forAuthoring = (handler: Handler): Handler =>
    guard((event, ...args) => (deps.authoringTrusted?.(event) ? handler(event, ...args) : deny));
  return {
    list: guard(() => deps.service().list(), true),
    registryNotice: guard(() => deps.service().registryNotice()),
    dismissRegistryNotice: guard(() => {
      deps.service().dismissRegistryNotice();
      return { ok: true };
    }),
    restage: guard((e, pluginId) =>
      id(pluginId) ? deps.service().restage(pluginId, e.sender.id, deps.signal?.(e)) : invalid
    ),
    checkUpdates: guard(async () => ({ ok: true, ...(await deps.service().checkUpdates()) })),
    marketList: guard((_e, refresh) =>
      refresh === undefined || typeof refresh === 'boolean'
        ? deps.service().marketList(refresh === true)
        : invalid
    ),
    marketStage: guard((e, pluginId, version) =>
      id(pluginId) &&
      (version === undefined ||
        (typeof version === 'string' && version.length > 0 && version.length <= 40))
        ? deps
            .service()
            .stage(
              { kind: 'market', id: pluginId, ...(version ? { version } : {}) },
              e.sender.id,
              deps.signal?.(e)
            )
        : invalid
    ),
    marketSetMirror: guard((_e, enabled) => {
      if (typeof enabled !== 'boolean') return invalid;
      deps.service().setMarketChinaMirror(enabled);
      return { ok: true };
    }),
    readme: guard(async (_e, raw) => {
      if (!record(raw) || !id(raw.id) || (raw.from !== 'installed' && raw.from !== 'market'))
        return invalid;
      // Main 内部字段名是 markdown；跨 IPC 只发 text，避免渲染层读到 undefined 一直“加载中”
      const result = await deps.service().readme(raw.id, raw.from);
      const payload: ExtensionPluginReadmeResult = result.ok
        ? { ok: true, text: result.markdown }
        : { ok: false, error: result.error };
      return payload;
    }),
    setCrossSessionInject: guard((_e, pluginId, enabled) =>
      id(pluginId) && typeof enabled === 'boolean'
        ? deps.service().setCrossSessionInject(pluginId, enabled)
        : invalid
    ),
    setDevWatch: guard((_e, pluginId, enabled) =>
      id(pluginId) && typeof enabled === 'boolean'
        ? deps.service().setDevWatch(pluginId, enabled)
        : invalid
    ),
    logs: guard(async (_e, pluginId) =>
      id(pluginId) || pluginId === 'extension-plugins'
        ? { ok: true, text: await deps.service().logs(pluginId) }
        : invalid
    ),
    artifactsList: guard((_e, pluginId) =>
      pluginId === undefined || id(pluginId)
        ? { ok: true, artifacts: deps.service().listArtifacts(pluginId) }
        : invalid
    ),
    artifactRead: guard((_e, value) => {
      if (!artifactId(value)) return invalid;
      const service = deps.service();
      const info = service.artifactInfo(value);
      const path = info ? service.artifactPath(value) : null;
      if (!info || !path) return { ok: false, error: '产出不存在' };
      if (info.size > 8 * 1024 * 1024) return { ok: false, error: '产出过大' };
      const bytes = readFileSync(path);
      if (bytes.byteLength > 8 * 1024 * 1024) return { ok: false, error: '产出过大' };
      return { ok: true, info, base64: bytes.toString('base64') };
    }),
    artifactDelete: guard((_e, value) =>
      artifactId(value) ? { ok: deps.service().deleteArtifact(value) } : invalid
    ),
    artifactSave: guard(async (e, value) => {
      if (!artifactId(value) || !deps.save) return invalid;
      const info = deps.service().artifactInfo(value);
      if (!info || !deps.service().artifactPath(value)) return { ok: false, error: '产出不存在' };
      const destination = await deps.save(e, info.name.split(/[/\\]/).pop() || 'artifact');
      if (!destination) return { ok: true, cancelled: true };
      if (!deps.trusted(e)) return deny;
      const source = deps.service().artifactPath(value);
      if (!source) return { ok: false, error: '产出不存在' };
      await copyFile(source, destination);
      return { ok: true };
    }),
    viewStateGet: guard((_e, pluginId) =>
      id(pluginId) ? { ok: true, state: deps.service().viewStateGet(pluginId) } : invalid
    ),
    viewStateSet: guard((_e, pluginId, patch) => {
      const parsed = parseViewStatePatch(patch);
      return id(pluginId) && parsed ? deps.service().viewStateSet(pluginId, parsed) : invalid;
    }),
    pickPath: guard(async (e, kind) => {
      if ((kind !== 'file' && kind !== 'directory') || !deps.pickPath) return invalid;
      const path = await deps.pickPath(e, kind);
      return deps.trusted(e) ? { ok: true, path } : deny;
    }),
    createAuthoringDraft: forAuthoring((e, sessionId, options, ...extra) => {
      const parsed = options === undefined ? undefined : authoringOptions(options);
      if (!deps.authoring || !authoringSessionId(sessionId) || extra.length || parsed === null)
        return invalid;
      return parsed
        ? deps.authoring.create(e.sender.id, sessionId, deps.signal?.(e), parsed)
        : deps.authoring.create(e.sender.id, sessionId, deps.signal?.(e));
    }),
    authoringContext: forAuthoring((e, sessionId, ...extra) =>
      deps.authoring?.context && authoringSessionId(sessionId) && !extra.length
        ? deps.authoring.context(e.sender.id, sessionId)
        : invalid
    ),
    openAuthoringDraft: forAuthoring((e, sessionId, pluginId, installed, ...extra) => {
      if (
        !deps.authoring?.open ||
        !deps.authoring.editInstalled ||
        !authoringSessionId(sessionId) ||
        !id(pluginId) ||
        extra.length ||
        (installed !== undefined && typeof installed !== 'boolean')
      )
        return invalid;
      return installed
        ? deps.authoring.editInstalled(e.sender.id, sessionId, pluginId, deps.service())
        : deps.authoring.open(e.sender.id, sessionId, pluginId);
    }),
    inspectAuthoringDraft: forAuthoring((e, sessionId, pluginId, ...extra) =>
      deps.authoring?.inspect && authoringSessionId(sessionId) && id(pluginId) && !extra.length
        ? deps.authoring.inspect(e.sender.id, sessionId, pluginId, deps.service(), deps.signal?.(e))
        : invalid
    ),
    testAuthoringDraft: forAuthoring((e, sessionId, pluginId, confirmed, ...extra) =>
      deps.authoring?.test &&
      authoringSessionId(sessionId) &&
      id(pluginId) &&
      confirmed === true &&
      !extra.length
        ? deps.authoring.test(e.sender.id, sessionId, pluginId, true, deps.signal?.(e))
        : invalid
    ),
    stageAuthoringTrial: forAuthoring((e, sessionId, pluginId, ...extra) =>
      deps.authoring?.stageTrial && authoringSessionId(sessionId) && id(pluginId) && !extra.length
        ? deps.authoring.stageTrial(
            e.sender.id,
            sessionId,
            pluginId,
            deps.service(),
            deps.signal?.(e)
          )
        : invalid
    ),
    loadAuthoringTrial: forAuthoring((e, sessionId, pluginId, ...extra) =>
      deps.authoring?.trialLoaded && authoringSessionId(sessionId) && id(pluginId) && !extra.length
        ? deps.authoring.trialLoaded(e.sender.id, sessionId, pluginId, deps.service())
        : invalid
    ),
    finishAuthoringTrial: forAuthoring((e, sessionId, pluginId, confirmed, ...extra) =>
      deps.authoring?.finishTrial &&
      authoringSessionId(sessionId) &&
      id(pluginId) &&
      confirmed === true &&
      !extra.length
        ? deps.authoring.finishTrial(e.sender.id, sessionId, pluginId, deps.service())
        : invalid
    ),
    rollbackAuthoringDraft: forAuthoring((e, sessionId, pluginId, ...extra) =>
      deps.authoring?.rollback && authoringSessionId(sessionId) && id(pluginId) && !extra.length
        ? deps.authoring.rollback(e.sender.id, sessionId, pluginId, deps.service())
        : invalid
    ),
    authoringEvidence: forAuthoring((e, sessionId, pluginId, input, ...extra) => {
      if (
        !deps.authoring?.evidence ||
        !authoringSessionId(sessionId) ||
        !id(pluginId) ||
        extra.length ||
        !record(input) ||
        Object.keys(input).some(
          (key) => !['layer', 'sourceHash', 'note', 'models'].includes(key)
        ) ||
        (input.layer !== 'business' && input.layer !== 'models') ||
        typeof input.sourceHash !== 'string' ||
        !/^[a-f0-9]{64}$/.test(input.sourceHash) ||
        typeof input.note !== 'string' ||
        input.note.length > 2000
      )
        return invalid;
      if (
        input.models !== undefined &&
        (!Array.isArray(input.models) ||
          input.models.length > 8 ||
          input.models.some((model) => typeof model !== 'string' || model.length > 200))
      )
        return invalid;
      const models = Array.isArray(input.models)
        ? input.models.filter((model): model is string => typeof model === 'string')
        : undefined;
      return deps.authoring.evidence(e.sender.id, sessionId, pluginId, {
        layer: input.layer,
        sourceHash: input.sourceHash,
        note: input.note,
        ...(models ? { models } : {}),
      });
    }),
    exportAuthoringDraft: forAuthoring(async (e, sessionId, pluginId, ...extra) => {
      if (
        !deps.authoring?.export ||
        !deps.save ||
        !authoringSessionId(sessionId) ||
        !id(pluginId) ||
        extra.length
      )
        return invalid;
      const packed = await deps.authoring.export(
        e.sender.id,
        sessionId,
        pluginId,
        deps.signal?.(e)
      );
      try {
        const destination = await deps.save(e, packed.name);
        if (!destination) return { ok: true, cancelled: true };
        if (!deps.authoringTrusted?.(e)) return deny;
        await copyFile(packed.file, destination);
        return {
          ok: true,
          name: packed.name,
          sha256: packed.sha256,
          size: packed.size,
        };
      } finally {
        await packed.cleanup();
      }
    }),
    validateAuthoringDraft: forAuthoring((e, sessionId, pluginId, ...extra) =>
      deps.authoring && authoringSessionId(sessionId) && id(pluginId) && !extra.length
        ? deps.authoring.validate(e.sender.id, sessionId, pluginId, deps.signal?.(e))
        : invalid
    ),
    stageAuthoringDraft: forAuthoring((e, sessionId, pluginId, ...extra) =>
      deps.authoring && authoringSessionId(sessionId) && id(pluginId) && !extra.length
        ? deps.authoring.stage(e.sender.id, sessionId, pluginId, deps.service(), deps.signal?.(e))
        : invalid
    ),
    pickAndStage: guard(async (e, kind) => {
      if (kind !== 'dir' && kind !== 'zip') return invalid;
      const picked = await deps.pick(e, kind);
      if (picked.canceled || !picked.filePaths[0]) return { ok: true, cancelled: true };
      if (!deps.trusted(e)) return deny;
      return deps
        .service()
        .stage({ kind, path: picked.filePaths[0] }, e.sender.id, deps.signal?.(e));
    }),
    stagePath: guard(async (e, value) => {
      if (
        typeof value !== 'string' ||
        value.length > 4096 ||
        !isAbsolute(value) ||
        /[\p{Cc}\p{Cf}]/u.test(value)
      )
        return invalid;
      let info: ReturnType<typeof lstatSync>;
      try {
        info = lstatSync(value);
      } catch {
        return { ok: false, error: '拖入的文件或文件夹不可读。' };
      }
      if (info.isSymbolicLink())
        return { ok: false, error: '不支持符号链接，请拖入实际插件目录或 ZIP 文件。' };
      const kind = info.isDirectory()
        ? 'dir'
        : info.isFile() && /\.zip$/i.test(value)
          ? 'zip'
          : null;
      if (!kind) return { ok: false, error: '只能安装插件目录或 ZIP 插件包。' };
      return deps.service().stage({ kind, path: value }, e.sender.id, deps.signal?.(e));
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
      const parsed = parseConfigPatch(patch);
      return id(pluginId) && parsed ? deps.service().setConfig(pluginId, parsed) : invalid;
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
          generation:
            typeof raw.sessionId === 'string'
              ? (deps.sessionGeneration?.(raw.sessionId) ?? undefined)
              : undefined,
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
    }, true),
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
  const isMainAuthoringWindow = (event: PluginSenderEvent) => {
    const main = getMainWindow();
    return !!main && !main.isDestroyed() && getWindowWebContents(main).id === event.sender.id;
  };
  /**
   * 跟随应用外观的应用窗口（协作看板、独立设计窗口）只多读 `list` / `asset`：
   * 发送方必须是 Main 权威登记的那个窗口、顶层 frame，且停留在自己的入口文档。
   * 这两个窗口本身持有任务写入 / 设计服务权限，但插件管理、安装、调用、配置、
   * draft 等通道仍然只认主窗口与设置窗口。
   */
  const readTrusted = (event: PluginSenderEvent) => {
    const senderId = event.sender.id;
    const trustedAs = (url: string) =>
      isTrustedPluginSender(event, {
        mainId: senderId,
        settingsId: null,
        mainUrl: url,
        settingsUrl: '',
      });
    if (designWindowSession(senderId) !== null) return trustedAs(expected('design'));
    return false;
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
      ([
        { getExtensionPlugins, getDraftBroker },
        { pluginAuthoringWorkspace, pluginProjectRoot, pluginSessionGeneration },
      ]) => {
        const authoring = new PluginAuthoring({
          workspace: pluginAuthoringWorkspace,
          hostVersion: app.getVersion(),
          stateRoot: join(app.getPath('userData'), 'plugin-authoring'),
        });
        setPluginAssetResolver((id, rel) => getExtensionPlugins().assetMediaPath(id, rel));
        getExtensionPlugins().onChange(() =>
          sendToAllWindows(IPC_CHANNELS.EXTENSION_PLUGINS_CHANGED)
        );
        getExtensionPlugins().onNotice((notice) =>
          sendToAllWindows(IPC_CHANNELS.EXTENSION_PLUGINS_NOTICE, notice)
        );
        releaseOwner = (id) => {
          getExtensionPlugins().releaseOwner(id);
          getDraftBroker().releaseOwner(id);
          authoring.releaseOwner(id);
        };
        return createExtensionPluginHandlers({
          trusted,
          authoring,
          authoringTrusted: isMainAuthoringWindow,
          readTrusted,
          service: getExtensionPlugins,
          draft: getDraftBroker,
          projectRoot: pluginProjectRoot,
          sessionGeneration: pluginSessionGeneration,
          signal: (event) => {
            const contents = webContents.fromId(event.sender.id);
            return contents ? owners.signal(contents) : AbortSignal.abort();
          },
          pickPath: async (event, kind) => {
            const owner = BrowserWindow.getAllWindows().find(
              (w) => getWindowWebContents(w).id === event.sender.id
            );
            if (!owner) throw new Error('窗口不可用');
            const result = await dialog.showOpenDialog(owner, {
              properties: [kind === 'file' ? 'openFile' : 'openDirectory'],
            });
            return result.canceled ? null : (result.filePaths[0] ?? null);
          },
          save: async (event, name) => {
            const owner = BrowserWindow.getAllWindows().find(
              (w) => getWindowWebContents(w).id === event.sender.id
            );
            if (!owner) throw new Error('窗口不可用');
            const result = await dialog.showSaveDialog(owner, { defaultPath: name });
            return result.canceled ? null : (result.filePath ?? null);
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
    [IPC_CHANNELS.EXTENSION_PLUGINS_REGISTRY_NOTICE, 'registryNotice'],
    [IPC_CHANNELS.EXTENSION_PLUGINS_DISMISS_REGISTRY_NOTICE, 'dismissRegistryNotice'],
    [IPC_CHANNELS.EXTENSION_PLUGINS_RESTAGE, 'restage'],
    [IPC_CHANNELS.EXTENSION_PLUGINS_CHECK_UPDATES, 'checkUpdates'],
    [IPC_CHANNELS.EXTENSION_PLUGINS_MARKET_LIST, 'marketList'],
    [IPC_CHANNELS.EXTENSION_PLUGINS_MARKET_STAGE, 'marketStage'],
    [IPC_CHANNELS.EXTENSION_PLUGINS_MARKET_SET_MIRROR, 'marketSetMirror'],
    [IPC_CHANNELS.EXTENSION_PLUGINS_README, 'readme'],
    [IPC_CHANNELS.EXTENSION_PLUGINS_SET_CROSS_SESSION_INJECT, 'setCrossSessionInject'],
    [IPC_CHANNELS.EXTENSION_PLUGINS_SET_DEV_WATCH, 'setDevWatch'],
    [IPC_CHANNELS.EXTENSION_PLUGINS_LOGS, 'logs'],
    [IPC_CHANNELS.EXTENSION_PLUGINS_ARTIFACTS_LIST, 'artifactsList'],
    [IPC_CHANNELS.EXTENSION_PLUGINS_ARTIFACT_READ, 'artifactRead'],
    [IPC_CHANNELS.EXTENSION_PLUGINS_ARTIFACT_DELETE, 'artifactDelete'],
    [IPC_CHANNELS.EXTENSION_PLUGINS_ARTIFACT_SAVE, 'artifactSave'],
    [IPC_CHANNELS.EXTENSION_PLUGINS_VIEW_STATE_GET, 'viewStateGet'],
    [IPC_CHANNELS.EXTENSION_PLUGINS_VIEW_STATE_SET, 'viewStateSet'],
    [IPC_CHANNELS.EXTENSION_PLUGINS_PICK_PATH, 'pickPath'],
    [IPC_CHANNELS.EXTENSION_PLUGINS_AUTHORING_CREATE, 'createAuthoringDraft'],
    [IPC_CHANNELS.EXTENSION_PLUGINS_AUTHORING_VALIDATE, 'validateAuthoringDraft'],
    [IPC_CHANNELS.EXTENSION_PLUGINS_AUTHORING_STAGE, 'stageAuthoringDraft'],
    [IPC_CHANNELS.EXTENSION_PLUGINS_AUTHORING_CONTEXT, 'authoringContext'],
    [IPC_CHANNELS.EXTENSION_PLUGINS_AUTHORING_OPEN, 'openAuthoringDraft'],
    [IPC_CHANNELS.EXTENSION_PLUGINS_AUTHORING_INSPECT, 'inspectAuthoringDraft'],
    [IPC_CHANNELS.EXTENSION_PLUGINS_AUTHORING_TEST, 'testAuthoringDraft'],
    [IPC_CHANNELS.EXTENSION_PLUGINS_AUTHORING_TRIAL, 'stageAuthoringTrial'],
    [IPC_CHANNELS.EXTENSION_PLUGINS_AUTHORING_TRIAL_LOADED, 'loadAuthoringTrial'],
    [IPC_CHANNELS.EXTENSION_PLUGINS_AUTHORING_TRIAL_FINISH, 'finishAuthoringTrial'],
    [IPC_CHANNELS.EXTENSION_PLUGINS_AUTHORING_EXPORT, 'exportAuthoringDraft'],
    [IPC_CHANNELS.EXTENSION_PLUGINS_AUTHORING_EVIDENCE, 'authoringEvidence'],
    [IPC_CHANNELS.EXTENSION_PLUGINS_AUTHORING_ROLLBACK, 'rollbackAuthoringDraft'],
    [IPC_CHANNELS.EXTENSION_PLUGINS_PICK_AND_STAGE, 'pickAndStage'],
    [IPC_CHANNELS.EXTENSION_PLUGINS_STAGE_PATH, 'stagePath'],
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
  // 与 createExtensionPluginHandlers 的 readOnly 白名单保持一致：外层闸门先按通道键放行，
  // 否则 readTrusted 生效前就被拦掉，看板/设计窗口读不到调色板。
  const readOnlyChannels = new Set<string>([
    IPC_CHANNELS.EXTENSION_PLUGINS_LIST,
    IPC_CHANNELS.EXTENSION_PLUGINS_ASSET,
  ]);
  for (const [channel, key] of channels)
    ipcMain.handle(channel, async (event, ...args: unknown[]) => {
      const authoring =
        key === 'createAuthoringDraft' ||
        key === 'validateAuthoringDraft' ||
        key === 'stageAuthoringDraft' ||
        [
          'authoringContext',
          'openAuthoringDraft',
          'inspectAuthoringDraft',
          'testAuthoringDraft',
          'stageAuthoringTrial',
          'loadAuthoringTrial',
          'finishAuthoringTrial',
          'exportAuthoringDraft',
          'authoringEvidence',
          'rollbackAuthoringDraft',
        ].includes(key);
      const allowed = authoring
        ? trusted(event) && isMainAuthoringWindow(event)
        : trusted(event) || (readOnlyChannels.has(channel) && readTrusted(event));
      if (!allowed)
        return { ok: false, error: '仅可信本地桌面可调用插件', code: 'PERMISSION_DENIED' };
      try {
        return await (await load())[key](event, ...args);
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    });
}
