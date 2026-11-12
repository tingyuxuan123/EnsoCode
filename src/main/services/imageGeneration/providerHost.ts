import path from 'node:path';
import { DEFAULT_IMAGE_PROVIDER, type ImageProviderSettings } from '@shared/imageProvider';
import { app, net, safeStorage } from 'electron';
import { queryImageProviderModels } from './providerApi';
import { ImageProviderStore } from './providerStore';

let store: ImageProviderStore | undefined;
export function getImageProviderStore(): ImageProviderStore {
  store ??= new ImageProviderStore({
    file: path.join(app.getPath('userData'), 'image-provider.json'),
    encryptionAvailable: () => {
      try {
        return (
          safeStorage.isEncryptionAvailable() &&
          (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text')
        );
      } catch {
        return false;
      }
    },
    encrypt: (value) => safeStorage.encryptString(value),
    decrypt: (value) => safeStorage.decryptString(value),
  });
  return store;
}

/** Undefined means the user has never configured the new image connection: preserve legacy references. */
export function independentImageProvider():
  | { config: ImageProviderSettings; apiKey: string }
  | undefined {
  const current = getImageProviderStore();
  const view = current.read();
  if (view.ok && !view.value.configured) return undefined;
  return (
    current.secret() ?? { config: view.ok ? view.value.config : DEFAULT_IMAGE_PROVIDER, apiKey: '' }
  );
}

export async function queryConfiguredImageModels() {
  const connection = getImageProviderStore().secret();
  if (!connection)
    return { ok: false as const, error: 'Save the image API address and key first.' };
  // Like model-provider discovery, use Chromium networking after proxy setup.
  const result = await queryImageProviderModels(
    { baseUrl: connection.config.baseUrl, apiKey: connection.apiKey },
    {
      prepare: async () => {
        const { getProxyConfig } = await import('../proxyConfig');
        await getProxyConfig().whenReady();
      },
      fetch: (input, init) =>
        net.fetch(
          typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url,
          init
        ),
    }
  );
  const current = getImageProviderStore().secret();
  if (
    !current ||
    current.config.baseUrl !== connection.config.baseUrl ||
    current.apiKey !== connection.apiKey
  )
    return {
      ok: false as const,
      error: 'Image connection changed during model discovery. Try again.',
    };
  return result;
}
