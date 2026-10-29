# 关闭 DevTools 后网页下方留白，更多菜单被网页遮住

## 症状

- 内嵌浏览器打开停靠 DevTools，再点 DevTools 自带的 X 后，网页仍保留缩小后的高度。
- 下方原 DevTools 区域变成空白；浏览器「更多」菜单只露出顶部，主体被网页盖住。
- renderer 能正确算出 `covered=true`，但 viewport IPC 或再次关闭时报
  `Can't add a destroyed child view to a parent view`。

## 根因

这里有两个独立于 CSS 的生命周期缺口：

1. Electron 自定义 DevTools 前端的 X 调用 `DevToolsAPI.sendMessageToEmbedder('closeWindow', [])`。
   真机中前端消失 / 变成空 target，但 guest 的 `devtools-closed` 和前端的 `destroyed`
   不能可靠通知宿主；仅监听这些事件无法让 `devtoolsOpen` 变回 false。
2. 显式 `closeDevTools()` 会销毁自定义前端，而旧实现仍保留 `tab.devtools`。
   下次 `layout()` 把已销毁的 view 重新 `addChildView`，异常使整次布局提前退出。
   不仅网页尺寸没恢复，末尾提升 workbench 的步骤也没执行，所以更多菜单同时被挡住。

## 修法

- 在已有 DevTools embedder 桥中拦截 `closeWindow`，上报严格的 `{ closed: true }`，不再
  直接转给 Electron；由 Main 的 `setDevTools(false)` 统一关闭。
- 关闭时先清理前端引用、网页区域和该 tab 的 DevTools viewport，并 detach view，再关闭
  guest DevTools 和前端 webContents。重开创建新前端，不复用被销毁的原生 view。
- guest `devtools-closed` 和前端 `destroyed` 仍保留为补充关闭路径，清理必须可重入。
- 前端消息按 webContents 身份校验，旧前端延迟消息不能误关或重排新前端。
- 打开 DevTools 让出 debugger 时废弃模拟缓存，关闭后重新应用设备模拟。

## 回归防线

- `devtools.test.ts` 执行注入脚本，验证关闭消息送给宿主而不转发原生 close；校验脏消息。
- `browserHost.zorder.test.ts` 验证关闭通知、原生关闭、前端销毁、重复重开、旧消息、独立
  窗口关闭 / 重新停靠、设备模拟恢复，以及关闭后菜单覆盖时的原生视图顺序。
- 真机必须点击官方 DevTools 自带的 X，不能只测工具栏 IPC；读取网页 `innerHeight` 和
  宿主状态，并用 OS 窗口截图看网页与菜单。renderer CDP 截图看不到兄弟原生视图。
- 仅补 `devtools-closed` 监听的第一版单测可过，但真机仍失败；这正是必须验证 embedder
  `closeWindow` 实际调用和原生视图层级的原因。

## 相关代码

- [DevTools 桥接和消息校验](../../../src/shared/browser/devtools.ts)
- [浏览器宿主](../../../src/main/services/browserHost.ts)
- [桥接测试](../../../src/shared/browser/devtools.test.ts)
- [原生布局回归](../../../src/main/services/browserHost.zorder.test.ts)
- [窗口规范](../main/windows.md)
