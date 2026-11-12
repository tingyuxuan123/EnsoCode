import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ImageProviderResult, ImageProviderView } from '@shared/imageProvider';
import { normalizeImageProviderBaseUrl } from '@shared/imageProvider';
import { IPC_CHANNELS } from '@shared/types/ipc';
import { app, ipcMain } from 'electron';
import {
  getImageProviderStore,
  queryConfiguredImageModels,
} from '../services/imageGeneration/providerHost';
import { sendToAllWindows } from '../windows/createAppWindow';
import { isMainWebContents } from '../windows/MainWindow';
import { isSettingsWebContents } from '../windows/SettingsWindow';

interface Sender {
  sender: { id: number; mainFrame: unknown; getURL(): string };
  senderFrame: unknown;
}
export function createImageProviderHandlers(deps: {
  trusted(event: Sender): boolean;
  store: () => Pick<ReturnType<typeof getImageProviderStore>, 'read' | 'update' | 'setApiKey'>;
  models: typeof queryConfiguredImageModels;
  changed(): void;
}) {
  const forbidden = { ok: false as const, error: 'Forbidden image settings request' };
  const mutate = (result: ImageProviderResult<ImageProviderView>) => {
    if (result.ok) deps.changed();
    return result;
  };
  return {
    read: (event: Sender) => (deps.trusted(event) ? deps.store().read() : forbidden),
    update: (event: Sender, patch: unknown) =>
      deps.trusted(event) ? mutate(deps.store().update(patch)) : forbidden,
    setApiKey: (event: Sender, value: unknown) => {
      if (!deps.trusted(event)) return forbidden;
      if (
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        Object.keys(value).some((key) => key !== 'baseUrl' && key !== 'key') ||
        !('baseUrl' in value) ||
        !('key' in value)
      )
        return { ok: false as const, error: 'Invalid image credential request' };
      const current = deps.store().read();
      if (!current.ok) return current;
      if (normalizeImageProviderBaseUrl(value.baseUrl) !== current.value.config.baseUrl)
        return {
          ok: false as const,
          error: 'Image endpoint changed. Reload the settings and enter the key again.',
        };
      return mutate(deps.store().setApiKey(value.key));
    },
    models: async (event: Sender, ...args: unknown[]) => {
      if (!deps.trusted(event) || args.length) return forbidden;
      try {
        return await deps.models();
      } catch {
        return { ok: false as const, error: 'Image model discovery failed' };
      }
    },
  };
}

export function registerImageProviderHandlers(): void {
  const handlers = createImageProviderHandlers({
    trusted: (event) => {
      if (event.senderFrame !== event.sender.mainFrame) return false;
      const entry = isMainWebContents(event.sender.id)
        ? 'index'
        : isSettingsWebContents(event.sender.id)
          ? 'settings'
          : null;
      if (!entry) return false;
      const expected =
        !app.isPackaged && process.env.ELECTRON_RENDERER_URL
          ? `${process.env.ELECTRON_RENDERER_URL}/${entry}.html`
          : pathToFileURL(join(import.meta.dirname, `../renderer/${entry}.html`)).href;
      return event.sender.getURL() === expected;
    },
    store: getImageProviderStore,
    models: queryConfiguredImageModels,
    changed: () => {
      sendToAllWindows(IPC_CHANNELS.IMAGE_PROVIDER_CHANGED);
      void import('../services/agentHost')
        .then(({ pushImageGenerationConfig }) => pushImageGenerationConfig())
        .catch(() => {});
    },
  });
  ipcMain.handle(IPC_CHANNELS.IMAGE_PROVIDER_READ, handlers.read);
  ipcMain.handle(IPC_CHANNELS.IMAGE_PROVIDER_UPDATE, handlers.update);
  ipcMain.handle(IPC_CHANNELS.IMAGE_PROVIDER_SET_KEY, handlers.setApiKey);
  ipcMain.handle(IPC_CHANNELS.IMAGE_PROVIDER_MODELS, handlers.models);
}
