# 新窗口导入持久化 store，覆盖主窗口的会话元数据

## 症状

独立设计窗口（`design.html`）上线前的真机验证中：主窗口正看着项目 A，B 的画布弹在独立窗口里。
两边并行跑过一轮设计工具后，主窗口的 `activeId` 被改成了 B，随后 A 的 `vetd_screenshot`
返回 “The design canvas is viewing another project”。单独重放 B 的 status / screenshot / create
都没有复现，日志里看不到任何主窗口代码调用 `selectConversation(B)`。

## 根因

设计窗口经 `host/context.ts` 静态导入了 `@/stores/sessions`、`@/stores/sidePanel`（以及
`lib/sidePanelDock`）。这两个 store 用 `createElectronPersistStorage()` 持久化到
**settings.json**，而不是按 origin 隔离的 localStorage：

- 新窗口一导入就会从 settings.json 水合出一份会话快照，CDP 实测设计窗口里
  `useSessionsStore.getState()` 有完整的 conversations 和 activeId；
- 模块加载时还会跑 `syncConversationProjectIds()`、`requestSnapshot()` 等副作用；
- 写闸门在水合后打开，之后这个窗口里的任何 setState（`selectConversation`、侧栏宽度、
  projectId 归一化）都会按键把**它那份过期快照**写回 `enso-conversations` / `enso-side-panel`，
  覆盖主窗口在这之后新建的会话、改过的标题和当前选中项。

已证实的是“设计窗口持有并能写回这份快照”，以及“移除这些导入后，同一流程不再出现串改”。
主窗口内存里的 activeId 具体是被哪条路径改写的，没有逐步二分，不要把某一条写成已证实。

## 修法

- `createDesignContext(host?)` 只保留和窗口无关的核心（fs / storage / network / capture /
  i18n / 注册表 / notify）。会话选择、侧栏 Dock、Composer、画廊导航改由
  `DesignContextHost` 注入：主窗口用 `host/main-host.ts`，设计窗口只提供 `sendPrompt` 转发。
- `CanvasMount` 拆到 `mounts/CanvasMount.tsx`，设计窗口不再经过会引入 sessions 的 `DesignPanel`。
- `runtime.ts` 不再读 sessions store：主窗口把宿主和运行状态传进 `setDesignViewingSession`。
- 设计窗口需要的会话状态（streaming、工具活动）由主窗口经 Main 推送，派活经 Main 回到主窗口执行。

通用规则：**任何新的 renderer 入口都不能导入持久化到 settings.json 的主窗口 store**，
除非这个 store 已明确设计成多窗口共享（如 `useSettingsStore` 自带跨窗口同步）。需要主窗口状态时，
走 Main 转发，不要在第二个窗口里复制一份 store。

## 回归防线

- `src/renderer/designWindowBoundary.test.ts`：按 TS 语义（esbuild，与 Vite 构建一致）编译后
  遍历 `design-window.tsx` 的运行时依赖（含动态 import；type-only 导入与类型别名已擦除），断言
  `stores/sessions`、`stores/sidePanel`、`lib/sidePanelDock`、`host/main-host` 不可达；另有正向
  用例证明遍历器能抓到泄漏，以及 `export type` 后紧跟值导出时不会漏判。
- `host/context.test.ts`：只带 `sendPrompt` 的宿主下，insertText / createSession /
  setPromptAttachment / sessions.list 显式报不支持，openActivityTab 只写注册表、不选会话。
- 真机：A 主窗口、B 独立窗口并行 create → 写帧 → 截图，主窗口 activeId 全程不变，
  settings.json 中的会话列表与标题保持一致。

## 相关代码

- `src/renderer/design-window.tsx`
- `src/renderer/features/design/host/context.ts`、`host/main-host.ts`
- `src/renderer/features/design/mounts/CanvasMount.tsx`
- `src/renderer/stores/settings/storage.ts`（`createElectronPersistStorage`、写闸门）
