import { existsSync, realpathSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { DefaultPackageManager, DefaultResourceLoader } from '@earendil-works/pi-coding-agent';

const require = createRequire(import.meta.url);

/** LCU 安装器注册的 Pi 入口；与应用授权的可信文件身份保持一致。 */
export function installedLcuExtensionPath(): string {
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
 * 先用 SDK 公开的包解析器发现入口（不会执行扩展），再只把非 LCU 的入口交给 loader。
 * noExtensions 禁掉 loader 的磁盘自动发现，避免第二次解析或 reload 又把 LCU 带回来。
 * 不改用户配置；不能用加载后才执行的 extensionsOverride，也不能按 js 名称过滤。
 */
export async function createLcuResourceLoader(
  options: ConstructorParameters<typeof DefaultResourceLoader>[0],
  lcuEnabled = true,
  extensionPath = installedLcuExtensionPath()
): Promise<DefaultResourceLoader> {
  if (lcuEnabled || (options.noExtensions && !options.additionalExtensionPaths?.length)) {
    return new DefaultResourceLoader(options);
  }
  if (!options.settingsManager) throw new Error('LCU loading policy requires a settings manager');
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
