import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { version } from '../../package.json';
import {
  validatePluginDirectory,
  writePluginStarter,
} from '../main/services/extensionPlugins/authoringFiles';
import { MANIFEST_FILE } from '../main/services/extensionPlugins/install';
import { packPlugin } from './pluginPack';
import { writePluginTesting } from './pluginTesting';

export { validatePluginDirectory };

interface InitOptions {
  repositoryRoot: string;
  templateRoot?: string;
}
const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

export async function initPlugin(
  directory: string,
  id: string,
  options: InitOptions
): Promise<void> {
  const examples = join(options.repositoryRoot, 'examples', 'plugins');
  const template = options.templateRoot ?? join(examples, 'starter');
  await writePluginStarter({
    directory,
    id,
    hostVersion: version,
    manifestText: await readFile(join(template, MANIFEST_FILE), 'utf8'),
    read: (name) => readFile(join(template, name)),
  });
}

interface CliOptions {
  repositoryRoot: string;
  stdout(text: string): void;
  stderr(text: string): void;
}
const usage =
  '用法：pnpm plugin:init <dir> --id <id> | pnpm plugin:validate <dir> | pnpm plugin:pack <dir> [--out <zip>] | pnpm plugin:testing <dir>';
export async function runPluginAuthor(
  args: readonly string[],
  options: CliOptions
): Promise<number> {
  const [command, directory, flag, id] = args;
  try {
    if (
      command === 'pack' &&
      directory &&
      !directory.startsWith('-') &&
      (args.length === 2 || (args.length === 4 && flag === '--out' && id))
    ) {
      const result = await packPlugin(directory, {
        hostVersion: version,
        ...(id ? { out: id } : {}),
      });
      options.stdout(`${result.id} ${result.version} → ${result.file}`);
      options.stdout(`大小 ${result.size} 字节，sha256 ${result.sha256}`);
      return 0;
    }
    if (command === 'testing' && directory && !directory.startsWith('-') && args.length === 2) {
      await writePluginTesting(directory);
      options.stdout('已写入 enso-testing.mjs 与 test/main.test.mjs；在插件目录运行 node --test');
      return 0;
    }
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
