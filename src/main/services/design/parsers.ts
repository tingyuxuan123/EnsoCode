import type {
  DesignCanvasPresence,
  DesignCaptureRequest,
  DesignEngineRequest,
  DesignFsRequest,
  DesignNetworkRequest,
  DesignOpenFilesRequest,
  DesignPreviewRequest,
  DesignProjectsRequest,
  DesignRootRef,
  DesignRuntimeRegistration,
  DesignSaveAsRequest,
  DesignScriptRequest,
  DesignShellRequest,
  DesignStorageChange,
  DesignStorageRequest,
  DesignWatchRequest,
} from '@shared/types/design';
import { MAX_FILE_BYTES, record } from './errors';
import { externalUrl } from './network';
import { validDesignProjectName } from './projects';
import { isRelativePath, isStoragePath } from './security';

export const token = (v: unknown): v is string =>
  typeof v === 'string' && v.length > 0 && v.length <= 256 && !v.includes('\0');
const text = (v: unknown, max = MAX_FILE_BYTES * 1.4): v is string =>
  typeof v === 'string' && v.length <= max;
const encoding = (v: unknown): v is 'utf8' | 'base64' => v === 'utf8' || v === 'base64';
const strings = (v: unknown, max = 10000): v is string[] =>
  Array.isArray(v) && v.length <= max && v.every((s) => text(s, 4096));
const integer = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
const keys = (v: Record<string, unknown>, allowed: string[]): boolean =>
  Object.keys(v).every((k) => allowed.includes(k));

export function parseProjects(v: unknown): DesignProjectsRequest | null {
  if (!record(v)) return null;
  if (v.op === 'list' && keys(v, ['op'])) return { op: 'list' };
  if (v.op === 'create' && validDesignProjectName(v.name) && keys(v, ['op', 'name']))
    return { op: 'create', name: v.name };
  return v.op === 'setArchived' &&
    token(v.projectId) &&
    typeof v.archived === 'boolean' &&
    keys(v, ['op', 'projectId', 'archived'])
    ? { op: 'setArchived', projectId: v.projectId, archived: v.archived }
    : null;
}
export function parseOpenFiles(v: unknown): DesignOpenFilesRequest | null {
  if (!record(v) || !keys(v, ['title', 'filters', 'multiple', 'maxBytes'])) return null;
  if (
    (v.title !== undefined && !text(v.title, 500)) ||
    (v.multiple !== undefined && typeof v.multiple !== 'boolean') ||
    (v.maxBytes !== undefined && !integer(v.maxBytes, 1, MAX_FILE_BYTES))
  )
    return null;
  let filters: DesignOpenFilesRequest['filters'];
  if (v.filters !== undefined) {
    if (!Array.isArray(v.filters) || v.filters.length > 8) return null;
    filters = [];
    for (const filter of v.filters) {
      if (
        !record(filter) ||
        !keys(filter, ['name', 'extensions']) ||
        !text(filter.name, 100) ||
        !Array.isArray(filter.extensions) ||
        filter.extensions.length === 0 ||
        !filter.extensions.every((extension) => extension === 'vetdz' || extension === 'vetd')
      )
        return null;
      filters.push({ name: filter.name, extensions: [...filter.extensions] });
    }
  }
  return {
    ...(typeof v.title === 'string' ? { title: v.title } : {}),
    ...(typeof v.multiple === 'boolean' ? { multiple: v.multiple } : {}),
    ...(typeof v.maxBytes === 'number' ? { maxBytes: v.maxBytes } : {}),
    ...(filters ? { filters } : {}),
  };
}
export function parsePreview(v: unknown): DesignPreviewRequest | null {
  if (!record(v)) return null;
  if (v.op === 'open' && text(v.html, MAX_FILE_BYTES) && keys(v, ['op', 'html']))
    return { op: 'open', html: v.html };
  return v.op === 'close' && token(v.previewId) && keys(v, ['op', 'previewId'])
    ? { op: 'close', previewId: v.previewId }
    : null;
}
export function parseCanvasPresence(v: unknown): DesignCanvasPresence | null {
  return record(v) &&
    keys(v, ['sessionId', 'open']) &&
    (v.sessionId === null || (token(v.sessionId) && v.sessionId.trim().length > 0)) &&
    typeof v.open === 'boolean'
    ? { sessionId: v.sessionId, open: v.open }
    : null;
}
export function parseRoot(v: unknown): DesignRootRef | null {
  if (!record(v)) return null;
  if (v.kind === 'session' && token(v.sessionId) && keys(v, ['kind', 'sessionId']))
    return { kind: 'session', sessionId: v.sessionId };
  if (v.kind === 'project' && token(v.projectId) && keys(v, ['kind', 'projectId']))
    return { kind: 'project', projectId: v.projectId };
  return null;
}
export function parseFs(v: unknown): DesignFsRequest | null {
  if (!record(v)) return null;
  const root = parseRoot(v.root);
  if (!root) return null;
  if (v.op === 'rename')
    return isRelativePath(v.from) && isRelativePath(v.to) && keys(v, ['root', 'op', 'from', 'to'])
      ? { op: v.op, root, from: v.from, to: v.to }
      : null;
  if (!isRelativePath(v.rel)) return null;
  const base = { root, rel: v.rel };
  if (v.op === 'writeFile')
    return text(v.content) &&
      encoding(v.encoding) &&
      keys(v, ['root', 'op', 'rel', 'content', 'encoding'])
      ? { ...base, op: v.op, content: v.content, encoding: v.encoding }
      : null;
  if (v.op === 'listFilesRecursive') {
    if (
      !keys(v, ['root', 'op', 'rel', 'names', 'ignoredDirectories']) ||
      (v.names !== undefined &&
        (!strings(v.names) || !v.names.every((s) => s && !/[\\/\0]/.test(s)))) ||
      (v.ignoredDirectories !== undefined &&
        (!strings(v.ignoredDirectories) ||
          !v.ignoredDirectories.every((s) => s && !/[\\/\0]/.test(s))))
    )
      return null;
    return {
      ...base,
      op: v.op,
      ...(strings(v.names) ? { names: v.names } : {}),
      ...(strings(v.ignoredDirectories) ? { ignoredDirectories: v.ignoredDirectories } : {}),
    };
  }
  if (!keys(v, ['root', 'op', 'rel'])) return null;
  switch (v.op) {
    case 'readDir':
    case 'readFile':
    case 'readBinaryFile':
    case 'stat':
    case 'delete':
    case 'createDirectory':
      return { ...base, op: v.op };
    default:
      return null;
  }
}
// Package names/ranges only: no npm options, file:/git:/URL dependencies or shell fragments.
export const packageName = (v: string): boolean =>
  /^(?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*(?:@[a-zA-Z0-9.*^~<>=|+-]+)?$/.test(v);
export function parseEngine(v: unknown): DesignEngineRequest | null {
  if (!record(v)) return null;
  if (v.op === 'diagnostics' && keys(v, ['op'])) return { op: v.op };
  if ((v.op === 'status' || v.op === 'stop') && token(v.engineId) && keys(v, ['op', 'engineId']))
    return { op: v.op, engineId: v.engineId };
  const root = parseRoot(v.root);
  if (!root || !isRelativePath(v.designRel)) return null;
  const base = { root, designRel: v.designRel };
  if (v.op === 'start' && keys(v, ['root', 'designRel', 'op'])) return { ...base, op: v.op };
  if (
    v.op === 'build' &&
    isRelativePath(v.outRel) &&
    keys(v, ['root', 'designRel', 'op', 'outRel'])
  )
    return { ...base, op: v.op, outRel: v.outRel };
  if (
    v.op === 'install' &&
    keys(v, ['root', 'designRel', 'op', 'packages']) &&
    (v.packages === undefined || (strings(v.packages, 100) && v.packages.every(packageName)))
  )
    return { ...base, op: v.op, ...(strings(v.packages) ? { packages: v.packages } : {}) };
  return null;
}
export function capturePath(v: unknown): v is string {
  if (!text(v, 8192) || !v.startsWith('/') || v.startsWith('//') || /[\\\0\r\n\t]/.test(v))
    return false;
  try {
    const url = new URL(v, 'http://127.0.0.1:1');
    return url.origin === 'http://127.0.0.1:1';
  } catch {
    return false;
  }
}
export function parseCapture(v: unknown): DesignCaptureRequest | null {
  if (!record(v)) return null;
  if (v.op === 'release' && token(v.sessionKey) && keys(v, ['op', 'sessionKey']))
    return { op: v.op, sessionKey: v.sessionKey };
  if (
    v.op !== 'offscreen' ||
    !token(v.engineId) ||
    !capturePath(v.path) ||
    !integer(v.width, 1, 4096) ||
    !integer(v.height, 1, 4096) ||
    !keys(v, [
      'op',
      'engineId',
      'path',
      'width',
      'height',
      'sessionKey',
      'prepareScript',
      'readyExpression',
      'probeScript',
      'settleMs',
      'timeoutMs',
      'format',
      'quality',
    ])
  )
    return null;
  if (
    (v.sessionKey !== undefined && !token(v.sessionKey)) ||
    ['prepareScript', 'readyExpression', 'probeScript'].some(
      (k) => v[k] !== undefined && !text(v[k], 256000)
    ) ||
    (v.settleMs !== undefined && !integer(v.settleMs, 0, 5000)) ||
    (v.timeoutMs !== undefined && !integer(v.timeoutMs, 1, 60000)) ||
    (v.format !== undefined && v.format !== 'png' && v.format !== 'jpeg') ||
    (v.quality !== undefined &&
      (typeof v.quality !== 'number' ||
        !Number.isFinite(v.quality) ||
        v.quality < 0 ||
        v.quality > 1))
  )
    return null;
  return {
    op: 'offscreen',
    engineId: v.engineId,
    path: v.path,
    width: v.width,
    height: v.height,
    ...(token(v.sessionKey) ? { sessionKey: v.sessionKey } : {}),
    ...(typeof v.prepareScript === 'string' ? { prepareScript: v.prepareScript } : {}),
    ...(typeof v.readyExpression === 'string' ? { readyExpression: v.readyExpression } : {}),
    ...(typeof v.probeScript === 'string' ? { probeScript: v.probeScript } : {}),
    ...(typeof v.settleMs === 'number' ? { settleMs: v.settleMs } : {}),
    ...(typeof v.timeoutMs === 'number' ? { timeoutMs: v.timeoutMs } : {}),
    ...(v.format === 'png' || v.format === 'jpeg' ? { format: v.format } : {}),
    ...(typeof v.quality === 'number' ? { quality: v.quality } : {}),
  };
}
const historyCommands = new Set([
  'commit',
  'log',
  'status',
  'checkout',
  'restore',
  'pack',
  'unpack',
  'init',
  'show',
]);
function historyPayload(v: unknown): Record<string, unknown> | null {
  if (
    !record(v) ||
    typeof v.cmd !== 'string' ||
    !historyCommands.has(v.cmd) ||
    !keys(v, ['cmd', 'title', 'sha', 'filepath', 'limit', 'out', 'from', 'skipManifestOnly'])
  )
    return null;
  if (
    (v.title !== undefined && !text(v.title, 4000)) ||
    (v.sha !== undefined && (typeof v.sha !== 'string' || !/^[a-f0-9]{40}$/i.test(v.sha))) ||
    (v.filepath !== undefined && (!isRelativePath(v.filepath) || !v.filepath)) ||
    (v.limit !== undefined && !integer(v.limit, 1, 1000)) ||
    (v.skipManifestOnly !== undefined && typeof v.skipManifestOnly !== 'boolean')
  )
    return null;
  if (['show', 'checkout', 'restore'].includes(v.cmd) && !v.sha) return null;
  if (v.cmd === 'show' && !v.filepath) return null;
  return {
    cmd: v.cmd,
    ...(typeof v.title === 'string' ? { title: v.title } : {}),
    ...(typeof v.sha === 'string' ? { sha: v.sha } : {}),
    ...(typeof v.filepath === 'string' ? { filepath: v.filepath } : {}),
    ...(typeof v.limit === 'number' ? { limit: v.limit } : {}),
    ...(typeof v.skipManifestOnly === 'boolean' ? { skipManifestOnly: v.skipManifestOnly } : {}),
  };
}
export function parseScript(v: unknown): DesignScriptRequest | null {
  if (!record(v)) return null;
  const root = parseRoot(v.root);
  if (!root || !isRelativePath(v.designRel)) return null;
  if (v.script === 'history' && keys(v, ['script', 'root', 'designRel', 'payload'])) {
    const payload = historyPayload(v.payload);
    return payload ? { script: v.script, root, designRel: v.designRel, payload } : null;
  }
  if (
    v.script === 'check-syntax' &&
    strings(v.files, 10000) &&
    v.files.every((p) => isRelativePath(p) && /^(frames|components)\/.+\.tsx$/.test(p)) &&
    keys(v, ['script', 'root', 'designRel', 'files'])
  )
    return { script: v.script, root, designRel: v.designRel, files: [...v.files] };
  return null;
}
export function parseStorage(v: unknown): DesignStorageRequest | null {
  if (!record(v)) return null;
  if (
    v.op === 'list' &&
    (v.prefix === undefined || isRelativePath(v.prefix)) &&
    keys(v, ['op', 'prefix'])
  )
    return { op: v.op, ...(typeof v.prefix === 'string' ? { prefix: v.prefix } : {}) };
  if (
    v.op === 'readFile' &&
    isStoragePath(v.path) &&
    encoding(v.encoding) &&
    keys(v, ['op', 'path', 'encoding'])
  )
    return { op: v.op, path: v.path, encoding: v.encoding };
  if (
    v.op === 'readSnapshot' &&
    strings(v.paths) &&
    v.paths.every(isStoragePath) &&
    encoding(v.encoding) &&
    keys(v, ['op', 'paths', 'encoding'])
  )
    return { op: v.op, paths: [...v.paths], encoding: v.encoding };
  if (
    v.op !== 'commit' ||
    !Array.isArray(v.changes) ||
    v.changes.length > 1000 ||
    (v.expectedRevision !== undefined && !token(v.expectedRevision)) ||
    !keys(v, ['op', 'changes', 'expectedRevision'])
  )
    return null;
  const changes: DesignStorageChange[] = [];
  let length = 0;
  for (const c of v.changes) {
    if (!record(c) || !isStoragePath(c.path)) return null;
    if (c.type === 'remove' && keys(c, ['type', 'path']))
      changes.push({ type: 'remove', path: c.path });
    else if (
      c.type === 'write' &&
      text(c.data) &&
      encoding(c.encoding) &&
      keys(c, ['type', 'path', 'data', 'encoding'])
    ) {
      length += c.data.length;
      changes.push({ type: 'write', path: c.path, data: c.data, encoding: c.encoding });
    } else return null;
    if (length > MAX_FILE_BYTES * 1.4) return null;
  }
  return {
    op: 'commit',
    changes,
    ...(typeof v.expectedRevision === 'string' ? { expectedRevision: v.expectedRevision } : {}),
  };
}
function jsonWithinLimit(value: unknown, max: number): boolean {
  try {
    const json = JSON.stringify(value);
    return json !== undefined && json.length <= max;
  } catch {
    return false;
  }
}
export function parseNetwork(v: unknown): DesignNetworkRequest | null {
  if (
    !record(v) ||
    !text(v.url, 8192) ||
    (v.method !== undefined && v.method !== 'GET' && v.method !== 'POST') ||
    (v.responseType !== undefined &&
      v.responseType !== 'json' &&
      v.responseType !== 'text' &&
      v.responseType !== 'base64') ||
    (v.timeoutMs !== undefined && !integer(v.timeoutMs, 1, 60000)) ||
    !keys(v, ['url', 'method', 'headers', 'body', 'responseType', 'timeoutMs'])
  )
    return null;
  const headers: Record<string, string> = {};
  if (v.headers !== undefined) {
    if (!record(v.headers) || Object.keys(v.headers).length > 20) return null;
    for (const [k, val] of Object.entries(v.headers)) {
      if (!text(k, 100) || !text(val, 4000) || /[\r\n]/.test(k + val)) return null;
      headers[k] = val;
    }
  }
  if (
    v.body !== undefined &&
    (!record(v.body) ||
      v.body.type !== 'json' ||
      !keys(v.body, ['type', 'value']) ||
      !jsonWithinLimit(v.body.value, 1024 * 1024))
  )
    return null;
  return {
    url: v.url,
    ...(v.method === 'GET' || v.method === 'POST' ? { method: v.method } : {}),
    ...(v.headers !== undefined ? { headers } : {}),
    ...(record(v.body) ? { body: { type: 'json', value: v.body.value } } : {}),
    ...(v.responseType === 'json' || v.responseType === 'text' || v.responseType === 'base64'
      ? { responseType: v.responseType }
      : {}),
    ...(typeof v.timeoutMs === 'number' ? { timeoutMs: v.timeoutMs } : {}),
  };
}
export function parseShell(v: unknown): DesignShellRequest | null {
  if (!record(v)) return null;
  if (v.op === 'openExternal' && text(v.url, 8192) && externalUrl(v.url) && keys(v, ['op', 'url']))
    return { op: v.op, url: v.url };
  if (
    v.op === 'openEngineRoute' &&
    token(v.engineId) &&
    capturePath(v.path) &&
    keys(v, ['op', 'engineId', 'path'])
  )
    return { op: v.op, engineId: v.engineId, path: v.path };
  const root = parseRoot(v.root);
  return v.op === 'showItemInFolder' &&
    root &&
    isRelativePath(v.rel) &&
    keys(v, ['op', 'root', 'rel'])
    ? { op: v.op, root, rel: v.rel }
    : null;
}
export function parseSaveAs(v: unknown): DesignSaveAsRequest | null {
  if (
    !record(v) ||
    !token(v.defaultFileName) ||
    /[\\/\0]/.test(v.defaultFileName) ||
    v.defaultFileName === '.' ||
    v.defaultFileName === '..' ||
    !text(v.content) ||
    !encoding(v.encoding) ||
    (v.title !== undefined && !text(v.title, 256)) ||
    !keys(v, ['defaultFileName', 'content', 'encoding', 'title', 'filters'])
  )
    return null;
  const filters: Array<{ name: string; extensions: string[] }> = [];
  if (v.filters !== undefined) {
    if (!Array.isArray(v.filters) || v.filters.length > 20) return null;
    for (const f of v.filters) {
      if (
        !record(f) ||
        !text(f.name, 100) ||
        !strings(f.extensions, 20) ||
        !f.extensions.every((s) => /^[a-zA-Z0-9*]+$/.test(s))
      )
        return null;
      filters.push({ name: f.name, extensions: [...f.extensions] });
    }
  }
  return {
    defaultFileName: v.defaultFileName,
    content: v.content,
    encoding: v.encoding,
    ...(typeof v.title === 'string' ? { title: v.title } : {}),
    ...(v.filters !== undefined ? { filters } : {}),
  };
}
export function parseWatch(v: unknown): DesignWatchRequest | null {
  if (!record(v)) return null;
  const root = parseRoot(v.root);
  return root && isRelativePath(v.rel) && keys(v, ['root', 'rel']) ? { root, rel: v.rel } : null;
}
export function parseRegistration(v: unknown): DesignRuntimeRegistration | null {
  return record(v) &&
    (v.viewingSessionId === null || token(v.viewingSessionId)) &&
    keys(v, ['viewingSessionId'])
    ? { viewingSessionId: v.viewingSessionId }
    : null;
}
export const designParsers = {
  resolveRoot: parseRoot,
  fs: parseFs,
  engine: parseEngine,
  capture: parseCapture,
  script: parseScript,
  storage: parseStorage,
  network: parseNetwork,
  shell: parseShell,
  saveAs: parseSaveAs,
  watch: parseWatch,
  registerRuntime: parseRegistration,
};
export function parseDesignRequest(kind: string, raw: unknown): unknown {
  for (const [key, parser] of Object.entries(designParsers)) if (kind === key) return parser(raw);
  return null;
}
