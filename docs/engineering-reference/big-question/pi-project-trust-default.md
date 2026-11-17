# pi 默认信任项目：打开仓库即执行其扩展、自动安装其包

## 症状

没有任何报错。在 Enso 里打开一个带 `.pi/extensions/*.ts` 或 `.pi/settings.json` 里 `packages` 的仓库，第一次发消息时这些代码就以用户权限在 agent worker 里运行；项目包缺失时 pi 还会自动执行 `npm install` / `git clone`（项目 `npmCommand` 也会被采用）。

## 根因

- `DefaultResourceLoader` 没传 `settingsManager` 时自建 `SettingsManager.create(cwd, agentDir)`，`projectTrusted` 缺省为 `true`；只有 CLI 交互式传了 `resolveProjectTrust` 才会询问。
- `noExtensions: true` 只丢弃扩展路径，`packageManager.resolve()` 仍会解析并自动安装项目包，所以类型化子代理和锁定的 Enso 会话同样受影响。
- 直接设 `projectTrusted: false` 又太宽：会连带屏蔽 `.pi/skills`、祖先目录的 `.agents/skills`、`.pi/prompts`、`SYSTEM.md` 等纯内容资源。

## 修法

`src/agent/projectCode.ts`：

- `listProjectCodeSources(cwd)` 列出会被当代码加载的来源（`.pi/extensions/*`、`package:*`、`extension:*`、`setting:npmCommand|shellPath|shellCommandPrefix`），标签是相对路径，worktree 与主树一致。
- `createProjectSettingsManager(cwd, agentDir, trusted)`：来源全部在 `trusted` 里才按 pi 默认加载；否则用只读存储把项目 settings 去掉包与命令类键，并注入 `extensions: ['!**']` 排除 `.pi/extensions` 自动发现。内容资源不受影响。
- 所有 `DefaultResourceLoader`（父会话、子代理、锁定会话）都传这个 `settingsManager`。信任列表存在 `Project.trustedProjectCode`，Main 在 spawn 时下发；出现新来源时整个项目重新拦下。

### 只读临时代理不能继承「用户已信任」的可执行资源（2026-11-16 核验）

项目准入与只读隔离不是同一个边界。`createProjectSettingsManager` 刻意保留全局设置，并允许用户明确批准的项目包；临时 `agent.run` 若沿用它，即使 `noExtensions/noSkills: true`，全局包未安装或已信任项目包缓存被删除时，loader 初始化仍会安装并执行 npm 生命周期脚本。过滤工具列表和在会话开始后拒绝 bash 都挡不住初始化副作用。

`src/agent/readOnlyResources.ts` 为临时只读代理和 locked 子会话提供 `SettingsManager.inMemory`，清空 packages/extensions/skills/prompts/themes、关闭磁盘发现与 context files，并用空资源 override。不要把「项目来源已批准」当成只读会话可以安装软件的授权。

`src/agent/readOnlyResources.test.ts` 使用真实 SDK 与临时目录做正反对照：同一份含 npm 包的配置，旧选项确实到达 `installParsedSource`（测试截获，不联网），隔离选项则无安装尝试、无磁盘资源。这比只断言 `noExtensions: true` 更能发现回归。

## 回归防线

`src/agent/projectCode.test.ts` 用真实 `DefaultResourceLoader` 验证：未信任时扩展模块不执行、`npmCommand` 不运行、项目技能照常加载；信任后加载；信任后新增来源重新拦截。

## 相关代码

- `src/agent/projectCode.ts`、`src/agent/supervisor.ts`（`createSessionResourceLoader` / `createEnsoResourceLoader`）
- `src/main/ipc/projects.ts`（`PROJECTS_CODE_SOURCES`）、`src/renderer/components/chat/ProjectCodeTrustBar.tsx`
