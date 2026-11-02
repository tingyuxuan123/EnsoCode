import { isIP } from 'node:net';
import type { DesignNetworkRequest, DesignNetworkResponse } from '@shared/types/design';
import {
  isPublicAddress,
  resolvePublicAddresses,
  safePluginFetch,
} from '../extensionPlugins/download';
import { DesignServiceError, tooLarge } from './errors';
export const publicNetworkAddress = isPublicAddress;

/** sources.ts + catalog-sync.ts URLs, and their first-party image/CDN hosts.
 * Other origins only get the public-image GET/base64 tier, never a general fetch capability.
 */
export const DESIGN_NETWORK_HOSTS = new Set([
  'api.openverse.org',
  'commons.wikimedia.org',
  'upload.wikimedia.org',
  'images-api.nasa.gov',
  'images-assets.nasa.gov',
  'images.nasa.gov',
  'picsum.photos',
  'fastly.picsum.photos',
  'raw.githubusercontent.com',
  'cdn.jsdelivr.net',
]);
export function allowedNetworkUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.port &&
      DESIGN_NETWORK_HOSTS.has(url.hostname)
    );
  } catch {
    return false;
  }
}
export function externalUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}
export function networkRequestTier(request: DesignNetworkRequest): 'api' | 'image' | null {
  if (!externalUrl(request.url)) return null;
  const url = new URL(request.url);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (
    url.port ||
    host === 'localhost' ||
    /\.(?:localhost|local|internal)$/.test(host) ||
    (isIP(host) && !publicNetworkAddress(host))
  )
    return null;
  if (allowedNetworkUrl(request.url)) return 'api';
  return (request.method ?? 'GET') === 'GET' &&
    request.responseType === 'base64' &&
    request.body === undefined
    ? 'image'
    : null;
}
const publicDns = async (host: string): Promise<string[]> =>
  (await resolvePublicAddresses(host)).map((entry) => entry.address);
export async function requestNetwork(
  request: DesignNetworkRequest,
  fetcher: (url: string, init: RequestInit) => Promise<Response> = safePluginFetch,
  resolve = publicDns
): Promise<DesignNetworkResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), request.timeoutMs ?? 30000);
  timer.unref();
  const bounded = <T>(promise: Promise<T>): Promise<T> =>
    new Promise((resolve, reject) => {
      const abort = () =>
        reject(new DesignServiceError('TIMEOUT', 'Design network request timed out'));
      if (controller.signal.aborted) {
        abort();
        return;
      }
      controller.signal.addEventListener('abort', abort, { once: true });
      promise
        .then(resolve, reject)
        .finally(() => controller.signal.removeEventListener('abort', abort));
    });
  try {
    let url = request.url;
    for (let hop = 0; hop <= 5; hop++) {
      const tier = networkRequestTier({ ...request, url });
      if (!tier)
        throw new DesignServiceError('HOST_NOT_ALLOWED', `Design network host not allowed: ${url}`);
      const host = new URL(url).hostname.replace(/^\[|\]$/g, '');
      let addresses: string[];
      try {
        addresses = isIP(host) ? [host] : await bounded(resolve(host));
      } catch (error) {
        if (controller.signal.aborted) throw error;
        throw new DesignServiceError('HOST_NOT_ALLOWED', 'Cannot resolve a public network address');
      }
      if (!addresses.length || addresses.some((ip) => !publicNetworkAddress(ip)))
        throw new DesignServiceError(
          'HOST_NOT_ALLOWED',
          'Private or reserved network address denied'
        );
      const headers: Record<string, string> = {};
      for (const [key, value] of Object.entries(request.headers ?? {})) {
        if (
          !['accept', 'content-type', 'user-agent', 'if-none-match', 'if-modified-since'].includes(
            key.toLowerCase()
          )
        )
          throw new DesignServiceError('INVALID_ARGUMENT', 'Network header not allowed');
        headers[key] = value;
      }
      if (request.body) headers['content-type'] = 'application/json';
      // safePluginFetch checks every actual connection's DNS and pins it to a verified public IP.
      const response = await bounded(
        fetcher(url, {
          method: request.method ?? 'GET',
          headers,
          body: request.body ? JSON.stringify(request.body.value) : undefined,
          redirect: 'manual',
          signal: controller.signal,
          credentials: 'omit',
        })
      );
      if ([301, 302, 303, 307, 308].includes(response.status) && response.headers.has('location')) {
        await response.body?.cancel();
        url = new URL(response.headers.get('location') ?? '', url).href;
        continue;
      }
      const max = 10 * 1024 * 1024;
      if (
        tier === 'image' &&
        !/^image\/[a-z0-9.+-]+(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')
      ) {
        await response.body?.cancel();
        throw new DesignServiceError('HOST_NOT_ALLOWED', 'External download must be an image');
      }
      if (Number(response.headers.get('content-length')) > max) {
        await response.body?.cancel();
        tooLarge();
      }
      const chunks: Uint8Array[] = [];
      let size = 0;
      const reader = response.body?.getReader();
      if (reader)
        for (;;) {
          const { done, value } = await bounded(reader.read());
          if (done) break;
          size += value.length;
          if (size > max) {
            await reader.cancel();
            tooLarge();
          }
          chunks.push(value);
        }
      const bytes = Buffer.concat(chunks);
      const body: unknown =
        request.responseType === 'base64'
          ? bytes.toString('base64')
          : request.responseType === 'text'
            ? bytes.toString('utf8')
            : bytes.length
              ? JSON.parse(bytes.toString('utf8'))
              : null;
      return {
        ok: true,
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(
          [...response.headers].filter(([key]) => key.toLowerCase() !== 'set-cookie')
        ),
        body,
      };
    }
    throw new DesignServiceError('FAILED', 'Too many redirects');
  } catch (error) {
    if (controller.signal.aborted)
      throw new DesignServiceError('TIMEOUT', 'Design network request timed out');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
