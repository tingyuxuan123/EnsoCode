import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DefaultResourceLoader, SettingsManager } from '@earendil-works/pi-coding-agent';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * 只读会话（插件只读代理、locked Enso 子会话）绝不能触发安装：
 * pi 的 DefaultResourceLoader.reload() 在按 noExtensions/noSkills 过滤之前就执行
 * packageManager.resolve()，它读 settings 里的 packages，缺包会直接 npm/git 安装
 * （npm 的 postinstall 就是任意代码执行）。这里把「到达安装」这一步拦下来记录，
 * 既证明只读路径不会走到安装，也不用真的联网。
 */
function blockInstalls(loader: DefaultResourceLoader): string[] {
  const installs: string[] = [];
  const manager = loader as unknown as {
    packageManager: { installParsedSource?(parsed: { spec?: string }): Promise<void> };
  };
  manager.packageManager.installParsedSource = async (parsed) => {
    installs.push(parsed.spec ?? '');
    throw new Error('install blocked');
  };
  return installs;
}

import { createReadOnlySettingsManager, readOnlyResourceOptions } from './readOnlyResources';

let root: string;
let cwd: string;
let agentDir: string;

const writeJson = (path: string, value: unknown) => {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, JSON.stringify(value));
};

/** 项目与全局都配了包/扩展/技能/提示词/主题：这正是真实用户的 settings.json */
function seedDangerousSettings(): void {
  writeJson(join(cwd, '.pi', 'settings.json'), {
    packages: ['npm:evil-project-pkg@1.0.0'],
    extensions: ['/tmp/evil-project-extension.ts'],
    skills: ['/tmp/evil-project-skills'],
    prompts: ['/tmp/evil-project-prompts'],
    themes: ['/tmp/evil-project-themes'],
  });
  mkdirSync(join(cwd, '.pi', 'extensions', 'evil'), { recursive: true });
  writeFileSync(join(cwd, '.pi', 'extensions', 'evil', 'index.ts'), 'export default () => {}');
  writeJson(join(agentDir, 'settings.json'), {
    packages: ['npm:evil-global-pkg@1.0.0'],
    extensions: ['/tmp/evil-global-extension.ts'],
    skills: ['/tmp/evil-global-skills'],
    prompts: ['/tmp/evil-global-prompts'],
    themes: ['/tmp/evil-global-themes'],
  });
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'enso-readonly-'));
  cwd = join(root, 'project');
  agentDir = join(root, 'agent');
  mkdirSync(cwd, { recursive: true });
  mkdirSync(agentDir, { recursive: true });
  seedDangerousSettings();
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('只读 SettingsManager', () => {
  it('不继承项目或全局 settings 里的包、扩展、技能、提示词与主题', () => {
    const manager = createReadOnlySettingsManager();
    expect(manager.getPackages()).toEqual([]);
    expect(manager.getExtensionPaths()).toEqual([]);
    expect(manager.getSkillPaths()).toEqual([]);
    expect(manager.getPromptTemplatePaths()).toEqual([]);
    expect(manager.getThemePaths()).toEqual([]);
    // 内存态：没有默认模型等任何来自磁盘的取值
    expect(manager.getDefaultModel()).toBeUndefined();
  });
});

describe('只读 loader 选项', () => {
  it('把磁盘资源发现全部关掉，指令文件也不继承', () => {
    const options = readOnlyResourceOptions({ cwd, agentDir });
    expect(options.settingsManager.getPackages()).toEqual([]);
    expect(options.noExtensions).toBe(true);
    expect(options.noSkills).toBe(true);
    expect(options.noPromptTemplates).toBe(true);
    expect(options.noThemes).toBe(true);
    expect(options.noContextFiles).toBe(true);
    expect(options.agentsFilesOverride({ agentsFiles: [{ path: '/a', content: 'x' }] })).toEqual({
      agentsFiles: [],
    });
  });
});

describe('真实 DefaultResourceLoader', () => {
  it('用只读选项 reload 时不会 spawn 安装，也不加载项目/全局资源', async () => {
    const loader = new DefaultResourceLoader(readOnlyResourceOptions({ cwd, agentDir }));
    const installs = blockInstalls(loader);
    await loader.reload();
    expect(installs).toEqual([]);
    expect(loader.getExtensions().extensions).toEqual([]);
    expect(loader.getSkills().skills).toEqual([]);
    expect(loader.getPrompts().prompts).toEqual([]);
    expect(loader.getThemes().themes).toEqual([]);
    expect(loader.getAgentsFiles().agentsFiles).toEqual([]);
  });

  it('对照：沿用真实 settings 时同一份配置会触发安装尝试（证明测试能抓到回归）', async () => {
    const loader = new DefaultResourceLoader({
      cwd,
      agentDir,
      settingsManager: SettingsManager.create(cwd, agentDir),
      noExtensions: true,
      noSkills: true,
    });
    const installs = blockInstalls(loader);
    await expect(loader.reload()).rejects.toThrow(/install blocked/);
    expect(installs).toEqual(['evil-project-pkg@1.0.0']);
  });
});
