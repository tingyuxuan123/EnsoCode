import { existsSync, realpathSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { DefaultPackageManager, DefaultResourceLoader } from '@earendil-works/pi-coding-agent';

const require = createRequire(import.meta.url);

function retiredExtensionPath(): string {
  return join(homedir(), '.local/share/lcu/pi/extension.mjs');
}

function canonicalPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

/** SDK 对无 Pi manifest 的本地目录包会回落到 index 入口，而非返回入口文件路径。 */
function extensionIdentity(path: string): string {
  try {
    if (statSync(path).isDirectory()) {
      if (existsSync(join(path, 'package.json'))) {
        try {
          return canonicalPath(require.resolve(path));
        } catch {
          // TypeScript index 是 SDK/jiti 支持而 Node 目录解析不支持的回落。
        }
      }
      const entry = ['index.ts', 'index.js'].map((name) => join(path, name)).find(existsSync);
      if (entry) return canonicalPath(entry);
    }
  } catch {
    // 缺失路径保留给 SDK 诊断，不在此执行或修复它。
  }
  return canonicalPath(path);
}

/**
 * 旧版安装入口可能仍留在 Pi 配置里。只在 loader 执行前按文件身份跳过它，
 * 不改配置，不误拦注册了同名工具的其他扩展。
 */
export async function createFilteredResourceLoader(
  options: ConstructorParameters<typeof DefaultResourceLoader>[0],
  extensionPath = retiredExtensionPath()
): Promise<DefaultResourceLoader> {
  if (
    (options.noExtensions && !options.additionalExtensionPaths?.length) ||
    !existsSync(extensionPath)
  ) {
    return new DefaultResourceLoader(options);
  }
  if (!options.settingsManager) throw new Error('Extension filtering requires a settings manager');
  const packageManager = new DefaultPackageManager({
    cwd: options.cwd,
    agentDir: options.agentDir,
    settingsManager: options.settingsManager,
    builtinExtensions: (options.extensionFactories ?? []).flatMap((extension) =>
      typeof extension !== 'function' && extension.builtin ? [extension.name] : []
    ),
  });
  await options.settingsManager.reload();
  const paths = await packageManager.resolve();
  const explicit = await packageManager.resolveExtensionSources(
    options.additionalExtensionPaths ?? [],
    { temporary: true }
  );
  const installed = canonicalPath(extensionPath);
  // reload 也只使用这些已过滤的显式入口，避免自动发现把旧入口带回来。
  const allowed = [
    ...new Set(
      [...explicit.extensions, ...(options.noExtensions ? [] : paths.extensions)]
        .filter((entry) => entry.enabled && extensionIdentity(entry.path) !== installed)
        .map((entry) => entry.path)
    ),
  ];
  return new DefaultResourceLoader({
    ...options,
    noExtensions: true,
    additionalExtensionPaths: allowed,
  });
}
