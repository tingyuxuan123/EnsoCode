import { constants, type Stats } from 'node:fs';
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  readFile,
  realpath,
  rm,
  rmdir,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import {
  type ExtensionPluginManifest,
  parseExtensionPluginManifest,
} from '@shared/extensionPlugins/manifest';
import { version } from '../../package.json';
import { MANIFEST_FILE, stagePlugin } from '../main/services/extensionPlugins/install';

type ValidationResult =
  | { ok: true; manifest: ExtensionPluginManifest; warnings: string[] }
  | { ok: false; error: string };

/** Use the same copy/manifest/reference checks as install, but never commit or start a plugin. */
export async function validatePluginDirectory(
  directory: string,
  hostVersion: string
): Promise<ValidationResult> {
  const temp = await mkdtemp(join(tmpdir(), 'enso-plugin-validate-'));
  try {
    const result = await stagePlugin(temp, { kind: 'dir', path: resolve(directory) }, hostVersion);
    if (!result.ok) return result;
    const { manifest, warnings } = result.staged;
    return { ok: true, manifest, warnings };
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

interface InitOptions {
  repositoryRoot: string;
  templateRoot?: string;
}
const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));
const isMissing = (error: unknown) =>
  error instanceof Error && 'code' in error && error.code === 'ENOENT';
const statIfPresent = async (path: string) => {
  try {
    return await lstat(path);
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
};
const sameFile = (a: Stats, b: Stats) => a.dev === b.dev && a.ino === b.ino;

export async function initPlugin(
  directory: string,
  id: string,
  options: InitOptions
): Promise<void> {
  const examples = join(options.repositoryRoot, 'examples', 'plugins');
  const template = options.templateRoot ?? join(examples, 'starter');
  const raw: unknown = JSON.parse(await readFile(join(template, MANIFEST_FILE), 'utf8'));
  const manifest = { ...(raw as Record<string, unknown>), id };
  const parsed = parseExtensionPluginManifest(manifest, version);
  if (!parsed.ok) throw new Error(parsed.errors.join('；'));

  const target = resolve(directory);
  const parent = dirname(target);
  if (relative(parent, await realpath(parent)))
    throw new Error('插件目标的上级路径不能包含符号链接');
  const original = await statIfPresent(target);
  if (
    original &&
    (!original.isDirectory() || original.isSymbolicLink() || (await readdir(target)).length > 0)
  )
    throw new Error('插件目标必须是不存在或为空的普通目录');
  if (!original) await mkdir(target, { mode: 0o700 });
  const identity = original ?? (await lstat(target));
  const owned = new Map<string, Stats>();
  const checkTarget = async () => {
    const current = await lstat(target);
    if (
      !current.isDirectory() ||
      !sameFile(identity, current) ||
      relative(target, await realpath(target))
    )
      throw new Error('插件目标已变化或包含符号链接');
  };
  const writeNew = async (name: string, content: string | Buffer) => {
    await checkTarget();
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
    await writeNew('main.mjs', await readFile(join(template, 'main.mjs')));
    await writeNew('ui.js', await readFile(join(template, 'ui.js')));
    await writeNew('jsconfig.json', await readFile(join(template, 'jsconfig.json')));
    await writeNew('enso-plugin.d.ts', await readFile(join(template, 'enso-plugin.d.ts')));
    await writeNew(MANIFEST_FILE, `${JSON.stringify(manifest, null, 2)}\n`);
  } catch (error) {
    try {
      await checkTarget();
      for (const [path, created] of owned) {
        const current = await statIfPresent(path);
        if (current?.isFile() && sameFile(created, current)) await rm(path);
      }
      // Never recursively remove the target: it may now contain somebody else's file.
      if (!original && (await readdir(target)).length === 0) await rmdir(target);
    } catch (cleanupError) {
      throw new Error(`${errorMessage(error)}；清理失败：${errorMessage(cleanupError)}`, {
        cause: error,
      });
    }
    throw error;
  }
}

interface CliOptions {
  repositoryRoot: string;
  stdout(text: string): void;
  stderr(text: string): void;
}
const usage = '用法：pnpm plugin:init <dir> --id <id> | pnpm plugin:validate <dir>';
export async function runPluginAuthor(
  args: readonly string[],
  options: CliOptions
): Promise<number> {
  const [command, directory, flag, id] = args;
  try {
    if (command === 'validate' && directory && !directory.startsWith('-') && args.length === 2) {
      const result = await validatePluginDirectory(directory, version);
      if (!result.ok) throw new Error(result.error);
      options.stdout(`静态校验通过：${result.manifest.id} v${result.manifest.version}`);
      for (const warning of result.warnings) options.stderr(`警告：${warning}`);
      return 0;
    }
    if (
      command === 'init' &&
      directory &&
      !directory.startsWith('-') &&
      flag === '--id' &&
      id &&
      args.length === 4
    ) {
      await initPlugin(directory, id, options);
      options.stdout(`已创建 ${id}：${resolve(directory)}`);
      return 0;
    }
    throw new Error(usage);
  } catch (error) {
    options.stderr(errorMessage(error));
    return 1;
  }
}
