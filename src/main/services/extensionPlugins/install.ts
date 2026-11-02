import { randomUUID } from 'node:crypto';
import {
  constants,
  existsSync,
  lstatSync,
  mkdirSync,
  realpathSync,
  renameSync,
  rmSync,
} from 'node:fs';
import { lstat, mkdir, open, readdir, readFile, realpath, rm } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { parsePluginInstallUrl, resolvePluginArchive } from '@shared/extensionPlugins/installUrl';
import {
  type ExtensionPluginManifest,
  isPluginRelativePath,
  parseExtensionPluginManifest,
} from '@shared/extensionPlugins/manifest';
import { type ArchiveFetch, downloadPluginArchive, type ResolveAddresses } from './download';
import { extractZip } from './zip';

export const MANIFEST_FILE = 'enso-plugin.json';
export interface StagedPlugin {
  token: string;
  pluginRoot: string;
  manifest: ExtensionPluginManifest;
  warnings: string[];
}
export type StageResult = { ok: true; staged: StagedPlugin } | { ok: false; error: string };
export type PluginInstallSource =
  | { kind: 'dir'; path: string }
  | { kind: 'zip'; path: string }
  | { kind: 'url'; url: string };
export interface StageDeps {
  fetch?: ArchiveFetch;
  resolve?: ResolveAddresses;
  timeoutMs?: number;
  signal?: AbortSignal;
}
const ID = /^[a-z][a-z0-9]*(\.[a-z0-9]+)+$/;
const DIR = /^[A-Za-z0-9-]{1,64}$/;
const TOKEN = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const SKIPPED = new Set(['.git', '.DS_Store']);
const MAX_ENTRIES = 5000;
const MAX_BYTES = 200 * 1024 * 1024;
const MAX_MANIFEST = 256 * 1024;
const within = (parent: string, child: string) => {
  const r = relative(parent, child);
  return !isAbsolute(r) && r.split(/[\\/]/).every((p) => p !== '..');
};
function identifiers(id: string, dir?: string): void {
  if (!ID.test(id) || id.length > 40 || (dir !== undefined && !DIR.test(dir)))
    throw new Error('插件路径标识不合法');
}
export const pluginPackagePath = (root: string, id: string, dir: string) => {
  identifiers(id, dir);
  return join(root, 'packages', id, dir);
};
export const pluginDataPath = (root: string, id: string) => {
  identifiers(id);
  return join(root, 'data', id);
};

/** Only app-owned paths are created/removed. Ancestor aliases (e.g. macOS /tmp) are canonicalized. */
function privateDir(path: string): string {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  const info = lstatSync(path);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('插件私有目录不能是链接');
  return realpathSync(path);
}
function internalDir(parent: string, child: string): string {
  const target = join(parent, child);
  const actual = privateDir(target);
  if (actual !== target) throw new Error('插件目录越界');
  return actual;
}

async function copyTree(
  src: string,
  dest: string,
  budget: { entries: number; bytes: number },
  signal?: AbortSignal,
  copy = true,
  depth = 0
): Promise<void> {
  signal?.throwIfAborted();
  if (depth > 100) throw new Error('插件目录过深');
  const info = await lstat(src);
  if (
    info.isSymbolicLink() ||
    (!info.isDirectory() && !info.isFile()) ||
    (info.isFile() && info.nlink !== 1)
  )
    throw new Error('插件目录包含链接或特殊文件');
  if (++budget.entries > MAX_ENTRIES) throw new Error('插件文件过多');
  if (info.isDirectory()) {
    if (copy) await mkdir(dest, { mode: 0o700, recursive: true });
    for (const name of await readdir(src)) {
      if (name.includes(':') || name.includes('\\') || hasControlCharacters(name))
        throw new Error('插件目录含不安全文件名');
      // Even ignored metadata must be scanned: a symlink anywhere rejects the source.
      await copyTree(
        join(src, name),
        join(dest, name),
        budget,
        signal,
        copy && !SKIPPED.has(name),
        depth + 1
      );
    }
    return;
  }
  budget.bytes += info.size;
  if (budget.bytes > MAX_BYTES) throw new Error('插件过大');
  const canonical = await realpath(src);
  const file = await open(canonical, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const actual = await file.stat();
    if (
      !actual.isFile() ||
      actual.nlink !== 1 ||
      actual.dev !== info.dev ||
      actual.ino !== info.ino ||
      actual.size !== info.size
    )
      throw new Error('插件源文件已变化');
    if (!copy) return;
    const out = await open(dest, 'wx', actual.mode & 0o111 ? 0o700 : 0o600);
    try {
      const buffer = Buffer.alloc(64 * 1024);
      let position = 0;
      while (position < info.size) {
        signal?.throwIfAborted();
        const { bytesRead } = await file.read(
          buffer,
          0,
          Math.min(buffer.length, info.size - position),
          position
        );
        if (!bytesRead) throw new Error('插件源文件已变化');
        await out.writeFile(buffer.subarray(0, bytesRead));
        position += bytesRead;
      }
      if ((await file.stat()).size !== info.size) throw new Error('插件源文件已变化');
    } finally {
      await out.close();
    }
  } finally {
    await file.close();
  }
}

async function verifyReferences(root: string, manifest: ExtensionPluginManifest): Promise<void> {
  const check = async (rel: string, kind: 'file' | 'dir') => {
    if (!isPluginRelativePath(rel)) throw new Error('清单引用路径不合法');
    const target = resolve(root, rel);
    if (!within(root, target)) throw new Error('清单引用越界');
    const info = await lstat(target);
    if (
      info.isSymbolicLink() ||
      !within(root, await realpath(target)) ||
      (kind === 'file' ? !info.isFile() || info.nlink !== 1 : !info.isDirectory())
    )
      throw new Error(`清单引用类型不合法：${rel}`);
  };
  for (const rel of [
    manifest.main,
    manifest.renderer,
    ...manifest.contributes.views.map((v) => v.entry),
  ])
    if (rel) await check(rel, 'file');
  for (const rel of manifest.contributes.skills) await check(rel, 'dir');
  for (const p of manifest.contributes.presets)
    for (const rel of [p.instruction, p.systemPrompt]) if (rel) await check(rel, 'file');
}

async function locate(dir: string): Promise<string> {
  try {
    if ((await lstat(join(dir, MANIFEST_FILE))).isFile()) return dir;
  } catch {
    /* wrapper */
  }
  const entries = (await readdir(dir)).filter((n) => n !== '__MACOSX' && n !== '.DS_Store');
  if (entries.length === 1 && (await lstat(join(dir, entries[0]))).isDirectory())
    return locate(join(dir, entries[0]));
  throw new Error(`找不到 ${MANIFEST_FILE}`);
}

export async function stagePlugin(
  root: string,
  source: PluginInstallSource,
  hostVersion: string,
  deps: StageDeps = {}
): Promise<StageResult> {
  const token = randomUUID();
  let staging: string | undefined;
  try {
    deps.signal?.throwIfAborted();
    const privateRoot = privateDir(root);
    if (source.kind === 'dir') {
      const info = await lstat(source.path);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('插件源必须是普通目录');
      const src = await realpath(source.path);
      if (within(src, privateRoot) || within(privateRoot, src))
        throw new Error('不能从插件数据目录或上级安装');
    }
    const stageParent = internalDir(privateRoot, 'staging');
    staging = join(stageParent, token);
    await mkdir(staging, { mode: 0o700 });
    let scanRoot = staging;
    if (source.kind === 'dir')
      await copyTree(source.path, staging, { entries: 0, bytes: 0 }, deps.signal);
    else if (source.kind === 'zip') await extractZip(source.path, staging, { signal: deps.signal });
    else {
      const parsed = parsePluginInstallUrl(source.url);
      if (!parsed.ok) throw new Error(parsed.error);
      if (
        ['github.com', 'www.github.com', 'api.github.com', 'codeload.github.com'].includes(
          parsed.url.hostname
        ) &&
        (parsed.url.protocol !== 'https:' || parsed.url.port)
      )
        throw new Error('GitHub 安装只支持公开 HTTPS');
      const archive = resolvePluginArchive(parsed.url);
      if (!archive.ok) throw new Error(archive.error);
      const zip = join(staging, '.plugin.zip');
      const tree = join(staging, 'tree');
      await downloadPluginArchive(archive.archive, zip, { ...deps, maxBytes: 100 * 1024 * 1024 });
      await extractZip(zip, tree, { signal: deps.signal });
      await rm(zip);
      scanRoot = tree;
      if (archive.subdir) {
        const entries = await readdir(tree);
        const base = entries.length === 1 ? join(tree, entries[0]) : tree;
        scanRoot = resolve(base, archive.subdir);
        if (!within(base, scanRoot)) throw new Error('仓库子目录越界');
      }
    }
    const pluginRoot = await locate(scanRoot);
    const manifestInfo = await lstat(join(pluginRoot, MANIFEST_FILE));
    if (!manifestInfo.isFile() || manifestInfo.nlink !== 1 || manifestInfo.size > MAX_MANIFEST)
      throw new Error('插件清单过大或类型不合法');
    const raw: unknown = JSON.parse(await readFile(join(pluginRoot, MANIFEST_FILE), 'utf8'));
    const manifest = parseExtensionPluginManifest(raw, hostVersion);
    if (!manifest.ok) throw new Error(manifest.errors.join('；'));
    await verifyReferences(pluginRoot, manifest.manifest);
    deps.signal?.throwIfAborted();
    return {
      ok: true,
      staged: { token, pluginRoot, manifest: manifest.manifest, warnings: manifest.warnings },
    };
  } catch (error) {
    if (staging) await rm(staging, { recursive: true, force: true });
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
function stagePath(root: string, token: string): string {
  if (!TOKEN.test(token)) throw new Error('暂存标识不合法');
  const privateRoot = privateDir(root);
  return join(internalDir(privateRoot, 'staging'), token);
}
export function discardStaged(root: string, staged: Pick<StagedPlugin, 'token'>): void {
  rmSync(stagePath(root, staged.token), { recursive: true, force: true });
}
export function commitStaged(root: string, staged: StagedPlugin): string {
  identifiers(staged.manifest.id);
  const staging = stagePath(root, staged.token);
  const sourceInfo = lstatSync(staged.pluginRoot);
  const source = realpathSync(staged.pluginRoot);
  if (
    !within(staging, source) ||
    source !== resolve(staged.pluginRoot) ||
    !sourceInfo.isDirectory() ||
    sourceInfo.isSymbolicLink()
  )
    throw new Error('插件暂存目录越界');
  const dir = randomUUID();
  const packages = internalDir(privateDir(root), 'packages');
  const parent = internalDir(packages, staged.manifest.id);
  const target = join(parent, dir);
  renameSync(source, target);
  discardStaged(root, staged);
  return dir;
}
export function removePackage(root: string, id: string, dir: string): void {
  identifiers(id, dir);
  const packages = join(privateDir(root), 'packages');
  if (!existsSync(packages)) return;
  const parent = join(packages, id);
  for (const path of [packages, parent]) {
    if (!existsSync(path)) return;
    if (lstatSync(path).isSymbolicLink() || realpathSync(path) !== path)
      throw new Error('插件删除路径包含链接');
  }
  rmSync(join(parent, dir), { recursive: true, force: true });
}

/** Control characters in an entry name would escape logs and filesystem expectations. */
function hasControlCharacters(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}
