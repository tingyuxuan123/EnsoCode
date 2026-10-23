import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import pkg from '../../package.json';

const root = new URL('../../', import.meta.url);
const workspace = parse(readFileSync(new URL('pnpm-workspace.yaml', root), 'utf8'));
const lockfile = parse(readFileSync(new URL('pnpm-lock.yaml', root), 'utf8'));

describe('pnpm 项目配置', () => {
  it('只从工作区读取配置，不再使用会被新版 pnpm 忽略的 package.json.pnpm', () => {
    expect(pkg).not.toHaveProperty('pnpm');
    expect(workspace).not.toHaveProperty('onlyBuiltDependencies');
    expect(workspace).not.toHaveProperty('ignoredBuiltDependencies');
  });

  it('迁移后保持依赖构建白名单，不放开未授权的安装脚本', () => {
    expect(workspace.allowBuilds).toEqual({
      '@google/genai': true,
      '@vscode/ripgrep': true,
      'classic-level': true,
      electron: true,
      'electron-winstaller': true,
      esbuild: true,
      'node-llama-cpp': true,
      'node-pty': true,
      'onnxruntime-node': true,
      protobufjs: true,
      workerd: true,
      'better-sqlite3': false,
    });
    expect(workspace.dangerouslyAllowAllBuilds).not.toBe(true);
  });

  it('工作区声明的补丁与锁文件一致且补丁文件存在', () => {
    expect(workspace.patchedDependencies).toEqual({
      '@earendil-works/pi-coding-agent@1.0.0':
        'patches/@earendil-works__pi-coding-agent@1.0.0.patch',
      '@rahularya01/pi-cursor@1.4.39': 'patches/@rahularya01__pi-cursor@1.4.39.patch',
    });
    const lockedPaths = Object.fromEntries(
      Object.entries(lockfile.patchedDependencies).map(([name, patch]) => [
        name,
        (patch as { path: string }).path,
      ])
    );
    expect(workspace.patchedDependencies).toEqual(lockedPaths);
    for (const patch of Object.values(lockedPaths)) {
      expect(existsSync(fileURLToPath(new URL(patch, root)))).toBe(true);
    }
  });
});
