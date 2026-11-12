import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ImageStudioResult } from '@shared/imageStudio';
import { parseImageStudioImageVariant, parseImageStudioSessionId } from '@shared/imageStudio';
import { IPC_CHANNELS } from '@shared/types/ipc';
import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { getImageProviderStore } from '../services/imageGeneration/providerHost';
import { ImageStudioService } from '../services/imageGeneration/studio';
import { sendToAllWindows } from '../windows/createAppWindow';
import { isMainWebContents } from '../windows/MainWindow';

export interface ImageStudioSender {
  sender: { id: number; mainFrame: unknown; getURL(): string };
  senderFrame: unknown;
}

/**
 * 图片工作台 IPC。
 *
 * 边界：
 * - 只信主窗口 top-frame + 精确 index URL；设置窗口、子 frame 一律 Forbidden。
 * - 入参保持 `unknown`，由服务用共享 parser 收窄；渲染层永远不传磁盘路径。
 * - 参考图路径只来自 Main 自己的原生选图对话框。
 * - 异常不跨 IPC 边界抛出，统一结构化 `{ ok: false, error }`。
 */
export function createImageStudioHandlers<E extends ImageStudioSender>(deps: {
  trusted(event: E): boolean;
  service(): ImageStudioService;
  pickReference(event: E): Promise<string | null>;
}) {
  const forbidden = { ok: false as const, error: 'Forbidden image studio request' };
  const invalid = { ok: false as const, error: 'Invalid image studio request' };
  const failed = <T>(error: unknown): ImageStudioResult<T> => ({
    ok: false,
    error: error instanceof Error && error.message ? error.message : 'Image studio failed',
  });

  const guard = async <T>(
    event: E,
    exactArgs: number,
    args: unknown[],
    run: (values: unknown[]) => Promise<ImageStudioResult<T>>
  ): Promise<ImageStudioResult<T>> => {
    if (!deps.trusted(event)) return forbidden;
    if (args.length !== exactArgs) return invalid;
    try {
      return await run(args);
    } catch (error) {
      return failed<T>(error);
    }
  };

  return {
    list: (event: E, ...args: unknown[]) => guard(event, 0, args, () => deps.service().list()),
    create: (event: E, ...args: unknown[]) => guard(event, 0, args, () => deps.service().create()),
    read: (event: E, ...args: unknown[]) =>
      guard(event, 1, args, ([sessionId]) => deps.service().read(sessionId)),
    generate: (event: E, ...args: unknown[]) =>
      guard(event, 1, args, ([request]) => deps.service().generate(request)),
    cancel: (event: E, ...args: unknown[]) =>
      guard(event, 1, args, ([sessionId]) => deps.service().cancel(sessionId)),
    remove: (event: E, ...args: unknown[]) =>
      guard(event, 1, args, ([sessionId]) => deps.service().remove(sessionId)),
    image: (event: E, ...args: unknown[]) => {
      if (!deps.trusted(event)) return Promise.resolve(forbidden);
      // 变体可有可无，但出现时必须是已知值；多余参数一律拒绝。
      if (args.length !== 2 && args.length !== 3) return Promise.resolve(invalid);
      const variant = parseImageStudioImageVariant(args[2]);
      if (!variant) return Promise.resolve(invalid);
      return deps
        .service()
        .image(args[0], args[1], variant)
        .catch(failed<{ dataUrl: string }>);
    },
    importReference: (event: E, ...args: unknown[]) => {
      if (!deps.trusted(event)) return Promise.resolve(forbidden);
      if (args.length !== 1) return Promise.resolve(invalid);
      // 会话 id 不合法时不该弹系统选图框。
      const sessionId = parseImageStudioSessionId(args[0]);
      if (!sessionId) return Promise.resolve(invalid);
      return deps
        .pickReference(event)
        .then((file) =>
          file === null
            ? ({ ok: true, value: null } as ImageStudioResult<null>)
            : deps.service().importReference(sessionId, file)
        )
        .catch(failed);
    },
  };
}

export function registerImageStudioHandlers(): void {
  let service: ImageStudioService | undefined;
  const current = (): ImageStudioService => {
    service ??= new ImageStudioService({
      root: path.join(app.getPath('userData'), 'image-studio'),
      // 复用独立图片服务配置（含 safeStorage 密钥），不读聊天 provider。
      provider: () => getImageProviderStore().secret() ?? undefined,
      // 变更广播由服务在每次落盘后发出，running turn 也立刻可见。
      changed: () => {
        sendToAllWindows(IPC_CHANNELS.IMAGE_STUDIO_CHANGED);
      },
    });
    return service;
  };
  const handlers = createImageStudioHandlers<Electron.IpcMainInvokeEvent>({
    trusted: (event) => {
      if (event.senderFrame !== event.sender.mainFrame) return false;
      if (!isMainWebContents(event.sender.id)) return false;
      const expected =
        !app.isPackaged && process.env.ELECTRON_RENDERER_URL
          ? `${process.env.ELECTRON_RENDERER_URL}/index.html`
          : pathToFileURL(path.join(import.meta.dirname, '../renderer/index.html')).href;
      return event.sender.getURL() === expected;
    },
    service: current,
    pickReference: async (event) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      const options: Electron.OpenDialogOptions = {
        title: '导入参考图',
        properties: ['openFile'],
        filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }],
      };
      const result = win
        ? await dialog.showOpenDialog(win, options)
        : await dialog.showOpenDialog(options);
      return result.canceled ? null : (result.filePaths[0] ?? null);
    },
  });
  ipcMain.handle(IPC_CHANNELS.IMAGE_STUDIO_LIST, handlers.list);
  ipcMain.handle(IPC_CHANNELS.IMAGE_STUDIO_CREATE, handlers.create);
  ipcMain.handle(IPC_CHANNELS.IMAGE_STUDIO_READ, handlers.read);
  ipcMain.handle(IPC_CHANNELS.IMAGE_STUDIO_GENERATE, handlers.generate);
  ipcMain.handle(IPC_CHANNELS.IMAGE_STUDIO_CANCEL, handlers.cancel);
  ipcMain.handle(IPC_CHANNELS.IMAGE_STUDIO_IMPORT_REFERENCE, handlers.importReference);
  ipcMain.handle(IPC_CHANNELS.IMAGE_STUDIO_IMAGE, handlers.image);
  ipcMain.handle(IPC_CHANNELS.IMAGE_STUDIO_REMOVE, handlers.remove);
}
