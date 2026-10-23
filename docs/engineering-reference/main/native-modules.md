# 原生模块规范

本项目的原生模块：

| 模块 | 用途 | 位置 |
|------|------|------|
| `better-sqlite3` | 读 CC Switch / Alma / Cursor 的 sqlite（只读扫描） | `services/providerScan/readers.ts`、`services/assetScan/ccSwitch.ts` |
| `level` | 读 Cherry Studio 的 leveldb（只读扫描） | `services/providerScan/readers.ts` |
| `node-datachannel` | 配对直连（WebRTC DataChannel），main 进程内跑，不开隐藏窗口 | `services/pairDirectPeer.ts` |

不要用它们做本项目自身的持久化 —— 设置存 JSON，见 [settings-persistence.md](settings-persistence.md)。

## 可选能力型原生模块：动态 import + 静默降级

`node-datachannel` 这类「没有也能跑」的模块不要顶层 `import`：用 `await import()` 包在 try 里预加载（`preloadDirectPeer()`），
失败只 `console.warn` 一次并让工厂返回 `null`，上层自动退回无该能力的路径（直连 → 中继）。
它的二进制在嵌套 optional 依赖 `@node-datachannel/<platform>` 里，无 install 脚本，不需要在 `allowBuilds` 中放行。
pnpm 把平台包放在 `node-datachannel` 的兄弟目录，electron-builder 收集器只打 JS；必须在 `electron-builder.yml` 把
`node_modules/.pnpm/node-datachannel@<ver>/node_modules/@node-datachannel` 拷到 `node_modules/@node-datachannel`，
并 `asarUnpack` 对应 `.node`。各 OS 的 CI 各自安装自己平台的二进制。漏拷的表现是启动 warn
`node-datachannel unavailable, direct link disabled` / `Cannot find module '@node-datachannel/<platform>'`，配对退回中继。
验证打包产物时用 `ELECTRON_RUN_AS_NODE=1` 跑应用可执行文件从 `app.asar` `import('node-datachannel')`，不要用系统 node（ABI 不同）。

`node-llama-cpp` 的平台预编译（CPU / Metal / CUDA / Vulkan / cuda-ext）都不要打进安装包。首次 `loadLlama` 时 `ensureGpuBackend` 按当前平台和 GPU 从 npm 拉一份到 `userData/llama-gpu-backends`；cuda-ext 仍不下载。排除 glob 以 `electron-builder.yml` 与 `ELECTRON_BUILDER_GPU_EXCLUDES` 为准。读它的版本必须走已解析入口旁的 `package.json` 文件，不要 `require('node-llama-cpp/package.json')`：该包 `exports` 不含这个子路径，打包后首次下载会整段中断，随后 `getLlama({ build: 'never' })` 抛 `NoBinaryFoundError`。

## 只读打开

```ts
new Database(file, { readonly: true, fileMustExist: true });
```

目标应用可能正在运行并持有锁。leveldb 更严格，读之前要把目录**快照复制**一份
（排除 `LOCK` 文件）再打开，见 `readers.ts` 的 `readCherryStudio`。

打开失败一律返回空数组，不要抛 —— 用户没装那个应用是常态，不是错误。
表结构也不能假定存在，先查再读：

```ts
function tableExists(db: Database.Database, table: string): boolean {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(table);
  return Boolean(row);
}
```

用完 `finally { db.close() }`。

## pnpm 构建脚本

pnpm 10 默认**禁止**依赖执行安装脚本，原生模块会因此拿不到二进制文件。
在 `pnpm-workspace.yaml` 的 `allowBuilds` 中显式声明权限（以下为节选，完整名单以该文件为准）：

```yaml
allowBuilds:
  classic-level: true
  electron: true
  electron-winstaller: true
  esbuild: true
  better-sqlite3: false
```

`true` 放行安装脚本，`false` 明确禁用且不提示未审批；未列出的依赖仍默认禁止。
漏项的表现各异且不直观，例如 `electron` 漏了会找不到 Electron 可执行文件。
新增原生依赖后**先确认是否需要安装脚本，再声明权限**；保留 `better-sqlite3: false` 的现有策略，不为消除警告擅自放开。

`allowBuilds` 从 pnpm 10.26.0 起可用，与项目固定的 10.26.2 兼容。
不要再把这些设置放回 `package.json.pnpm`：新版 pnpm 会忽略并在每次命令启动时告警。
`patchedDependencies` 也统一放在 `pnpm-workspace.yaml`，保持与锁文件中的补丁记录一致。

## 版本对齐

原生模块的预编译产物与 Node/Electron ABI 绑定。升级 Electron 后如果启动报
`NODE_MODULE_VERSION` 不匹配，重跑：

```bash
pnpm rebuild && npx electron-builder install-app-deps
```
