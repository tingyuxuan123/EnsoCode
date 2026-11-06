import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { toDesignSdkPath } from '@shared/design/paths';
import type { DesignCanvasPresence, DesignResult, DesignRootRef } from '@shared/types/design';
import { IPC_CHANNELS } from '@shared/types/ipc';
import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { setDesignCanvasCwds } from '../services/agentHost';
import { DesignCaptureService } from '../services/design/capture';
import { DesignEngineService } from '../services/design/engine';
import { DesignServiceError, failure } from '../services/design/errors';
import { designFs, designOpenFiles, designSaveAs } from '../services/design/fs';
import { getDesignPaths, getDesignToolBroker } from '../services/design/index';
import { requestNetwork } from '../services/design/network';
import { EnginePidRegistry } from '../services/design/orphans';
import {
  parseCanvasPresence,
  parseCapture,
  parseEngine,
  parseFs,
  parseNetwork,
  parseOpenFiles,
  parsePreview,
  parseProjects,
  parseRegistration,
  parseRoot,
  parseSaveAs,
  parseScript,
  parseShell,
  parseStorage,
  parseWatch,
  token,
} from '../services/design/parsers';
import { DesignPreviewService } from '../services/design/preview';
import { DesignProjectsService } from '../services/design/projects';
import { resolveDesignRoot } from '../services/design/roots';
import { DesignScriptService } from '../services/design/scripts';
import { checkedPath } from '../services/design/security';
import { DesignStorage } from '../services/design/storage';
import { DesignWatchService } from '../services/design/watch';
import { getWindowWebContents, sendToWindow } from '../windows/createAppWindow';
import { designWindowSession } from '../windows/DesignWindow';
import { getMainWindow } from '../windows/MainWindow';
import { isTrustedPluginSender } from './extensionPlugins';

interface SenderEvent {
  sender: {
    id: number;
    isDestroyed(): boolean;
    mainFrame: unknown;
    once(event: 'destroyed', callback: () => void): unknown;
  };
  senderFrame: unknown;
}
type Handler = (event: SenderEvent, raw: unknown) => Promise<unknown>;
const invalid = (): DesignResult => ({
  ok: false,
  code: 'INVALID_ARGUMENT',
  error: 'Invalid design request',
});

/** All channels, including runtime replies, share the same top-level main-frame guard. */
export function createDesignHandlers(deps: {
  trusted(event: SenderEvent): boolean;
  owner(id: number): BrowserWindow | null;
  engine: DesignEngineService;
  capture: DesignCaptureService;
  scripts: DesignScriptService;
  watch: DesignWatchService;
  storage: DesignStorage;
  projectRoot(sessionId: string): string | null | Promise<string | null>;
  canvasCwds(cwds: string[]): void;
  /** 独立设计窗口绑定的根会话（Main 权威）；主窗口等其它 sender 返回 null。 */
  dedicatedSession(senderId: number): string | null;
  projects?: DesignProjectsService;
  preview?: DesignPreviewService;
}) {
  const attached = new Set<number>();
  const canvases = new Map<number, DesignCanvasPresence & { cwd?: string }>();
  let lastCwds = '[]';
  const publish = () => {
    const cwds = [
      ...new Set(
        [...canvases.values()].flatMap((entry) => (entry.open && entry.cwd ? [entry.cwd] : []))
      ),
    ].sort();
    const key = JSON.stringify(cwds);
    if (key === lastCwds) return;
    lastCwds = key;
    deps.canvasCwds(cwds);
  };
  const release = (owner: number) => {
    attached.delete(owner);
    canvases.delete(owner);
    publish();
    getDesignToolBroker().releaseOwner(owner);
    deps.engine.releaseOwner(owner);
    deps.watch.releaseOwner(owner);
    deps.capture.releaseOwner(owner);
    deps.scripts.releaseOwner(owner);
    deps.preview?.releaseOwner(owner);
  };
  const guard =
    (handler: Handler): Handler =>
    async (event, raw) => {
      if (!deps.trusted(event))
        return {
          ok: false,
          code: 'PERMISSION_DENIED',
          error: 'Only the trusted local main window can use design services',
        };
      try {
        if (!attached.has(event.sender.id)) {
          attached.add(event.sender.id);
          event.sender.once('destroyed', () => release(event.sender.id));
        }
        return await handler(event, raw);
      } catch (error) {
        return failure(error);
      }
    };
  /** 独立设计窗口只服务绑定会话：其它会话 / 项目的根一律拒绝（纵深防御，不依赖 Renderer 自律）。 */
  const scope = (event: SenderEvent, root: DesignRootRef) => {
    const bound = deps.dedicatedSession(event.sender.id);
    if (bound && (root.kind !== 'session' || root.sessionId !== bound))
      throw new DesignServiceError(
        'PERMISSION_DENIED',
        'A design window can only access its own session workspace'
      );
  };
  const mainOnly = (event: SenderEvent) => {
    if (deps.dedicatedSession(event.sender.id))
      throw new DesignServiceError('PERMISSION_DENIED', 'Not available in a design window');
  };
  return {
    canvasPresence: guard(async (event, raw) => {
      const request = parseCanvasPresence(raw);
      if (!request) return invalid();
      const bound = deps.dedicatedSession(event.sender.id);
      if (bound && request.sessionId !== null && request.sessionId !== bound) return invalid();
      const entry: DesignCanvasPresence & { cwd?: string } = { ...request };
      canvases.set(event.sender.id, entry);
      if (entry.open && entry.sessionId) {
        const cwd = await deps.projectRoot(entry.sessionId);
        if (canvases.get(event.sender.id) !== entry || event.sender.isDestroyed())
          return { ok: true };
        if (cwd) entry.cwd = cwd;
      }
      publish();
      return { ok: true };
    }),
    resolveRoot: guard(async (_event, raw) => {
      const ref = parseRoot(raw);
      if (!ref) return invalid();
      scope(_event, ref);
      const root = await resolveDesignRoot(ref);
      return { ok: true, root: { ...root, path: toDesignSdkPath(root.path) } };
    }),
    fs: guard(async (_event, raw) => {
      const request = parseFs(raw);
      if (!request) return invalid();
      scope(_event, request.root);
      return designFs(request);
    }),
    saveAs: guard(async (event, raw) => {
      const request = parseSaveAs(raw);
      const owner = deps.owner(event.sender.id);
      return request && owner ? designSaveAs(owner, request) : invalid();
    }),
    openFiles: guard(async (event, raw) => {
      const request = parseOpenFiles(raw);
      const owner = deps.owner(event.sender.id);
      return request && owner ? designOpenFiles(owner, request) : invalid();
    }),
    projects: guard(async (_event, raw) => {
      mainOnly(_event);
      const request = parseProjects(raw);
      return request && deps.projects ? deps.projects.request(request) : invalid();
    }),
    preview: guard(async (event, raw) => {
      const request = parsePreview(raw);
      return request && deps.preview ? deps.preview.request(event.sender.id, request) : invalid();
    }),
    watch: guard(async (event, raw) => {
      const request = parseWatch(raw);
      if (!request) return invalid();
      scope(event, request.root);
      return deps.watch.start(event.sender.id, request);
    }),
    unwatch: guard(async (event, raw) => {
      if (!token(raw)) return invalid();
      deps.watch.stop(event.sender.id, raw);
      return { ok: true };
    }),
    engine: guard(async (event, raw) => {
      const request = parseEngine(raw);
      if (!request) return invalid();
      if ('root' in request) scope(event, request.root);
      return deps.engine.request(event.sender.id, request);
    }),
    capture: guard(async (event, raw) => {
      const request = parseCapture(raw);
      return request ? deps.capture.request(event.sender.id, request) : invalid();
    }),
    script: guard(async (event, raw) => {
      const request = parseScript(raw);
      if (!request) return invalid();
      scope(event, request.root);
      return deps.scripts.request(event.sender.id, request);
    }),
    storage: guard(async (_event, raw) => {
      const request = parseStorage(raw);
      return request ? deps.storage.request(request) : invalid();
    }),
    network: guard(async (_event, raw) => {
      const request = parseNetwork(raw);
      return request ? requestNetwork(request) : invalid();
    }),
    shell: guard(async (event, raw) => {
      const request = parseShell(raw);
      if (!request) return invalid();
      if (request.op === 'openExternal') await shell.openExternal(request.url);
      else if (request.op === 'openEngineRoute') {
        const engine = deps.engine.registered(event.sender.id, request.engineId);
        if (!engine)
          throw new DesignServiceError(
            'PERMISSION_DENIED',
            'Opening a preview requires a live design engine owned by this window'
          );
        const origin = `http://127.0.0.1:${engine.port}`;
        const url = new URL(request.path, origin);
        if (url.origin !== origin)
          throw new DesignServiceError(
            'PERMISSION_DENIED',
            'Preview route must stay on its design engine'
          );
        await shell.openExternal(url.href);
      } else {
        scope(event, request.root);
        const root = await resolveDesignRoot(request.root);
        shell.showItemInFolder(await checkedPath(root.path, request.rel));
      }
      return { ok: true };
    }),
    registerRuntime: guard(async (event, raw) => {
      const request = parseRegistration(raw);
      if (!request) return invalid();
      // 独立设计窗口只服务 Main 绑定的会话：不采信 Renderer 上报的 viewingSessionId。
      const bound = deps.dedicatedSession(event.sender.id);
      getDesignToolBroker().register(
        event.sender.id,
        bound ? { viewingSessionId: bound } : request,
        Boolean(bound)
      );
      return { ok: true };
    }),
    toolResponse: guard(async (event, raw) =>
      getDesignToolBroker().respond(event.sender.id, raw) ? { ok: true } : invalid()
    ),
  };
}

export function registerDesignHandlers(): void {
  // This is eager even though design handlers/services are lazy: clean previous crashes on startup.
  new EnginePidRegistry(getDesignPaths().engineBase).cleanup();
  const entryUrl = (entry: string) =>
    !app.isPackaged && process.env.ELECTRON_RENDERER_URL
      ? `${process.env.ELECTRON_RENDERER_URL}/${entry}.html`
      : pathToFileURL(join(import.meta.dirname, `../renderer/${entry}.html`)).href;
  const expected = entryUrl('index');
  const expectedDesign = entryUrl('design');
  const owner = (id: number) =>
    BrowserWindow.getAllWindows().find(
      (win) => !win.isDestroyed() && getWindowWebContents(win).id === id
    ) ?? null;
  const trusted = (event: SenderEvent) => {
    const main = getMainWindow();
    if (
      isTrustedPluginSender(event, {
        mainId: main && !main.isDestroyed() ? getWindowWebContents(main).id : null,
        settingsId: null,
        mainUrl: expected,
        settingsUrl: '',
      })
    )
      return true;
    // 独立设计窗口：同样要求顶层 frame 且停留在应用自己的 design 入口。
    return (
      designWindowSession(event.sender.id) !== null &&
      isTrustedPluginSender(event, {
        mainId: event.sender.id,
        settingsId: null,
        mainUrl: expectedDesign,
        settingsUrl: '',
      })
    );
  };
  const send = (id: number, channel: string, event: unknown) => {
    const win = owner(id);
    if (win) sendToWindow(win, channel, event);
  };
  let handlers: ReturnType<typeof createDesignHandlers> | undefined;
  let dispose: (() => void) | undefined;
  const load = async () => {
    if (handlers) return handlers;
    const registry = (await import('./agent')).getSourceAuthorityRegistry();
    if (!registry) throw new Error('Project authority is not ready');
    // Other requests may have initialized the services while the authority import yielded.
    if (handlers) return handlers;
    const engine = new DesignEngineService(send);
    const capture = new DesignCaptureService((id, engineId) => engine.registered(id, engineId));
    const scripts = new DesignScriptService();
    const watch = new DesignWatchService(send);
    const storage = new DesignStorage(getDesignPaths().storageDir);
    const preview = new DesignPreviewService();
    handlers = createDesignHandlers({
      trusted,
      owner,
      engine,
      capture,
      scripts,
      watch,
      storage,
      projects: new DesignProjectsService(
        join(app.getPath('documents'), 'EnsoCode', 'Designs'),
        registry,
        storage
      ),
      preview,
      projectRoot: async (sessionId) => (await import('./agent')).pluginProjectRoot(sessionId),
      canvasCwds: setDesignCanvasCwds,
      dedicatedSession: designWindowSession,
    });
    dispose = () => {
      getDesignToolBroker().dispose();
      engine.dispose();
      capture.dispose();
      scripts.dispose();
      watch.dispose();
      void preview.dispose();
    };
    return handlers;
  };
  app.once('will-quit', () => dispose?.());
  const channels: Array<[string, keyof ReturnType<typeof createDesignHandlers>]> = [
    [IPC_CHANNELS.DESIGN_RESOLVE_ROOT, 'resolveRoot'],
    [IPC_CHANNELS.DESIGN_FS, 'fs'],
    [IPC_CHANNELS.DESIGN_SAVE_AS, 'saveAs'],
    [IPC_CHANNELS.DESIGN_OPEN_FILES, 'openFiles'],
    [IPC_CHANNELS.DESIGN_PROJECTS, 'projects'],
    [IPC_CHANNELS.DESIGN_PREVIEW, 'preview'],
    [IPC_CHANNELS.DESIGN_WATCH, 'watch'],
    [IPC_CHANNELS.DESIGN_UNWATCH, 'unwatch'],
    [IPC_CHANNELS.DESIGN_ENGINE, 'engine'],
    [IPC_CHANNELS.DESIGN_CAPTURE, 'capture'],
    [IPC_CHANNELS.DESIGN_SCRIPT, 'script'],
    [IPC_CHANNELS.DESIGN_STORAGE, 'storage'],
    [IPC_CHANNELS.DESIGN_NETWORK, 'network'],
    [IPC_CHANNELS.DESIGN_SHELL, 'shell'],
    [IPC_CHANNELS.DESIGN_RUNTIME_REGISTER, 'registerRuntime'],
    [IPC_CHANNELS.DESIGN_TOOL_RESPONSE, 'toolResponse'],
    [IPC_CHANNELS.DESIGN_CANVAS_PRESENCE, 'canvasPresence'],
  ];
  for (const [channel, key] of channels)
    ipcMain.handle(channel, async (event, raw: unknown) => {
      if (!trusted(event))
        return {
          ok: false,
          code: 'PERMISSION_DENIED',
          error: 'Only the trusted local main window can use design services',
        };
      try {
        return await (await load())[key](event, raw);
      } catch (error) {
        return failure(error);
      }
    });
}
