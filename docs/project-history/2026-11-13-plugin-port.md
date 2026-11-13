# Collabra 原生插件全量移植

上游固定基线：`J3n5en/EnsoCode@c221f69028cb8d357a1539cbca11f8c025546e9f`（0.3.5）。
用户选择全部移植，按模块完成；不是整仓合并，也不是发版请求。

## 行为差距与所属层

- 当前 fork 只有静态工具、基础挂点、草稿与侧栏，以及本地安装/模板校验。
- 新增清单贡献、授权扩大判断、市场、自动更新、开发监听属于 Main 插件服务。
- 生命周期通知/拦截、注入、子代理、预设和 workflow 属于 worker + Main 会话权威链。
- 文件查看器、状态项、快捷键、主题、消息/思考挂点属于 Renderer，所有磁盘读写仍经 Main。
- 作者打包与测试桩属于 `src/tooling/`，复用安装校验，不增加无界面服务器基础设施。

## 必改文件边界

- `src/shared/extensionPlugins/**`：公开清单、事件、授权、宿主协议和投影类型。
- `src/main/services/extensionPlugins/**`、`src/pluginHost/**`：运行时、进程、市场、开发监听、产物及安全闸门。
- `src/agent/pluginEvents*`、`src/agent/tools/pluginTools*`、`supervisor*`、workflow：运行时接线。
- `src/shared/types/agent.ts` 与 parser、`agentHost.ts`、`pluginRuntime.ts`、`ipc/agent.ts`：typed worker 链与会话目录。
- `src/shared/types/ipc.ts`、`src/main/ipc/extensionPlugins.ts`、`src/preload/index.ts`：每个新增 IPC 的三点式出口。
- `src/renderer/plugins/**`、扩展/设置、Composer、聊天挂点、文件侧栏和主题：保留 Collabra 现有结构后接入新贡献。
- `src/tooling/plugin{Author,Pack,Testing}*`、`scripts/plugin-author.mjs`、`package.json`：本地作者 CLI。
- `docs/plugins.md`、作者声明与示例：以实际移植契约为准，不声称整个平台兼容。

## 保留的 fork 约束

- 新安装默认停用；预览/安装不执行代码，显式启用后才运行。更新扩权仍须确认。
- 管理 IPC 只允许精确本机主窗口/设置 top frame，安装 token 绑定发起窗口；不照搬上游放宽远程访问。
- 损坏登记表只读，保存原件和有界备份，不清掉坏记录或插件目录。
- 下载只接受 HTTPS；保留 DNS/IP pinning、逐跳校验、解压/符号链接/硬链接防线。
- MCP 沿 exact worker generation、真实工具审批和 Plan 状态；文件写入保留 invocationPolicy。
- 草稿保留版本锁、焦点和用户手势；`ui.js` 同权，HTML 侧栏才是沙箱。
- 保留 Collabra 品牌、主侧栏扩展入口、本地安装优先，以及现有主题、设计、Bot 与会话定制。

## 明确不做

- 不合并上游全部 0.3.5、不升级 Electron/Pi/依赖、不加入服务器或远程管理基础设施。
- 不修改发布通道、版本、证书或真实用户配置，不自动安装到用户正在用的应用。
- 不把测试桩当成 Electron/真实模型验证；最终分别记录单测、构建、隔离实例和双厂商证据。

## 真实验收与审查修复

- 在独立 userData 与非默认 CDP 端口运行开发 Electron；安装预览/确认后插件为 disabled，显式启用后才提供工具。
- DeepSeek `auto/deepseek-v4.1-flash` 与 OpenAI `auto/gpt-6.1-sol` 分别在真实会话调用 `plugin_collabra-verify-plugin__echo`，Main 历史均记录一次 toolCall、成功 toolResult 和最终回复；不是假 provider，也不使用模型自报作为证据。
- 真实 `session.create({text})` 曾出现返回会话但输入框为空，已修为强制新建 + store 可观察的一次性草稿注入，再验证编辑区出现 `PLUGIN_CREATE_PREFILL_VERIFIED`；不覆盖用户已有草稿。
- 审查补测并修复：failClosed 检查器熔断仍拒绝、UI 调用捕获 Main 代际证明、声明侧栏目录内静态资源可内联、缺省 generation 的写入/MCP fail-closed。
- 热重载 iframe 实测曾触发 Electron disposed-frame getter 异常；导航守卫现在捕获并拒绝无法核验的导航，不让异常冒泡主进程。
- 新增可复用隔离验收样例：`test/fixtures/plugin-port/`。不安装到用户正式应用，不保留测试凭证或会话到真实配置。

## 已修复的阻断项：插件侧栏/文件查看器面板会让 Main 自旋

现象（隔离 dev 实例，多次复现）：

1. 干净 userData 启动，`extensionPlugins.list()` 正常、CDP 正常、Main CPU ~0%。
2. 打开一次插件侧栏面板（`ui.view.open('status')`，或渲染层直接 `openSidePanelPluginView`）后，主进程 CPU 升到约 99%，DevTools/CDP 立即不可达；渲染进程仍 0%。
3. 之后再以同一 userData 启动会直接卡住（dock 布局恢复该面板）。

已排除（均在同一个隔离实例里实测无自旋）：

- 裸注入 `<iframe name="enso-plugin-view" sandbox="allow-scripts" src="/plugin-view.html#x">`：正常。
- 同样 iframe 再 `postMessage(..., [port])` 传输 MessageChannel 端口、注入内联 HTML：正常。
- 只调用 `asset()` + `viewStateGet()` IPC：正常。
- 打开 Files 面板（无 iframe）：正常。
- 两次 `will-frame-navigate` / `will-redirect` 守卫都已 try/catch + 祖先遍历上限 32，并允许 `about:blank`。

定位过程与根因：

- 用 `ps -o time=,pcpu=` 而不是 `ps %cpu`（后者是生命周期均值）确认是主进程持续 100%，`Debugger.pause` 进不去（原生忙循环）。
- 二分结论：**只要主窗口上注册了 `will-frame-navigate` / `will-redirect` 监听**，挂载沙箱插件 iframe 后主进程就自旋；两条监听都摘掉则完全正常。守卫回调本身只被调用 2 次（探针实测），也没有走到 `preventDefault`——触发点在 Electron 侧被同步咨询导航的路径，而不是我们的 JS 逻辑。
- 修法：主窗口不再注册插件帧导航守卫，改为按需注册设计守卫（只有存在设计引擎端口时才挂，引擎关闭即摘除）。插件侧栏帧的边界由 `sandbox="allow-scripts"`、壳页面 CSP（`frame-src`/`navigate-to 'none'`）、一次性 nonce 与 `event.source` 校验承担；`installPluginViewNavigationGuard` 保留但注明不得挂到承载插件 iframe 的主窗口。
- 验证：同一隔离实例里面板正常渲染（标题 `Verification status`、`sandbox=allow-scripts`、内容可见）、状态项显示 `Plugin ready`、Main CPU 约 0%、CDP 正常；重启后从 dock 布局恢复该面板同样正常。

遗留风险：设计画布与插件侧栏面板**同时**打开时，设计守卫仍处于挂载状态，存在同类自旋的理论可能；设计预览目前依赖该守卫做 loopback origin 校验，后续应改为按帧校验（例如 `webRequest` 过滤）后彻底移除对这些事件的依赖。
