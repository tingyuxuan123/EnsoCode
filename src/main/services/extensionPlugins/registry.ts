import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { parsePluginInstallUrl } from '@shared/extensionPlugins/installUrl';
import {
  EXTENSION_PLUGIN_PERMISSIONS,
  isPluginRelativePath,
} from '@shared/extensionPlugins/manifest';
import { PLUGIN_STATES, type PluginRecord } from './lifecycle';

export interface RegistryFile {
  version: 1;
  plugins: PluginRecord[];
}
export interface RegistryReadResult extends RegistryFile {
  error?: string;
  backupPath?: string;
}
const ID = /^[a-z][a-z0-9]*(\.[a-z0-9]+)+$/;
const DIR = /^[A-Za-z0-9-]{1,64}$/;
const MAX_BYTES = 4 * 1024 * 1024;
const record = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const strings = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((s) => typeof s === 'string');
function grant(v: unknown): boolean {
  return (
    record(v) &&
    strings(v.permissions) &&
    v.permissions.every((p) => (EXTENSION_PLUGIN_PERMISSIONS as readonly string[]).includes(p)) &&
    strings(v.fsRead) &&
    v.fsRead.every(isPluginRelativePath) &&
    strings(v.fsWrite) &&
    v.fsWrite.every(isPluginRelativePath) &&
    strings(v.netDomains) &&
    typeof v.renderer === 'boolean' &&
    (v.mcpTools === undefined || strings(v.mcpTools)) &&
    Array.isArray(v.mcp) &&
    v.mcp.every(
      (m) =>
        record(m) &&
        typeof m.name === 'string' &&
        typeof m.command === 'string' &&
        strings(m.args) &&
        strings(m.envKeys)
    )
  );
}
function valid(v: unknown): v is PluginRecord {
  return (
    record(v) &&
    typeof v.id === 'string' &&
    v.id.length <= 40 &&
    ID.test(v.id) &&
    typeof v.version === 'string' &&
    v.version.length > 0 &&
    v.version.length <= 40 &&
    typeof v.dir === 'string' &&
    DIR.test(v.dir) &&
    (PLUGIN_STATES as readonly unknown[]).includes(v.state) &&
    grant(v.grant) &&
    typeof v.installedAt === 'number' &&
    Number.isFinite(v.installedAt) &&
    v.installedAt >= 0 &&
    (v.source === undefined || validSource(v.source)) &&
    (v.crossSessionInject === undefined || typeof v.crossSessionInject === 'boolean') &&
    (v.lastError === undefined ||
      (record(v.lastError) &&
        typeof v.lastError.at === 'number' &&
        Number.isFinite(v.lastError.at) &&
        v.lastError.at >= 0 &&
        typeof v.lastError.message === 'string' &&
        v.lastError.message.length <= 2000)) &&
    (v.pending === undefined ||
      (record(v.pending) &&
        typeof v.pending.version === 'string' &&
        v.pending.version.length > 0 &&
        v.pending.version.length <= 40 &&
        typeof v.pending.dir === 'string' &&
        DIR.test(v.pending.dir) &&
        grant(v.pending.grant)))
  );
}
function validSource(v: unknown): boolean {
  if (!record(v)) return false;
  if (v.kind === 'dir' || v.kind === 'zip')
    return (
      typeof v.path === 'string' &&
      v.path.length <= 4096 &&
      !v.path.includes('\0') &&
      isAbsolute(v.path)
    );
  if (v.kind === 'url')
    return typeof v.url === 'string' && v.url.length <= 8192 && parsePluginInstallUrl(v.url).ok;
  if (v.kind === 'market')
    return (
      typeof v.id === 'string' &&
      ID.test(v.id) &&
      v.id.length <= 40 &&
      (v.version === undefined ||
        (typeof v.version === 'string' && v.version.length > 0 && v.version.length <= 40)) &&
      // 历史记录没有 marketId（上游 enso 市场），仍要能读出来
      (v.marketId === undefined ||
        (typeof v.marketId === 'string' && /^[a-z][a-z0-9-]{0,31}$/.test(v.marketId)))
    );
  return false;
}
function assertFile(path: string): ReturnType<typeof lstatSync> | undefined {
  let info: ReturnType<typeof lstatSync>;
  try {
    info = lstatSync(path);
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT')
      return undefined;
    throw error;
  }
  if (!info.isFile() || info.nlink !== 1 || info.size > MAX_BYTES)
    throw new Error('登记表必须是有界普通文件');
  return info;
}
function privateRoot(root: string): string {
  const info = lstatSync(root);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('登记表目录不能是链接');
  return realpathSync(root);
}
function backupCorruptRegistry(directory: string, bytes: Buffer): string {
  const target = join(
    directory,
    `registry.json.${createHash('sha256').update(bytes).digest('hex')}.corrupt`
  );
  try {
    writeFileSync(target, bytes, { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (
      !(typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST')
    )
      throw error;
    // A pre-existing link/special file must never be accepted as a safe backup.
    if (!assertFile(target)) throw new Error('备份不可用');
  }
  const backups = readdirSync(directory).flatMap((name) => {
    if (!/^registry\.json\.[A-Za-z0-9.-]+\.corrupt$/.test(name)) return [];
    const path = join(directory, name);
    const info = lstatSync(path);
    return info.isFile() && info.nlink === 1 ? [{ path, mtime: info.mtimeMs }] : [];
  });
  // Keep the current backup even when timestamps tie or the clock moved backwards.
  const others = backups
    .filter((backup) => backup.path !== target)
    .sort((a, b) => b.mtime - a.mtime || a.path.localeCompare(b.path));
  for (const backup of others.slice(4)) rmSync(backup.path);
  return target;
}
export function readRegistry(root: string): RegistryReadResult {
  let raw: unknown;
  let bytes: Buffer | undefined;
  let directory: string | undefined;
  try {
    try {
      directory = privateRoot(root);
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT')
        return { version: 1, plugins: [] };
      throw error;
    }
    const path = join(directory, 'registry.json');
    const info = assertFile(path);
    if (!info) return { version: 1, plugins: [] };
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const actual = fstatSync(fd);
      if (
        actual.dev !== info.dev ||
        actual.ino !== info.ino ||
        actual.nlink !== 1 ||
        actual.size !== info.size ||
        !actual.isFile()
      )
        throw new Error('登记表已变化');
      const buffer = Buffer.alloc(info.size);
      let received = 0;
      while (received < buffer.length) {
        const n = readSync(fd, buffer, received, buffer.length - received, received);
        if (!n) throw new Error('登记表已变化');
        received += n;
      }
      bytes = buffer;
      raw = JSON.parse(bytes.toString('utf8'));
    } finally {
      closeSync(fd);
    }
    if (!record(raw) || raw.version !== 1 || !Array.isArray(raw.plugins))
      throw new Error('登记表格式不受支持');
    if (
      !raw.plugins.every(valid) ||
      new Set(raw.plugins.map((p) => p.id)).size !== raw.plugins.length
    )
      throw new Error('登记表含无效或重复记录');
    return { version: 1, plugins: raw.plugins };
  } catch (error) {
    let backupPath: string | undefined;
    // Never follow links or copy an unbounded/special file. Keep the original so a
    // later startup cannot mistake corruption for a missing registry.
    if (directory && bytes) {
      try {
        backupPath = backupCorruptRegistry(directory, bytes);
      } catch {
        // Backup IO failure must still leave the service fail-closed.
      }
    }
    return {
      version: 1,
      plugins: [],
      error: `插件登记表损坏或无法读取，已进入只读状态：${error instanceof Error ? error.message : String(error)}${backupPath ? `；备份：${backupPath}` : '；无法安全备份，请保留原文件并人工恢复'}`,
      ...(backupPath ? { backupPath } : {}),
    };
  }
}
export function writeRegistry(root: string, file: RegistryFile): void {
  if (
    file.version !== 1 ||
    !Array.isArray(file.plugins) ||
    !file.plugins.every(valid) ||
    new Set(file.plugins.map((p) => p.id)).size !== file.plugins.length
  )
    throw new Error('登记表记录不合法');
  const text = JSON.stringify(file, null, 2);
  if (Buffer.byteLength(text) > MAX_BYTES) throw new Error('登记表过大');
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const dest = join(privateRoot(root), 'registry.json');
  assertFile(dest);
  const tmp = `${dest}.${randomUUID()}.tmp`;
  let created = false;
  try {
    const fd = openSync(
      tmp,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
      0o600
    );
    created = true;
    try {
      writeFileSync(fd, text);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    assertFile(dest);
    renameSync(tmp, dest);
  } finally {
    if (created) rmSync(tmp, { force: true });
  }
}
