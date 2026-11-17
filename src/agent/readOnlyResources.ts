import { type DefaultResourceLoader, SettingsManager } from '@earendil-works/pi-coding-agent';

/**
 * 只读/临时会话（插件只读代理、locked Enso 子会话）的资源初始化边界。
 *
 * pi 的 `DefaultResourceLoader.reload()` 先无条件执行 `packageManager.resolve()`，
 * 之后才按 `noExtensions` / `noSkills` 过滤；而 `resolve()` 直接读 settings 里的
 * `packages`，装过的包缺了就会 `npm install` / `git clone`——npm 的 postinstall
 * 就是任意代码执行。所以只读会话不能沿用真实 `agentDir`/项目 settings：
 * `noExtensions` 挡不住这条路（项目 settings 被 sanitize 后仍然漏掉全局 packages）。
 *
 * 这里给一份纯内存的空设置：没有任何 packages/extensions/skills/prompts/themes，
 * 于是 `resolve()` 无包可装、无本地条目可读，磁盘上也只剩纯列举式的自动发现。
 */
export function createReadOnlySettingsManager(): SettingsManager {
  return SettingsManager.inMemory({
    packages: [],
    extensions: [],
    skills: [],
    prompts: [],
    themes: [],
  });
}

type LoaderOptions = ConstructorParameters<typeof DefaultResourceLoader>[0];

type ReadOnlyLoaderOptions = Pick<LoaderOptions, 'cwd' | 'agentDir'> &
  Required<
    Pick<
      LoaderOptions,
      | 'settingsManager'
      | 'noExtensions'
      | 'noSkills'
      | 'noPromptTemplates'
      | 'noThemes'
      | 'noContextFiles'
      | 'skillsOverride'
      | 'promptsOverride'
      | 'themesOverride'
      | 'agentsFilesOverride'
    >
  >;

/** 只读 loader 的公共选项：不读磁盘 settings、不发现也不加载任何资源。 */
export function readOnlyResourceOptions(options: {
  cwd: string;
  agentDir: string;
}): ReadOnlyLoaderOptions {
  return {
    cwd: options.cwd,
    agentDir: options.agentDir,
    settingsManager: createReadOnlySettingsManager(),
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    skillsOverride: () => ({ skills: [], diagnostics: [] }),
    promptsOverride: () => ({ prompts: [], diagnostics: [] }),
    themesOverride: () => ({ themes: [], diagnostics: [] }),
    agentsFilesOverride: () => ({ agentsFiles: [] }),
  };
}
