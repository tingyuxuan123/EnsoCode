# vetta-ui-design → EnsoCode（P1-C / P2-UI）

## 基准与边界

来源：Open Vetta `packages/plugins/presets/vetta-ui-design`，`plugin.json` 0.7.6
（包管理元数据 `package.json` 为 0.1.15）。`vetta/{src,test,locales}` 保留上游相对布局；
`vetta/vendor/taste-skill` 整体复制，含 LICENSE、UPSTREAM.md 与 library JSON。
补入上游 plugin.json（静态契约测试使用）和 Apache-2.0 LICENSE。

行为差距：EnsoCode 没有 Vetta 插件宿主、通用 command、特权文件协议；P1 在 Renderer
执行工具和登记贡献，P2-UI 将画布、截图卡和样机工作台接入渲染层，不增加 preload 暴露。
`host/` 负责 SDK 兼容、绝对路径拆分与 IPC；Main 仍负责权威根、realpath、写白名单。
画廊、文件树、分享包预览仍未挂载。

## 构建和同步

- electron-vite renderer、根 tsc、tsconfig.web、Vitest 共用
  `@vetta-org/plugin-sdk → host/sdk.ts`、`@design-engine → resources/design/engine`、
  `@design-agent → resources/design`。引擎未复制到 Renderer。
- 上游读取 engine/routes、storage-sync、touch、ios 等的源码/测试，以及 engine-files
  的 raw imports 改为上述 alias；测试中 Node 文件读取改为 resources 路径。
- `@vetta/ios` 在插件中仅存在于生成源码字符串；无 renderer package import，
  真正运行时 alias 由 resources/design/engine/vite.config.mjs 提供，不另装同名包。
- 仅增加 renderer/test devDependencies：fflate、happy-dom、devices.css。
  Vitest design project 用 happy-dom，其它测试保持 node；未排除迁入代码的 tsc 检查。
- Biome 整体排除 `vetta/**`（包括必要 SDK 类型摘录），不对上游目录格式化，
  以免同步产生纯格式差异。host/runtime 正常 lint。
- 上游入口原本依靠 plugin-vite 将 CSS 包在 plugin-root `@scope` 中。P2 从
  `DesignRuntimeHost` 单独导入样式，Vite pre 插件排序在 Tailwind 之后、Vite CSS 转换之前，
  仅处理此文件；主题/工具类/devices.css/画布选择器都包 `@scope`，`:root`/`:host`
  变 `:scope`，Iconify 默认规则留在 scope 内的低优先级 layer。宿主 Tailwind 不扫描 `vetta/`，
  Vetta 只扫描 `vetta/src/`。不引入 preflight；颜色和 color-scheme 继承宿主变量。
- 已使用 electron-vite 的 renderer 配置独立 Vite production build 验证：六个动态 JSON
  directions/heroes/sections/type/palettes/photos 均生成独立 JS chunks，不依赖 resources/vendor。
  完整三段构建另遇 Main bundle 的 unterminated string（非 renderer 代码）。

## SDK 兼容面

上游实际导入 21 个不同名字（包含类型）；`host/sdk.ts` 提供全量：CardDescriptor、Disposable、
PluginCardProps、PluginCommandSpawnExit/Handle、PluginContext、PluginDynamicSystemPromptOperation、
PluginFsApi/FileRef、PluginNewSessionContext、PluginOfficialSessionSummary、
PluginOffscreenCaptureOptions/Result、PluginPendingToolCall、PluginPreviewFile、PluginUiApi、
definePlugin、readJsonFile、useActivityTab、usePluginShortcutScope、useTranslation；另保留测试所用
agent handler/registration、command API 与 writeJsonFile 等类型/辅助出口。
SDK 类型摘自上游 SDK，删去不需要的 capability/typebox runtime 依赖；prompt attachment 为类型子集。

实现：

- fs readDir/readFile/readBinaryFile/writeFile/stat/rename/delete/createDirectory/
  listFilesRecursive/saveAs/watchDirectory；回调传监听目录字符串，不传 watchId。
  resolveRoot 的记录才可成为已知根；路径必须本地 POSIX 绝对路径，拒绝根外、点段、NUL、
  反斜线、SSH。最长根匹配；scan 返回的 relPath 相对扫描目录，IPC rel 相对权威根。
- storage list/readFile/writeFile/commit/readSnapshot 与 readJsonFile/writeJsonFile。
- capture offscreen/release：URL 仅允许已启动引擎端口的 `http://127.0.0.1`，换算为
  engineId + path/query/hash，不把 URL 发给 Main。
- network GET/POST + JSON body，Main 固定主机白名单继续生效。
- agent registerTool/registerHook/registerSystemPromptProvider；ui.register*、fileExplorer
  decoration/contextMenu 登记 `useDesignRegistry`。P2 实接 design Dock 打开/可见性/宽度、图片
  预览、通知、局部快捷键；工作区导航/文件预览仍只登记。openExternal 走 design.shell，
  copyImage 用浏览器 clipboard，notify 走宿主 toast。
- conversation 订阅立即微任务重放当前会话；createSession 只用已存在的本地项目；
  sendPrompt 走既有 sessions store，沿用 Composer 的有效模型解析。i18n zh/en 随设置变化；
  React translation hook 不在 import 时初始化宿主持久 store。
- official projects.list 使用已有项目并 resolveRoot，sessions.list/listRunningCwds/open
  使用已知会话投影和 sessionWorkspaceCwd（含 worktree），shell.showItemInFolder 走 design.shell。

明确不支持（调用抛 `EnsoCode design host: … is not supported in P1`）：
任意 command.run/spawn、fs.move、storage blobs、multipart/PUT/PATCH/DELETE 网络请求、
conversation.abort、official.projects.create/archive 等写操作、official.dialog.openFiles/saveCopy、
其它未实现 official 域；ui.captureRegion/createQrCode/sidebar 订阅。
默认 AgentMode 返回 code，不做 Vetta 远端执行/权限系统。新增宿主能力不得回退通用 IPC。

## 必要替换（上游行为 / 本地实现 / 原因）

| 模块 | 上游行为 | 本地实现与原因 |
| --- | --- | --- |
| engine/engine-manager.ts | node -e 物化/迁移 ~/.vetta、spawn npm/vite、远程路由 | design.engine start/stop/status/install/build/diagnostics；Main 管理 Electron Node 与资源。保留导出签名，migrateLegacyEngine 不触碰 ~/.vetta，ensureEngine/engineReady 只探诊断，真正物化由 start/build/install 完成；Main 已等待 HTTP ready。handle.pid 为 0（契约不暴露 pid）。 |
| history/runner-host.ts | 把 raw runner 分块物化再 node 执行 | design.script history；ensureRunner 显式不支持独立物化。dir 先转 root/designRel，payload 删除 dir/out/from，Main 固定脚本。 |
| history/history-transfer.ts | pack/unpack 指定绝对 out/from | 不传 out/from，读写 `<设计包>/.history-pack.zip`；Main 同名推导，禁止任意输出路径。 |
| vetd/check-syntax.ts | node -e + 引擎 esbuild 扫描 | design.script check-syntax + frames/components 下 TSX 相对列表；仍保留上游失败时不伪造语法错误语义。 |
| gallery/open-demo.ts | 任意 node 写临时 HTML 并用系统命令打开 | P1 明确报错；无此固定 Main API，P3 做沙箱 demo。 |
| style.css | 上游由插件包扫描工具类并全量 scope | 显式限定 Tailwind 扫描目录并单文件编译后 scope；宿主与插件不交叉产出工具类。 |
| cards/file-url.ts、ScreenshotSwiper.tsx | 同步生成 vetta-file://local 特权 URL | 经 SDK fs.readBinaryFile → MIME 校验 → blob URL；卡片卸载/替换时释放，弹层独立持有 URL，避免虚拟卡片卸载把预览清掉。 |
| canvas/design-runtime.ts | 模块级单画布 controller | 保留单例，新增订阅；仅活跃 dock 挂载，controller 就绪/失效/卸载或会话切换时报告 `{sessionId, open}`，上报失败只警告。 |
| canvas/FrameView.tsx、interaction/InteractionView.tsx | 刷新原 iframe 的 src | 端口变化换 iframe key，FrameView 重绑 bridge 并重置加载基线；Main 按 frame 首次引擎 origin 锁定导航。sandbox/allow 与上游一致（这两处均未设置）。 |
| canvas/bridge-client.ts、interaction/nav-bridge.ts、shared/frame-origin.ts | 主要按 source 匹配，未校验 origin，父→子用 `*` | 本地同时要求已登记 iframe、固定 `http://127.0.0.1:<port>` origin 和 `vetd:true`，含 space/HMR；父→子只投递该 origin，截图/元素回应必须匹配请求画框。 |
| mockup/ExportMockupDialog.tsx | 自建 z-1000 模态及 Escape 监听 | 业务工作台不改，外壳改宿主 Dialog Header/Panel/Footer、层级/焦点、body portal 内补 scope 根。其它上游 PluginPortal 已有标记；选中追问 portal 目标在画布内。 |
| sdk/activity-tab.ts、sdk/conversation.ts、notes/handoff.ts | 备注派活调用当前会话，无显式会话 id | 本地在 ActivityTab 上下文携带 canvas sessionId，派活带所属 id/cwd 并在真正发送前复核，旧回调不改发新会话，忙时不入队。 |

上游 shared/payload-transfer.ts 的 node -e 辅助实现保留便于同步，但生产替换模块不再调用；
即使被调用也会被 command 不支持错误拒绝。Main 写白名单已覆盖目前本地可达工具写入；
未发现需扩大白名单的新路径。历史脚本不将 absolute dir/out/from 下发。

## 运行时与 P2 验收清单

主窗口常驻激活上游入口一次，登记 11 工具、3 hooks、2 prompt providers 与 UI 描述符。
`listRegisteredDesignTools()` 返回上游 name/description/parameters，供 schema 漂移测试使用。
工具请求先 resolveRoot，再按名称分发，提供 session.id/cwd、trigger.input、host 与 AbortSignal；
onToolCancel abort，取消后不返回成功。文本/JSON → text，显式图片 → base64+mimeType，
cards → details.cards；异常 respondTool `{ok:false,error}`。上游业务 `{ok:false}` 保留为文本结果。
当前查看会话（含 child tab）变化重新 registerRuntime；旧异步 resolve 回包不覆盖新会话。
hooks 按会话串行：prompt-submit → UserPromptSubmit 先封存上轮再记提示，stop → Stop 提交，
session-end → SessionEnd 清理提示记忆。契约没有 turnId/model/cause，填保守默认；历史 hooks
只用 session.id/cwd/prompt。prompt providers 本期只登记，未伪称影响 worker tool-gate/系统提示词。

不创建 headless canvas controller，P2 必须逐项验收：

1. vetd_screenshot：单帧/批量/all、source 检查、离屏 capture、图片与卡片返回；P1 清楚提示需 P2 面板，勿循环重试。
2. vetd_export：PDF/images 同样要求 controller；分享包导出由 UI 另挂。
3. vetd_direction：deal/show/choose/propose 等全部需要 controller。
4. vetd_assets：search/download 全部需要 controller。
5. vetd_notes：P1 可读冻结锚点、文件级 resolve；P2 需验活体定位/标注截图/写回与派活。
6. vetd_status：P1 工作区/源码可读；P2 增补 openDesign/sharedShell/renderVerification/engine 状态。
7. vetd_install/history/restore：P1 无 controller 时按 explicit/工作区选择设计；P2 验恢复后 reload、依赖重装。
8. vetd_create：P1 脚手架与 pending open 状态登记有效，但不会真的打开画布；P2 接消费请求、尺寸/方向状态和多个会话隔离。
9. tool-gate：controller 存在性快捷路径与 worker 每轮缓存闸门衔接；不得把本期注册表当成已注入的模型策略。

选中不再挂到输入框：此版上游 `SelectionAskBadge` 将 frame/DOM 选中保存为批注，空闲防抖后
通过 `sessions.send` 交给画布所属会话。prompt 指示模型 `Call vetd_notes with no arguments`，
不内嵌批注原文或快照；`vetd_notes` 返回 `anchor.frameId`、`element.source`（文件:行）、
`element.domPath` 等和标注图。正在运行时记为已派发、由本轮收尾自检，不排队/结束后不补发；
跨 cwd 则等正确会话。没有新增“引用到输入框”按钮。

通用 SDK `setPromptAttachment` 仍可设置/替换一条对应会话的 Composer chip，`null` 清除，
一次性附件在接受发送后摘掉，`sticky` 保留。独立 `insertText` 与附件变更走现有 draft
generation/revision、忙碌及 IME 门禁；实际发送仍由 Composer。无跨层 metadata 扩展，
结构化内容以文本附录传递：`<plugin_prompt_contexts>` 中 JSON 数组元素是
`{pluginId:"vetta-ui-design",schema,version,payload}`，沿用上游尖括号转义及数据边界说明。

取消限制：上游 handler 原签名没有 AbortSignal，runtime 只能竞速拒绝和向 context 添加 signal；
已经发出的 fs/engine/script IPC 无取消字段，不能撤销已发生的写入/进程动作。后续要完整取消需扩契约。
conversation 接了查看会话的运行状态边沿（供 notes 闸口），尚未接细粒度工具生成/开始/结束事件。

## 严格类型与测试差异

保持 production strict，不用 ts-nocheck，不排除迁入测试。最小修复清单：

- check-sources.test：find 结果可空，断言改 optional；engine-preloadable：renderOnce 接 ComponentType。
- frame-handoff：补 file/meta/menuItems/onMenuSlot/onRadiusCommit fixture；frame-size：补 radius:null。
- gallery-store：mock 明确 rest 参数；history-runner：补返回 files 类型。
- history-tools：删除源码已不接受的 agentMode；interaction-toolbar：删除过期 onPickMode。
- mockup-workbench/notes-auto-dispatch/start-from-system：mock 声明实际参数，避免 Vitest 4 的空 tuple 推断。
- notes-visibility：补 joinedActive/scale/transition；screenshot-card-stability：真实 PluginCardProps + message，移除 never spread。
- engine-files 中原始 NUL 用等价 `\0` 转义，内容 hash 语义不变，使文本补丁可维护。
- bridge-hub-lifecycle：happy-dom 21 iframe 无 contentWindow，使用 postMessage fake，不改生产桥行为。
- cover-compose-abort/gallery-catalog-refresh/gallery-skeleton：上游文件级 jsdom 指令改 happy-dom；
  文件级环境优先于 project 默认，否则全量测试仍会寻找未安装的 jsdom。
- engine-recovery-ui：补 onPendingDesignPath fake 及函数型取消订阅。
- runner-host/history-machine/payload-transfer 测试改 EnsoCode IPC fake；history-peek 使用真实已构建 runner 加 IPC fake。
- file-url 测试覆盖异步二进制读取、MIME 拒绝及幂等释放；frame-handoff 覆盖端口改变重建 DOM；notes-auto-dispatch 覆盖所属会话及锚点。assets/direction 文案断言改为 P2 面板提示；entry-lazy 检查固定 IPC 而非 raw runner 动态加载。
- 仅跳过 engine-manager 的 3 条 ~/.vetta 迁移/旧 readiness 测试：EnsoCode 明确不迁移该目录，Main 引擎服务另测；退出事件测试继续跑。

新增 paths/results/context/runtime-dispatch/完整入口激活测试，包含 RED 后 GREEN 的路径映射、
结果转换、分发与 cards 保留断言。真机模型验收尚未执行；不能以 happy-dom 结果代替两厂商模型验证。

P2-UI 验证（2026-11-03）：design project 163 文件、1040 passed、3 个既有 skip；侧栏/时间线/
工具卡/draft 回归 39 文件、426 passed，根 typecheck 与变更文件 Biome 通过，phone typecheck/build
通过，`pnpm build` 三段成功。产物 `globals-C-X98f9D.css` 无 scope/无 `.vetd-*` 或 `.device`，
宿主 `--radius-xl:var(--radius)`/`--font-sans:var(--font-family-sans,…)` 未被上游覆盖；
`index-kXqFfW9o.css` 有 218 个 scope，492 条 Vetta/devices 规则均在插件 scope 内。
隔离 `/tmp/enso-p2ui-smoke`、CDP 9333（PID/环境核验后操作）冒烟：面板打开并全屏，明暗画布底色
继承 secondary，外部同类无效；输入框真实键入 `c` 不触发画布绑定、面板焦点则触发；样机弹窗
具备插件根标记、Header/Panel/Footer 与宿主 z=51。隔离实例已关闭、数据目录已删除。
完整画框/依赖 controller 的工具/两厂商模型联合真机验收由主任务继续，不能把本节替代 P2 验收清单。
