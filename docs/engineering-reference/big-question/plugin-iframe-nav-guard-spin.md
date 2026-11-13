# 插件侧栏面板一开，整个应用卡死

## 症状

- 干净 userData 的 dev 实例启动、`extensionPlugins.list()`、CDP 全部正常，主进程 CPU 接近 0。
- 一旦打开插件侧栏面板（`ui.view.open`，或渲染层直接 `openSidePanelPluginView`）：
  主进程持续 100% CPU，DevTools/CDP 立刻不可达，界面还留着最后一帧。
- 此后用同一 userData 启动会直接卡住（dock 布局会恢复该面板）。
- 全部单测、`typecheck`、`lint` 都是绿的；假 provider、裸 iframe 注入、单 IPC 调用全部正常。

## 根因

主窗口上注册了 `webContents.on('will-frame-navigate' | 'will-redirect')` 监听（设计预览守卫 +
插件视图守卫）。Electron 43 在**沙箱 iframe（`sandbox="allow-scripts"`）**上需要同步咨询
embedder 的导航决定时，会陷入原生忙循环：

- 守卫回调实际只被调用两次（探针实测），且没有走到 `preventDefault`；
- 但这两条监听存在与否，直接决定卡死与否；
- 因此触发点在 Electron 侧同步咨询路径，不在监听函数体里。

排查时最容易走错的三个点：

1. `ps -o %cpu` 是**生命周期均值**。判断“是否此刻在自旋”要用
   `ps -o time=,pcpu=` 连读两次，看 CPU 时间是否在增长。
2. Node 的 `fetch`/WebSocket 客户端会拒绝 Chromium 的禁用端口（如 10080），
   报 `fetch failed / bad port`，会被误读成“应用不可达”。CDP 端口要避开禁用端口。
3. `Debugger.pause` 进不去说明卡在原生代码；`lldb`/`sample` 在 stripped 的 Electron
   上符号不可信，不要据此下结论，改用代码开关二分。

## 修法

- 不要把插件帧导航守卫挂到承载插件 iframe 的主窗口上。
- 设计守卫改为**按需挂载**：只有存在设计引擎端口时才 `on`，引擎端口清空后 `off`。
- 插件侧栏帧的边界由 `sandbox="allow-scripts"`、壳页面 CSP（`frame-src`/`navigate-to 'none'`）、
  一次性 nonce 与 `event.source` 校验承担。
- `viewNavigation.ts` 的 `installPluginViewNavigationGuard` 保留，但在注释里写明
  “不得挂到承载插件 iframe 的主窗口”，留给将来的插件专用窗口。

## 回归防线

- `src/main/services/design/navigation.test.ts`
  “没有设计引擎帧时不挂导航监听，只有出现引擎端口后才安装”
- `src/main/services/extensionPlugins/viewNavigation.test.ts`
  守卫策略、`about:blank` 放行、祖先遍历有界、getter 抛错不冒泡。
- 真机验收：隔离 userData 打开插件面板 → iframe 渲染、状态项显示、Main CPU ≈ 0、CDP 正常；
  重启后从 dock 布局恢复同一面板同样正常。

## 相关代码

- `src/main/windows/createAppWindow.ts`
- `src/main/services/design/navigation.ts`
- `src/main/services/extensionPlugins/viewNavigation.ts`
- `src/renderer/plugins/PluginView.tsx`
