import { constants } from 'node:fs';
import { open, realpath, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import {
  isPairPreviewPathAllowed,
  PAIR_PREVIEW_STATIC_ORIGIN,
  pairPreviewCsp,
  pairPreviewFsPath,
} from './pairPreviewPolicy';

export const PAIR_PREVIEW_RESOURCE_LIMIT = 8 * 1024 * 1024;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject',
  '.wasm': 'application/wasm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.ogv': 'video/ogg',
  '.flac': 'audio/flac',
  '.aac': 'audio/aac',
  '.m4a': 'audio/mp4',
};

export interface PairPreviewStaticFiles {
  entryPath: string;
  respond(request: Request): Promise<Response>;
  close(): void;
}

export async function createPairPreviewServerFiles(
  root: string,
  origin: string
): Promise<{
  allowsRequest(url: string, resourceType?: string): Promise<boolean>;
  close(): void;
}> {
  const canonicalRoot = await realpath(root);
  const identity = await stat(canonicalRoot);
  let closed = false;
  let viteEnv: { path: string; dev: number; ino: number } | undefined;
  try {
    const load = createRequire(resolve(canonicalRoot, 'package.json'));
    const packagePath = await realpath(load.resolve('vite/package.json'));
    const envPath = await realpath(resolve(packagePath, '..', 'dist/client/env.mjs'));
    const info = await stat(envPath);
    if (info.isFile() && info.size <= PAIR_PREVIEW_RESOURCE_LIMIT) {
      viteEnv = { path: envPath, dev: info.dev, ino: info.ino };
    }
  } catch {
    /* Non-Vite servers need no out-of-root exception. */
  }
  const rootAsset = (file: string, allowedRoot = canonicalRoot): boolean => {
    const rel = relative(allowedRoot, file);
    if (!rel || isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) return false;
    const pathname = `/${rel.split(sep).map(encodeURIComponent).join('/')}`;
    return (
      isPairPreviewPathAllowed(pathname) &&
      (!!MIME[extname(file).toLowerCase()] || /\.(?:[jt]sx?|vue|svelte)$/.test(file))
    );
  };
  return {
    close() {
      closed = true;
    },
    async allowsRequest(url, resourceType) {
      if (
        closed ||
        !['script', 'stylesheet', 'image', 'font', 'media', 'xhr', 'other'].includes(
          resourceType ?? ''
        )
      )
        return false;
      const file = pairPreviewFsPath(url, origin);
      if (!file) return false;
      try {
        if ((await realpath(root)) !== canonicalRoot) return false;
        const currentRoot = await stat(canonicalRoot);
        if (currentRoot.dev !== identity.dev || currentRoot.ino !== identity.ino) return false;
        const canonical = await realpath(file);
        const info = await stat(canonical);
        if (!info.isFile() || info.size > PAIR_PREVIEW_RESOURCE_LIMIT) return false;
        if (
          viteEnv &&
          canonical === viteEnv.path &&
          info.dev === viteEnv.dev &&
          info.ino === viteEnv.ino
        )
          return !closed;
        return (
          !closed &&
          (rootAsset(resolve(file)) || rootAsset(resolve(file), resolve(root))) &&
          rootAsset(canonical)
        );
      } catch {
        return false;
      }
    },
  };
}

export async function createPairPreviewStaticFiles(
  root: string,
  entry: string
): Promise<PairPreviewStaticFiles> {
  if (!isAbsolute(root) || !isAbsolute(entry)) throw new Error('Absolute preview paths required');
  const rootPath = await realpath(root);
  const rootStat = await stat(rootPath);
  if (!rootStat.isDirectory()) throw new Error('Invalid preview root');
  let closed = false;

  const canonicalEntry = await realpath(entry);
  const lexicalEntry = resolve(rootPath, relative(resolve(root), entry));
  const lexicalRel = relative(rootPath, lexicalEntry);
  if (!isPairPreviewPathAllowed(`/${lexicalRel.split(sep).map(encodeURIComponent).join('/')}`))
    throw new Error('Not a preview asset');
  const entryRel = relative(rootPath, canonicalEntry);
  if (!entryRel || entryRel === '..' || entryRel.startsWith(`..${sep}`) || isAbsolute(entryRel))
    throw new Error('Outside preview root');
  if (!isPairPreviewPathAllowed(`/${entryRel.split(sep).map(encodeURIComponent).join('/')}`))
    throw new Error('Not a preview asset');
  const entryParent = resolve(canonicalEntry, '..');
  const entryName = canonicalEntry.split(sep).at(-1)?.toLowerCase();
  const parentName = entryParent.split(sep).at(-1)?.toLowerCase();
  const serveRoot =
    entryName === 'index.html' || entryName === 'index.htm'
      ? parentName === 'dist' || parentName === 'build'
        ? entryParent
        : rootPath
      : rootPath;
  const serveRootStat = await stat(serveRoot);
  const pathInRoot = (path: string): string => {
    const rel = relative(serveRoot, path);
    if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
      throw new Error('Outside preview root');
    }
    const urlPath = `/${rel.split(sep).map(encodeURIComponent).join('/')}`;
    if (!isPairPreviewPathAllowed(urlPath) || !MIME[extname(path).toLowerCase()]) {
      throw new Error('Not a preview asset');
    }
    return urlPath;
  };
  const assertRoot = async () => {
    if (closed || (await realpath(root)) !== rootPath)
      throw new Error('Preview closed or root moved');
    const current = await stat(rootPath);
    if (current.dev !== rootStat.dev || current.ino !== rootStat.ino)
      throw new Error('Root replaced');
    const currentServeRoot = await stat(serveRoot);
    if (
      (await realpath(serveRoot)) !== serveRoot ||
      currentServeRoot.dev !== serveRootStat.dev ||
      currentServeRoot.ino !== serveRootStat.ino
    )
      throw new Error('Preview mount replaced');
  };
  const read = async (path: string, head: boolean): Promise<{ body: Uint8Array; size: number }> => {
    await assertRoot();
    pathInRoot(path);
    const canonical = await realpath(path);
    pathInRoot(canonical); // A harmless-looking alias must not expose a hidden or secret target.
    const before = await stat(canonical);
    if (!before.isFile()) throw new Error('Not a file');
    if (before.size > PAIR_PREVIEW_RESOURCE_LIMIT) throw new ResourceTooLarge();
    const handle = await open(
      canonical,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
    );
    try {
      const opened = await handle.stat();
      if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino)
        throw new Error('File replaced');
      await assertRoot();
      if ((await realpath(path)) !== canonical) throw new Error('Path replaced');
      const current = await stat(canonical);
      if (current.dev !== opened.dev || current.ino !== opened.ino)
        throw new Error('File replaced');
      if (opened.size > PAIR_PREVIEW_RESOURCE_LIMIT) throw new ResourceTooLarge();
      if (head) return { body: new Uint8Array(), size: opened.size };
      // Never readFile(): a concurrently growing file must not allocate unbounded memory.
      const buffer = Buffer.alloc(Math.min(opened.size + 1, PAIR_PREVIEW_RESOURCE_LIMIT + 1));
      let count = 0;
      while (count < buffer.length) {
        const result = await handle.read(buffer, count, buffer.length - count, count);
        if (!result.bytesRead) break;
        count += result.bytesRead;
      }
      if (count > PAIR_PREVIEW_RESOURCE_LIMIT || count > opened.size) throw new ResourceTooLarge();
      await assertRoot();
      if ((await realpath(path)) !== canonical) throw new Error('Path replaced');
      const after = await stat(canonical);
      if (after.dev !== opened.dev || after.ino !== opened.ino) throw new Error('File replaced');
      return { body: buffer.subarray(0, count), size: count };
    } finally {
      await handle.close();
    }
  };
  const entryPath = pathInRoot(canonicalEntry);
  if (!['.html', '.htm'].includes(extname(canonicalEntry).toLowerCase()))
    throw new Error('HTML entry required');
  await read(canonicalEntry, true);

  return {
    entryPath,
    close() {
      closed = true;
    },
    async respond(request) {
      if (closed) return new Response(null, { status: 410 });
      const url = new URL(request.url);
      if (url.origin !== PAIR_PREVIEW_STATIC_ORIGIN || url.username || url.password)
        return new Response(null, { status: 403 });
      if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405 });
      if (request.headers.has('Service-Worker') || !isPairPreviewPathAllowed(url.pathname))
        return new Response(null, { status: 404 });
      try {
        const path = resolve(serveRoot, `.${decodeURIComponent(url.pathname)}`);
        pathInRoot(path);
        const asset = await read(path, request.method === 'HEAD');
        if (closed) return new Response(null, { status: 410 });
        return new Response(request.method === 'HEAD' ? null : new Uint8Array(asset.body), {
          status: 200,
          headers: {
            'Content-Type': MIME[extname(path).toLowerCase()],
            'Content-Length': String(asset.size),
            'X-Content-Type-Options': 'nosniff',
            'Cache-Control': 'no-store',
            'Referrer-Policy': 'no-referrer',
            'X-DNS-Prefetch-Control': 'off',
            'Content-Security-Policy': pairPreviewCsp(PAIR_PREVIEW_STATIC_ORIGIN),
          },
        });
      } catch (error) {
        return new Response(null, { status: error instanceof ResourceTooLarge ? 413 : 404 });
      }
    },
  };
}

class ResourceTooLarge extends Error {}
