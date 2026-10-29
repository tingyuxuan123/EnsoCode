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

  it('内置 pi 各包同步锁定 1.4.0，不再加载旧版恢复补丁', () => {
    const packages = [
      '@earendil-works/pi-agent-core',
      '@earendil-works/pi-ai',
      '@earendil-works/pi-coding-agent',
      '@earendil-works/pi-mcp',
      '@earendil-works/pi-tui',
    ] as const;
    for (const name of packages) {
      expect(pkg.dependencies[name]).toBe('1.4.0');
      expect(lockfile.importers['.'].dependencies[name].specifier).toBe('1.4.0');
      expect(lockfile.importers['.'].dependencies[name].version).toMatch(/^1\.4\.0(?:\(|$)/);
    }
    expect(
      Object.keys(workspace.patchedDependencies).some((name) =>
        name.startsWith('@earendil-works/pi-coding-agent@')
      )
    ).toBe(false);
  });
});
