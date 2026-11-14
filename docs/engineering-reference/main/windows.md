# 窗口规范

## 多窗口模型

每个窗口是独立的 renderer 入口，在 `electron.vite.config.ts` 里声明：

```ts
input: {
  index: path.resolve(__dirname, 'src/renderer/index.html'),
  settings: path.resolve(__dirname, 'src/renderer/settings.html'),
}
```

新增窗口要同时加：入口 html、入口 tsx、`electron.vite.config.ts` 的 input、
`src/main/windows/<Name>Window.ts`。

跟随应用外观的入口（`index` / `settings` / `taskboard` / `design`）还要在自己的组件树里挂
`plugins/PluginThemeHost`：窗口之间不共享 `html` 主题类，漏挂就永远停在云白（协作看板踩过）。
宿主只带调色板与插件 CSS；壁纸和插件素材槽仍只认主窗口的 `data-enso` 挂点，不要为了“外观一致”
把它们铺到设置、看板或设计窗口。沙箱与预览入口（`plugin-view.html`、配对预览、设计画布 iframe、
系统 PDF 预览）不是应用 UI，不挂宿主。

插件主题数据经 `extensionPlugins.list` / `asset` 读取。这两个只读通道额外放行 Main 权威登记的
taskboard/design 顶层入口（精确入口 URL + 顶层 frame + 窗口身份）；安装、启用、调用、配置、
draft 等写通道继续只认主窗口与设置窗口。外层注册闸门按通道键放行、handler 内部按方法放行，
两层必须同时打开，否则只改一层仍然被拦。回归见 `ipc/extensionPluginsTrust.test.ts`。

窗口一律经 `createAppWindow()` 工厂创建，不要直接 `new BrowserWindow`。工厂统一处理了
无边框样式、窗口状态持久化、可编辑区右键菜单、外链转系统浏览器、dev/prod 加载路径。

配对 [网页预览](pair-preview.md) 的隐藏 offscreen 渲染器不是应用 UI：必须使用无 preload、
沙箱、独立内存 session 的专用窗口，不走会附带应用权限的 `createAppWindow()`。

单例窗口的模式见 `SettingsWindow.ts`：模块级变量持有引用，已存在则 `restore()` + `focus()`，
`closed` 事件里置空。

### 独立设计窗口（按会话多实例）

`DesignWindow.ts` 按根会话各开一个 `design` 入口窗口，可同时开多个，让不同项目的画布互不排队。
要点：

- 窗口绑定的会话只记在 Main（`designWindowSession(webContentsId)`），Renderer 只能经
  `designWindow.info()` 查询；`registerRuntime` / `canvasPresence` 一律以绑定为准，不采信上报值。
- `ipc/design.ts` 的 trusted 额外放行“设计窗口 + 顶层 frame + 停留在 design 入口”，导航守卫和
  CSP 与主入口一致；主 frame 的 `will-navigate` / `will-redirect` 直接拒绝。
- `DesignToolBroker` 把绑定窗口当专属运行时：同会话优先于主窗口，且绝不作为其它会话的兜底。
- 第二个 renderer **不能导入持久化到 settings.json 的主窗口 store**（sessions、sidePanel），
  否则会把旧快照写回、覆盖主窗口数据，见
  [persisted-store-second-window](../big-question/persisted-store-second-window.md)。
  会话状态由主窗口经 Main 推送（`DESIGN_WINDOW_PUSH_STATE`），派活经 Main 交回主窗口执行。

## 设计 iframe 的双层导航边界

主入口 CSP 的 `frame-src` 只允许 `'self'`（既有插件 shell）和 `http://127.0.0.1:*`；
设置入口不增加该权限。`design/navigation.ts` 在主工作区的 `will-frame-navigate` /
`will-redirect` 上进一步校验 owner 的运行中引擎端口，并绑定首个引擎 origin；不能
从一个已登记端口跳到另一个端口。引擎换端口时 Renderer 应重建 iframe，不复用旧 frame。
主 frame 与插件视图继续使用各自既有策略，`window.open` 仍由工厂的 deny/外链策略处理。

Electron 43 实测：`data:` 被 CSP 拒绝时可能不触发 `will-frame-navigate`，
`WebFrameMain.url` 仍显示失败 URL；不能只凭 URL 判断逃逸，要验目标内容/脚本确实未执行。
可信父页重置 iframe 的 `about:blank` 同样可能同步提交、不触发守卫；自发 blank
继承发起者 origin，本模块允许它，不尝试拦截可信主界面的 DOM 操作。
回归：`design/navigation.test.ts` 同时检查纯判定、两类事件和真实 index CSP 精确白名单。

## 无边框标题栏

平台差异集中在工厂里：

```ts
titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
frame: isMac,
...(isWindows && {
  transparent: false,
  thickFrame: true,
  backgroundColor: color,
  titleBarOverlay: { color: '#00000000', symbolColor, height: 44 },
}),
...(isMac && { trafficLightPosition: TRAFFIC_LIGHT_POSITION }),
```

macOS 保留系统红绿灯；Windows 通过 Window Controls Overlay 保留原生窗口按钮，
让系统识别最大化按钮并提供 Windows 11 贴靠布局；Linux 由 `TitleBar.tsx` 自绘。
Windows 的标题栏内容为原生按钮预留区域，优先使用 `titlebar-area-width`，独立
`WebContentsView` 没有该几何信息时按 138 DIP 预留。原生按钮底板在创建和更新时均保持
透明，让 renderer 绘制的背景、壁纸和弹窗遮罩自然延伸到右上角。不要把底板重新刷成
主题实色，也不要为了底板透明而把顶层窗口改透明。`window:set-title-bar-appearance`
只同步不透明的窗口兜底色和按钮符号色，并且只允许该窗口的工作区 renderer 更新。

标题栏默认透明，计算窗口兜底色时必须先铺原始不透明 `--shell`，再叠加标题栏底色；
直接丢弃透明像素的 alpha 会得到黑色。主题监听须覆盖 `data-light-palette`，不能只观察
明暗模式 class。回归：`windowChrome.test.ts`、`ipc/window.test.ts`、`useNativeWindowControls.test.tsx`。

明显压暗全窗口的浮层（例如看图放大）仍用 `useNativeCaptionScrim` 登记遮罩色，
因为原生按钮符号画在遮罩之上。合成后的颜色只用于选择有对比度的符号色，不能再次
写入窗口兜底色，否则会重复叠色。遮罩 class 和登记的 CSS 颜色需保持一致。
回归：`useNativeWindowControls.test.tsx`、`ZoomableImage.test.tsx`。

Windows 顶层 `BrowserWindow` 必须保持不透明：Electron 43 的透明窗口会强制关闭
粗边框，并使用特殊的最大化路径。主窗口的 workbench `WebContentsView` 与其 HTML
仍保持透明，所以 guest 网页垫底和菜单遮挡仍沿原有视图叠层处理。macOS/Linux 的
透明主窗口配置保持原样。

主窗口暂时保留 800×600 的最小尺寸。系统贴靠区域小于此尺寸时仍会受到限制；
进一步降低限制需要同时适配聊天、侧栏和右侧面板，不能只改两个尺寸常量。

Linux 最大化后中间按钮改成还原图标（重叠方块），不要一直画单个方块。

`useWindowsWindowChrome` 给主窗口 `html` 挂 `enso-win` 和 `enso-win-native`，
最大化/全屏时挂 `enso-win-flush`。原生模式不叠加 renderer 自绘圆角与描边；
这些状态只控制 browser guest/devtools 的边缘预留。

窗口状态事件可能先于初始 IPC 查询返回；初始快照不能覆盖已经收到事件的字段，
Effect 清理后也不能让未完成的查询重新写 class。初始查询完成前挂
`enso-win-pending`，避免恢复最大化窗口时短暂闪出普通态圆角。
Windows 恢复窗口时 `unmaximize` 通知可能不到 pinned renderer；renderer 收到
`resize` 后要防抖重查 `isMaximized` / `isFullScreen`，事件通知只作为快速路径。

Browser guest/devtools 是独立原生 `WebContentsView`，提到 workbench 上方时不受
`#root` 的圆角裁切和 CSS z-index 约束。普通窗口下，renderer 上报 viewport 的
`browser-native-stack` 必须给右描边留 2px（1px 窗口裁边 + 1px 描边）、给底部圆角留 8px；flush 状态取消预留。

## Windows 最小化

旧版透明主窗口 + pinned `WebContentsView` 在 Windows 上最小化一段时间后，任务栏可能点不回来。
主窗口 `html` / `body` 全透明，UI 全靠 workbench 画，所以 occlusion、0×0 bounds、
renderer 被杀、GPU 丢表面的观感都一样，**未在真机二分，不要把其中一条写成已证实根因**。

当前 Windows 顶层窗口已不透明；仍保留以下防御（`win32Restore.ts` / `rendererGone.ts`）：

- win32 启动时把 `CalculateNativeWinOcclusion` 合并进 `disable-features`（未证实是否仍有效）。
- 最小化 / 空矩形不写 workbench bounds；`restore` / `show` / `maximize` / `unmaximize` /
  `display-metrics-changed` 立即同步，并 `setImmediate` 再同步一次。
- `browserHost.syncViewStack` 走同一套 bounds。
- `restore` 只在「刚从 minimize 回来」时尝试 `show()`，避免和 unmaximize 的 `restore` 搅在一起。
- `render-process-gone` 除 `clean-exit` 外都 reload（含 Windows 后台 `killed`），60s 内最多 3 次。
- `child-process-gone` 打日志，便于下次对照 GPU / utility 是否先死。
- 第二实例唤起要 `restore` + `show` + `focus`，不能只 `focus`。
- 不要给 pinned workbench 关 `backgroundThrottling`：挡不住合成器停帧，还会让最小化期间
  layout 更勤，更容易把 bounds 写坏。

## macOS 红绿灯

三条来自实际排查的约束：

**位置用固定像素，不用 rem。** 本项目 `:root` 的 `font-size` 是 14px，
Tailwind 的 `h-11` 会算成 38.5px 而不是 44px，与 `trafficLightPosition: { x: 16, y: 16 }`
假定的 44px 标题栏对不上，标题就不居中。标题栏因此写死 `h-[44px]` 和 `pl-[84px]`。

**恢复显示时必须重设位置。** `setWindowButtonVisibility(true)` 会把按钮位置重置为系统默认，
所以 `src/main/ipc/window.ts` 里恢复显示后要重新 `setWindowButtonPosition()`。
漏掉的表现是：弹窗开关一次之后红绿灯位置就偏了。

**开关由渲染层的引用计数守卫驱动。** `src/renderer/hooks/useTrafficLightsGuard.ts`
是模块级单例，多个并发弹窗用计数避免互相覆盖，全屏时不隐藏，HMR 时通过
`import.meta.hot.dispose` 复位以免计数泄漏。Dialog / AlertDialog 的根组件已自动调用，
新弹窗组件走这两个封装就无需关心。

## 窗口状态持久化

传 `stateFile` 即启用，状态写在 `app.getPath('userData')` 下的独立 JSON，
与 `settings.json` 分开 —— 窗口几何信息变化频繁，不该触发设置的多窗口广播。

## 生命周期

`src/main/index.ts` 的要点：

- **单实例锁**：`requestSingleInstanceLock()`，第二个实例聚焦已有窗口后退出。
  调试时若发现新起的实例秒退，先确认没有残留进程：
  `pkill -f "electron-vite dev"`。
- `app.on('browser-window-created')` 统一给所有新窗口挂状态事件，
  见 `ipc/index.ts` 的 `attachWindowStateEvents`。
- 退出前 `flushSettings()` 落盘未写完的设置（见 [settings-persistence.md](settings-persistence.md)）。

## guest WebContentsView 由 BrowserHost 管，不走 createAppWindow

内嵌浏览器的网页是主窗口 `contentView` 的子 `WebContentsView`，不是 app 窗口：
不开新 `BrowserWindow`，不进 `createAppWindow`。矩形由渲染层 `browser:set-viewport`
上报（CSS px = DIP，直接 `setBounds`），可见性由 `browserHost.layout()` 统一决定。

真机踩过的坑（改 `browserHost.ts` 前先读）：

- 自定义 DevTools 自带 X 的关闭通知不能只靠 Electron 事件；必须桥接 embedder
  `closeWindow` 并统一清理前端引用，再恢复布局。已销毁 view 不得重新挂载，否则连菜单
  covered 上报也会失败。详见 [关闭 DevTools 后布局残留](../big-question/browser-devtools-close-layout.md)。
- `contentView` 的子视图**全部画在 renderer 之上**，index 0 也不例外；无头只能 `setVisible(false)`。
- 隐藏后 view 尺寸归零，页面布局 0×0（快照只剩 inline 元素、截图空）。用 CDP
  `Emulation.setDeviceMetricsOverride` 撑出 viewport，可见时 `clearDeviceMetricsOverride`。
- 隐藏 tab 另外开 `Emulation.setFocusEmulationEnabled`，否则后台页 rAF / 动画仍会被掐
  （`backgroundThrottling: false` 不够）。亮着的 tab 关掉 focus emulation。
- 被遮挡 / 隐藏的 view `capturePage` 报 `UnknownVizError`；截图走 CDP
  `Page.captureScreenshot` + `captureBeyondViewport`。
- 可见的设备预览用 `dontSetVisibleSize: true`，原生绘制尺寸只由 `WebContentsView.setBounds`
  控制；从隐藏态恢复时先清掉 CDP 留下的尺寸覆盖。Electron 43/macOS 实测，不分开这两个尺寸，
  `Page.captureScreenshot` 恢复视图时会按未缩放的逻辑尺寸绘制，网页背景会溢出设备框的右侧和底部，
  但 `getBounds()` 仍然返回正确的框尺寸。验收要看系统窗口截图，而不是只查 DOM 或 `getBounds()`。
- **首次 `dom-ready` 之前 `debugger.attach` 会让 Main 段错误**（SIGSEGV）。`Tab.ready`
  门住所有 CDP 调用。
- 渲染层 CDP 截图只拍 renderer webContents，看不到兄弟 view；验叠层要 `screencapture`。
- **层级按 `covered` 动态切**（`browserHost.layout()`）。工作区 renderer 是一整块 NSView，
  **透明像素照样吃掉 hit-test**——guest 垫在它下面时用户点不到网页（锁没锁都一样，真机踩过）。
  所以：平时 guest `addChildView(view)` 叠在工作区**之上**，用户可直接操作；只有 renderer
  报 `covered=true` 时才 `addChildView(view, 0)` 沉到底，靠 HTML 透明洞（`.enso-guest-hole`）
  透出网页，让菜单 / Dialog 盖在上面。
- `covered` 由 `BrowserView.tsx` 的 rAF tick 算：空页占位，或带浮层标记的可见盒子与网页
  矩形相交（`overlayCover.ts`，不区分是否 portal 到 `#root` 外）。`locked` 仅为标签保留标记，
  不参与覆盖或人工输入门控。不要为弹层整页隐藏 guest，也不要用原生菜单绕。
- 布局层级已经正确时不重新 `addChildView(existing)`：比较当前顶部视图序列后再调整，
  避免 viewport / dom-ready 重复上报时反复重挂 workbench 和 guest；矩形更新仍正常执行。
- Code 侧栏收到 Agent 导航 / 恢复的 `browser:reveal` 时，后台登记面板，不调用已有面板
  `focus()`；有其它面板时新页使用 `inactive`，空 dock 首个页须 active 才会上报 viewport。
  冷 dock 等 `fromJSON` 恢复后再重放，并保留后台意图。用户明确点击打开仍可激活。
  回归见 `sidePanelDock.browser.test.ts`（真实 Dockview 的焦点/光标/可见性）、
  `sidePanelDock.test.ts` 和 `browserHost.zorder.test.ts`；原生焦点 / IME 仍需真机验收，
  不以视图顺序单测通过宣称当前安装版已经修复。
- 挖孔要求网页矩形之上的 DOM **全部透明**：主外壳、workspace 卡片、设备预览舞台底色都不能
  在洞内刷不透明底色，否则菜单 / Dialog 一开，沉底后的 guest 被盖住，网页表现为整块空白
  （`BackgroundLayer` 的实心底只在洞外生效）。设备预览的舞台底色由 `deviceStageClip` 在框内挖空。
- 验证「用户能不能点网页」必须发 **OS 级鼠标事件**（CGEvent / `cliclick`）；CDP
  `Input.dispatchMouseEvent` 直接进 webContents，绕过 NSView hit-test，验不出层级问题。
