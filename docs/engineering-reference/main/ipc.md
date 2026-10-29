# IPC 规范

## 三点式链路

新增一个能力必须同时改三个地方，缺一处链路就断：

1. **通道名** —— `src/shared/types/ipc.ts` 的 `IPC_CHANNELS`
2. **处理器** —— `src/main/ipc/<域>.ts`，并在 `src/main/ipc/index.ts` 的
   `registerIpcHandlers()` 里注册所在模块
3. **出口** —— `src/preload/index.ts` 的 `electronAPI.<域>.<方法>`

以「拉取模型」为例，三处分别是：

```ts
// shared/types/ipc.ts
PROVIDERS_LIST_MODELS: 'providers:list-models',

// main/ipc/providers.ts
ipcMain.handle(IPC_CHANNELS.PROVIDERS_LIST_MODELS, (_event, config: unknown) => {
  const parsed = toApiConfig(config);
  if (!parsed) return { ok: false, models: [], error: 'Invalid config' };
  return listModels(parsed);
});

// preload/index.ts
listModels: (config: ProviderApiConfig): Promise<ListModelsResult> =>
  ipcRenderer.invoke(IPC_CHANNELS.PROVIDERS_LIST_MODELS, config),
```

漏掉 preload 的表现是渲染层报 `Cannot read properties of undefined`；
漏掉注册的表现是 `No handler registered for '...'`。两者都是运行时才炸，
类型检查发现不了 —— 所以改完自己对一遍这三处。

## main → renderer 推送只走 sendToWindow / sendToAllWindows

主窗口 UI 在独立顶层 `WebContentsView` 里，`win.webContents` 是没有 preload 的空壳：

```ts
// Wrong：静默丢弃，渲染层永远收不到
win.webContents.send(IPC_CHANNELS.X, payload);
if (isMainWebContents(win.webContents.id)) { /* 恒 false */ }

// Correct
sendToAllWindows(IPC_CHANNELS.X, payload);
if (isMainWebContents(getWindowWebContents(win).id)) sendToWindow(win, IPC_CHANNELS.X, payload);
```

这类错误没有任何报错，只会表现为“状态不更新 / 一直加载中”。新增推送通道时
补一个像 `ipc/nodes.test.ts` 那样区分 shell / UI webContents 的测试。

## 文件路径不收渲染层的，只收标识符

需要读写磁盘的通道，请求里**只允许带 id**，路径由 Main 从自己读的权威数据推导：

```ts
// Wrong：等于开放任意文件读取
ipcMain.handle(CH, (_event, sessionFile: string) => read(sessionFile));

// Correct
ipcMain.handle(CH, (_event, request) => {
  const file = agentSessionIndex.persistedConversation(request.conversationId)?.sessionFile;
  // …再叠目录与文件名校验
});
```

`src/main/services/childHistory.ts` 的 `readChildHistory` 是范例：先根据 Main 自读的
typed child metadata 验证 parent/实例归属，再检查路径与 `realpath` 都在 sessions
目录内（包括符号链接逃逸），最后按权威类型校验文件头和格式。
locked Enso 只允许 `enso-*` safe journal；普通 child 的 pi JSONL 只能经过既有
`projectMessage` 白名单投影后返回，不能把原文件或任意 JSON 字段直接交给 Renderer。
只读历史不能用 spawn/resume 来获得，也不能调用会修复换行或迁移落盘的读取入口。

测试要直接验“恶意输入不读盘”：不存在的 id、持久化记录里的路径逃出目录、
文件类型不合预期、符号链接逃逸、以及请求额外带 `sessionFile` 时被拒绝。

## 入参一律当 unknown

渲染层传来的任何东西都不可信，handler 第一件事是收窄类型：

```ts
ipcMain.handle(IPC_CHANNELS.INSTRUCTIONS_WRITE, (_event, id: unknown, content: unknown) => {
  if (typeof id !== 'string' || typeof content !== 'string') return { ok: false, bytes: 0 };
  return writeInstruction(id, content);
});
```

数组要逐项过滤，不要只判 `Array.isArray`：

```ts
return collectImport(
  scanId,
  candidateIds.filter((id): id is string => typeof id === 'string')
);
```

对象入参写一个转换函数返回 `T | null`，见 `src/main/ipc/providers.ts` 的 `toApiConfig()`。
**不要用类型断言代替校验** —— `config as ProviderApiConfig` 只是骗过编译器。

## 返回结果而不是抛异常

跨 IPC 抛出的异常在渲染层只剩一个字符串，堆栈和类型都丢了。统一返回结果对象：

```ts
export interface ListModelsResult { ok: boolean; models: string[]; error?: string }
export interface TestProviderResult { ok: boolean; latencyMs: number; message: string }
```

渲染层据 `ok` 分支，把 `error` 直接展示给用户
（见 `ProviderEditDialog.tsx` 的 `status` 状态）。

## preload 是唯一出口

`src/preload/index.ts` 通过 `contextBridge.exposeInMainWorld('electronAPI', ...)` 暴露，
按域分组：`settings` / `providers` / `assets` / `instructions` / `window` / `env`。

约束：

- **不要暴露通用通道**（如 `invoke(channel, ...args)`），那等于把整个主进程开放给渲染层。
- 每个方法写明返回类型，类型从 `@shared/types` 导入。
- 事件订阅返回**取消订阅函数**，让 React effect 能清理：

```ts
onChanged: (callback: () => void): (() => void) => {
  const listener = () => callback();
  ipcRenderer.on(IPC_CHANNELS.SETTINGS_CHANGED, listener);
  return () => ipcRenderer.removeListener(IPC_CHANNELS.SETTINGS_CHANGED, listener);
},
```

- `ElectronAPI` 类型由 `typeof electronAPI` 推导并在 `src/preload/types.ts` 挂到
  `window`，渲染层因此有完整补全。新增方法不需要手写类型声明。

## 压缩预留值只写应用隔离的 pi 设置

`compaction:reserve-tokens-*` 只接受主界面与设置窗口；Renderer 只传整数或 null，
Main 推导 `userData/agent/pi-agent/settings.json`，不接受配置路径。值范围为 4096–65536，
null 删除覆盖字段；留空不改变 pi 默认。设置页标明新启动或重新创建的会话生效。
`piCompactionSettings.ts` 与 worker 使用同版本 proper-lockfile 的异步锁及过期规则，
读最新盘面后仅修改目标字段并原子替换；坏 JSON 不覆盖，锁/IO 失败返回结构化结果。
回归：`compaction.test.ts`、`piCompactionSettings.test.ts`、`compactionSettings.test.ts`。

## preload 的构建约束

preload 产物是 **ESM**（`out/preload/index.mjs`），窗口配置里的路径必须与之一致：

```ts
preload: join(__dirname, '../preload/index.mjs'),
```

不要在 `electron.vite.config.ts` 的 preload 段自定义 `rollupOptions.output`。
那会覆盖 electron-vite 的默认 external 配置，把 `electron` 当普通 npm 包打进产物，
应用直接起不来。详见 [../big-question/preload-externalization.md](../big-question/preload-externalization.md)。
