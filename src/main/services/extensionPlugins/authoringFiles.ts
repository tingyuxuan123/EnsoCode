import { constants, type Stats } from 'node:fs';
import { lstat, mkdir, mkdtemp, open, readdir, realpath, rm, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { parseExtensionPluginManifest } from '@shared/extensionPlugins/manifest';
import { MANIFEST_FILE, stagePlugin } from './install';

export const STARTER_FILES = ['main.mjs', 'ui.js', 'jsconfig.json', 'enso-plugin.d.ts'] as const;

/** Same copy, manifest and resource checks as installation. Does not execute or register a plugin. */
export async function validatePluginDirectory(
  directory: string,
  hostVersion: string,
  signal?: AbortSignal
) {
  const temp = await mkdtemp(join(tmpdir(), 'enso-plugin-validate-'));
  try {
    const result = await stagePlugin(temp, { kind: 'dir', path: resolve(directory) }, hostVersion, {
      signal,
    });
    if (!result.ok) return result;
    const { manifest, warnings } = result.staged;
    return { ok: true as const, manifest, warnings };
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

async function statIfPresent(path: string) {
  try {
    return await lstat(path);
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  }
}

export const samePluginFile = (a: Stats, b: Stats) => a.dev === b.dev && a.ino === b.ino;

/** Both the CLI and the desktop scaffold write only the fixed starter files, never overwrite. */
export async function writePluginStarter(options: {
  directory: string;
  id: string;
  hostVersion: string;
  manifestText: string;
  read: (name: (typeof STARTER_FILES)[number]) => string | Buffer | Promise<string | Buffer>;
  assertWorkspace?: () => void;
}): Promise<Stats> {
  const { directory, id, hostVersion, manifestText, read, assertWorkspace } = options;
  const raw: unknown = JSON.parse(manifestText);
  const manifest = { ...(raw && typeof raw === 'object' ? raw : {}), id };
  const parsed = parseExtensionPluginManifest(manifest, hostVersion);
  if (!parsed.ok) throw new Error(parsed.errors.join('；'));
  const target = resolve(directory);
  const parent = dirname(target);
  if (relative(parent, await realpath(parent)))
    throw new Error('插件目标的上级路径不能包含符号链接');
  const original = await statIfPresent(target);
  if (
    original &&
    (assertWorkspace || !original.isDirectory() || (await readdir(target)).length > 0)
  )
    throw new Error('插件目标必须是不存在或为空的普通目录');
  assertWorkspace?.();
  if (!original) await mkdir(target, { mode: 0o700 });
  const identity = original ?? (await lstat(target));
  const owned = new Map<string, Stats>();
  const checkTarget = async () => {
    const current = await lstat(target);
    if (
      !current.isDirectory() ||
      !samePluginFile(identity, current) ||
      relative(target, await realpath(target))
    )
      throw new Error('插件目标已变化或包含符号链接');
  };
  const writeNew = async (name: string, content: string | Buffer) => {
    await checkTarget();
    assertWorkspace?.();
    const path = join(target, name);
    const file = await open(
      path,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600
    );
    try {
      owned.set(path, await file.stat());
      await file.writeFile(content);
    } finally {
      await file.close();
    }
  };
  try {
    for (const name of STARTER_FILES) await writeNew(name, await read(name));
    await writeNew(MANIFEST_FILE, `${JSON.stringify(manifest, null, 2)}\n`);
    await checkTarget();
    assertWorkspace?.();
    return identity;
  } catch (error) {
    try {
      await checkTarget();
      for (const [path, created] of owned) {
        const current = await statIfPresent(path);
        if (current?.isFile() && samePluginFile(created, current)) await rm(path);
      }
      // Never remove through a link or recursively remove somebody else's files.
      if (!original && (await readdir(target)).length === 0) await rmdir(target);
    } catch (cleanupError) {
      throw new Error(`${String(error)}；清理失败：${String(cleanupError)}`, { cause: error });
    }
    throw error;
  }
}
