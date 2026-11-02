import { lookup } from 'node:dns/promises';
import { lstat, open, rm } from 'node:fs/promises';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { Readable } from 'node:stream';

export { parsePluginInstallUrl } from '@shared/extensionPlugins/installUrl';

const REDIRECT = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 5;
const DEFAULT_TIMEOUT_MS = 60_000;
const GITHUB_HOSTS = new Set([
  'github.com',
  'www.github.com',
  'api.github.com',
  'codeload.github.com',
]);

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}
export type ResolveAddresses = (hostname: string) => Promise<readonly ResolvedAddress[]>;
export interface ArchiveResponse {
  status: number;
  headers: { get(name: string): string | null };
  body: ReadableStream<Uint8Array> | null;
}
/** Trusted transport seam: implementations MUST connect only to addresses; tests use offline fakes. */
export type ArchiveFetch = (
  url: string,
  init: { signal: AbortSignal; redirect: 'manual'; addresses: readonly ResolvedAddress[] }
) => Promise<ArchiveResponse>;
export interface DownloadPluginOptions {
  fetch?: ArchiveFetch;
  resolve?: ResolveAddresses;
  maxBytes: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

const isPrivate = (address: string): boolean => {
  if (isIP(address) === 4) {
    const p = address.split('.').map(Number);
    return (
      p[0] === 0 ||
      p[0] === 10 ||
      p[0] === 127 ||
      (p[0] === 169 && p[1] === 254) ||
      (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
      (p[0] === 192 && p[1] === 168) ||
      (p[0] === 100 && p[1] >= 64 && p[1] <= 127) ||
      (p[0] === 198 && (p[1] === 18 || p[1] === 19)) ||
      (p[0] === 192 && p[1] === 0 && (p[2] === 0 || p[2] === 2)) ||
      (p[0] === 192 && p[1] === 88 && p[2] === 99) ||
      (p[0] === 198 && p[1] === 51 && p[2] === 100) ||
      (p[0] === 203 && p[1] === 0 && p[2] === 113) ||
      p[0] >= 224
    );
  }
  if (isIP(address) !== 6 || address.includes('%')) return true;
  // Only native global unicast; reject mapped/translated IPv4, multicast, Teredo and 6to4.
  const normalized = new URL(`http://[${address}]/`).hostname.slice(1, -1);
  const [first, second = '0'] = normalized.split(':');
  const prefix = Number.parseInt(first, 16);
  return (
    !Number.isFinite(prefix) ||
    prefix < 0x2000 ||
    prefix > 0x3fff ||
    prefix === 0x2002 ||
    (prefix === 0x2001 && (Number.parseInt(second || '0', 16) < 0x0200 || second === 'db8')) ||
    prefix >= 0x3ff0
  );
};

export function isPublicAddress(address: string): boolean {
  return (isIP(address) === 4 || isIP(address) === 6) && !isPrivate(address);
}

export async function resolvePublicAddresses(
  hostname: string
): Promise<readonly ResolvedAddress[]> {
  if (isIP(hostname)) {
    if (!isPublicAddress(hostname)) throw new Error('下载地址指向内网');
    return [{ address: hostname, family: isIP(hostname) as 4 | 6 }];
  }
  const records = await lookup(hostname, { all: true, verbatim: true });
  const addresses = records.map((r) => ({ address: r.address, family: r.family as 4 | 6 }));
  if (!addresses.length || addresses.some((r) => !isPublicAddress(r.address)))
    throw new Error('下载地址指向内网');
  return addresses;
}

function secureUrl(url: URL): void {
  if (url.protocol !== 'https:' || url.username || url.password || !url.hostname)
    throw new Error('下载地址不合法');
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(hostname) && !isPublicAddress(hostname)) throw new Error('下载地址指向内网');
  if (GITHUB_HOSTS.has(hostname) && (url.protocol !== 'https:' || url.port))
    throw new Error('下载地址必须使用公开 HTTPS');
}

function defaultFetch(
  urlString: string,
  init: Parameters<ArchiveFetch>[1]
): Promise<ArchiveResponse> {
  const url = new URL(urlString);
  secureUrl(url);
  if (!init.addresses.length) return Promise.reject(new Error('下载地址未解析'));
  return new Promise((resolve, reject) => {
    // Connect to the checked numeric IP, not a hostname that could be re-resolved.
    // Disable pooled sockets/proxies; preserve Host and TLS certificate/SNI checks.
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    const pinned = init.addresses[0];
    const req = httpsRequest(
      {
        hostname: pinned.address,
        family: pinned.family,
        servername: isIP(hostname) ? undefined : hostname,
        port: url.port || undefined,
        agent: false,
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        headers: {
          host: url.host,
          'user-agent': 'EnsoCode-plugin-installer',
          accept: 'application/zip',
          'accept-encoding': 'identity',
        },
      },
      (res) => {
        resolve({
          status: res.statusCode ?? 0,
          headers: {
            get: (name) => {
              const value = res.headers[name.toLowerCase()];
              return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
            },
          },
          body: Readable.toWeb(res) as ReadableStream<Uint8Array>,
        });
      }
    );
    const abort = () =>
      req.destroy(init.signal.reason instanceof Error ? init.signal.reason : new Error('aborted'));
    if (init.signal.aborted) abort();
    else init.signal.addEventListener('abort', abort, { once: true });
    req.once('close', () => init.signal.removeEventListener('abort', abort));
    req.once('error', reject);
    req.end();
  });
}

async function writeBody(
  body: ReadableStream<Uint8Array> | null,
  dest: string,
  maxBytes: number,
  signal: AbortSignal,
  onCreate: () => void
): Promise<void> {
  if (!body) throw new Error('下载没有内容');
  const file = await open(dest, 'wx', 0o600);
  onCreate();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let received = 0;
  try {
    reader = body.getReader();
    for (;;) {
      signal.throwIfAborted();
      const { done, value } = await abortable(reader.read(), signal);
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) throw new Error('插件过大');
      await file.writeFile(value);
    }
  } finally {
    void reader?.cancel().catch(() => undefined);
    await file.close();
  }
  if (!received) throw new Error('下载没有内容');
}

export async function downloadPluginArchive(
  url: URL,
  dest: string,
  options: DownloadPluginOptions
): Promise<void> {
  let current = url;
  const fetcher = options.fetch ?? defaultFetch;
  let created = false;
  const maxBytes = Math.min(options.maxBytes, 100 * 1024 * 1024);
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error('下载大小限制不合法');
  const signal = options.signal
    ? AbortSignal.any([
        options.signal,
        AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      ])
    : AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    // Never truncate or remove a caller-owned destination, including broken symlinks.
    await lstat(dest).then(
      () => {
        throw new Error('下载目标已存在');
      },
      (error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
      }
    );
    secureUrl(current);
    const initialHost = current.hostname.toLowerCase();
    for (let redirects = 0; ; redirects++) {
      signal.throwIfAborted();
      const hostname = current.hostname.replace(/^\[|\]$/g, '');
      const addresses = await abortable(
        (options.resolve ?? resolvePublicAddresses)(hostname),
        signal
      );
      if (
        !addresses.length ||
        addresses.some((r) => isIP(r.address) !== r.family || !isPublicAddress(r.address))
      )
        throw new Error('下载地址指向内网');
      const response = await abortable(
        fetcher(current.href, { signal, redirect: 'manual', addresses }),
        signal
      );
      if (REDIRECT.has(response.status)) {
        void response.body?.cancel().catch(() => undefined);
        if (redirects >= MAX_REDIRECTS) throw new Error('重定向过多');
        const location = response.headers.get('location');
        if (!location) throw new Error('重定向地址不合法');
        const next = new URL(location, current);
        secureUrl(next);
        if (
          next.protocol !== current.protocol ||
          next.port !== current.port ||
          (next.hostname.toLowerCase() !== initialHost &&
            !(
              GITHUB_HOSTS.has(initialHost) &&
              GITHUB_HOSTS.has(next.hostname.toLowerCase()) &&
              next.protocol === 'https:'
            ))
        )
          throw new Error('重定向地址不合法');
        current = next;
        continue;
      }
      if (response.status < 200 || response.status >= 300) {
        void response.body?.cancel().catch(() => undefined);
        throw new Error(`下载失败（HTTP ${response.status}）`);
      }
      const length = response.headers.get('content-length');
      if (length !== null && (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length)))) {
        void response.body?.cancel?.().catch(() => undefined);
        throw new Error('下载大小声明不合法');
      }
      if (length !== null && Number(length) > maxBytes) {
        void response.body?.cancel?.().catch(() => undefined);
        throw new Error('插件过大');
      }
      await writeBody(response.body, dest, maxBytes, signal, () => {
        created = true;
      });
      return;
    }
  } catch (error) {
    if (created) await rm(dest, { force: true });
    if (options.signal?.aborted) throw new Error('下载已取消');
    if (
      error instanceof Error &&
      (error.name === 'AbortError' ||
        error.name === 'TimeoutError' ||
        error.message === 'The operation was aborted')
    )
      throw new Error('下载超时');
    if (
      error instanceof Error &&
      /^(插件过大|重定向|下载没有内容|下载失败|下载地址|不支持|链接)/.test(error.message)
    )
      throw error;
    throw new Error('无法下载插件');
  }
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

/**
 * 插件 `net.fetch` 的 Main 侧传输：域名必须在清单里，解析结果必须是公网地址，
 * 并在实际请求中把连接钉到已校验的地址，避免 DNS 重绑定把请求带回内网。
 */
export async function safePluginFetch(url: string, init: RequestInit): Promise<Response> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('插件网络请求地址不合法');
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error('插件网络请求只支持 http(s) 且不允许内嵌凭据');
  }
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '');
  if (isIP(hostname)) {
    if (!isPublicAddress(hostname)) throw new Error('插件网络请求不支持内网地址');
  } else {
    const addresses = await resolvePublicAddresses(hostname);
    if (!addresses.length || addresses.some((entry) => !isPublicAddress(entry.address))) {
      throw new Error('插件网络请求不支持内网地址');
    }
  }
  const { Agent, fetch: undiciFetch } = await import('undici');
  const pinned = new Agent({
    connect: {
      lookup: (host, options, callback) => {
        resolvePublicAddresses(host)
          .then((addresses) => {
            const match =
              addresses.find((entry) =>
                options.family === 4 || options.family === 6
                  ? entry.family === options.family
                  : true
              ) ?? addresses[0];
            if (!match || !isPublicAddress(match.address)) {
              callback(new Error('插件网络请求不支持内网地址'), '', undefined as never);
              return;
            }
            callback(null, [{ address: match.address, family: match.family }]);
          })
          .catch((error: unknown) =>
            callback(
              error instanceof Error ? error : new Error(String(error)),
              '',
              undefined as never
            )
          );
      },
    },
  });
  try {
    return (await undiciFetch(url, {
      ...(init as object),
      dispatcher: pinned,
      redirect: 'manual',
    } as never)) as unknown as Response;
  } finally {
    void pinned.close().catch(() => undefined);
  }
}
