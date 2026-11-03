# vetta-ui-design → EnsoCode（P1–P3）

## 基准与边界

来源：Open Vetta `packages/plugins/presets/vetta-ui-design`，`plugin.json` 0.7.6
（包管理元数据 `package.json` 为 0.1.15）。`vetta/{src,test,locales}` 保留上游相对布局；
`vetta/vendor/taste-skill` 整体复制，含 LICENSE、UPSTREAM.md 与 library JSON。
补入上游 plugin.json（静态契约测试使用）和 Apache-2.0 LICENSE。

行为差距：EnsoCode 没有 Vetta 插件宿主、通用 command、特权文件协议；P1 在 Renderer
执行工具和登记贡献，P2-UI 将画布、截图卡和样机工作台接入渲染层，不增加 preload 暴露。
`host/` 负责 SDK 兼容、绝对路径拆分与 IPC；Main 仍负责权威根、realpath、写白名单。
P3 补齐画廊、文件树和分享包预览；新增 Main 项目/原生选择/独立预览能力，仍不开放通用 command。

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
  预览、通知、局部快捷键；P3 消费工作区与文件贡献。openExternal 走 design.shell，
  copyImage 用浏览器 clipboard，notify 走宿主 toast。
- conversation 订阅立即微任务重放当前会话；createSession 只用已存在的本地项目；
  sendPrompt 走既有 sessions store，沿用 Composer 的有效模型解析。i18n zh/en 随设置变化；
  React translation hook 不在 import 时初始化宿主持久 store。
- official projects.list 使用已有项目并 resolveRoot，sessions.list/listRunningCwds/open
  使用已知会话投影和 sessionWorkspaceCwd（含 worktree），shell.showItemInFolder 走 design.shell。

明确不支持（调用抛 `EnsoCode design host: … is not supported in P1`）：
任意 command.run/spawn、fs.move、storage blobs、multipart/PUT/PATCH/DELETE 网络请求、
conversation.abort、official.projects.open/rename/remove 等写操作、official.dialog.saveCopy、
其它未实现 official 域；ui.captureRegion/createQrCode/sidebar 订阅。
默认 AgentMode 返回 code，不做 Vetta 远端执行/权限系统。新增宿主能力不得回退通用 IPC。

## 必要替换（上游行为 / 本地实现 / 原因）

| 模块 | 上游行为 | 本地实现与原因 |
| --- | --- | --- |
| engine/engine-manager.ts | node -e 物化/迁移 ~/.vetta、spawn npm/vite、远程路由 | design.engine start/stop/status/install/build/diagnostics；Main 管理 Electron Node 与资源。保留导出签名，migrateLegacyEngine 不触碰 ~/.vetta，ensureEngine/engineReady 只探诊断，真正物化由 start/build/install 完成；Main 已等待 HTTP ready。handle.pid 为 0（契约不暴露 pid）。 |
| history/runner-host.ts | 把 raw runner 分块物化再 node 执行 | design.script history；ensureRunner 显式不支持独立物化。dir 先转 root/designRel，payload 删除 dir/out/from，Main 固定脚本。 |
| history/history-transfer.ts | pack/unpack 指定绝对 out/from | 不传 out/from，读写 `<设计包>/.history-pack.zip`；Main 同名推导，禁止任意输出路径。 |
| vetd/check-syntax.ts | node -e + 引擎 esbuild 扫描 | design.script check-syntax + frames/components 下 TSX 相对列表；仍保留上游失败时不伪造语法错误语义。 |
| gallery/open-demo.ts、DesignSystemDemo.tsx | 任意 node 写临时 HTML 并用系统命令打开 | P3 使用宿主 Dialog 内无脚本 iframe；先清洗主动元素/导航/外部资源并加严格 CSP，保留安全 html/body 展示属性。不写临时 HTML，不拉系统浏览器。 |
| style.css | 上游由插件包扫描工具类并全量 scope | 显式限定 Tailwind 扫描目录并单文件编译后 scope；宿主与插件不交叉产出工具类。 |
| cards/file-url.ts、ScreenshotSwiper.tsx | 同步生成 vetta-file://local 特权 URL | 经 SDK fs.readBinaryFile → MIME 校验 → blob URL；卡片卸载/替换时释放，弹层独立持有 URL，避免虚拟卡片卸载把预览清掉。 |
| canvas/design-runtime.ts、canvas/CanvasTab.tsx | 模块级单画布 controller | 保留单例，新增订阅及 mounted cwd；tools/assets/direction/export/history 及 tool-gate 用 `getCanvasController(cwd)` 隔离项目（包括嵌套项目）。仅活跃 dock 挂载，presence 只报告匹配该挂载 cwd 的 controller。 |
| canvas/FrameView.tsx、interaction/InteractionView.tsx | 刷新原 iframe 的 src | 端口变化换 iframe key，FrameView 重绑 bridge 并重置加载基线；Main 按 frame 首次引擎 origin 锁定导航。sandbox/allow 与上游一致（这两处均未设置）。 |
| canvas/bridge-client.ts、interaction/nav-bridge.ts、shared/frame-origin.ts | 主要按 source 匹配，未校验 origin，父→子用 `*` | 本地同时要求已登记 iframe、固定 `http://127.0.0.1:<port>` origin 和 `vetd:true`，含 space/HMR；父→子只投递该 origin，截图/元素回应必须匹配请求画框。冷 iframe 的元素查询还须等待 rendered（不只 ready），避免命中 lazy frame 提交前的空 div；重挂/重新 ready 清除渲染标记，等待有上限。 |
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
工具 cwd 使用 resolveRoot 的规范路径，避免 `/tmp` 与 `/private/tmp` 分裂身份。宿主
`host/canvas-target.ts` 对 create/截图/方向/素材/导出及前台 status 串行租用单画布，排队与
打开等待各最多 60 秒，完成、超时、取消均释放。调用 cwd 与当前查看 cwd 相同（含同项目
designer 子会话）才可选择设计；其它项目的后台调用返回 `{ok:false,retryable:true}`，请用户
切回对应会话，绝不抢当前画布。后台 status 仍发现文件但 `open:null`，sizes/history 等
文件级工具不等画布租约。显式 cwd 的迟到 openActivityTab 也不能切走前台项目。
前台路由按已解析的当前会话身份匹配，不将 store 中可能保留别名的 worktree 路径与
规范路径直接比较；`/tmp`、符号链接等路径别名不会把本项目误判成后台项目。
create 成功须等精确新设计 controller 就绪；若已创建但未打开，保留 vetdPath、返回可重试
失败并明确勿重复 create，应切回会话后重试 status/screenshot，避免生成 `-1` 半成品。
宿主保留该 cwd 的精确待开目标供重试；仅在确认包已创建后返回 `created:true`，worker 的
`tools/design.ts` 据此仍刷新工具 gate，普通创建前失败不刷新。
这是与上游单活动页签宿主的差异：不会创建后台/headless controller，用户切走后的长任务
可能失败。上游 getter 按 cwd 再次过滤，覆盖 handler 内 await 后重新读取的竞态；已发出
的文件/引擎 IPC 仍不能撤销。回归见 `runtime-canvas.test.ts`。

隔离假 provider 对照（2026-11-03，HEAD `4a3ae51b` 与修复版）：同一响应并列两个
codemode，第二个均受本轮初始工具表限制；不能当作真实模型“收到结果后的下一响应”。
临时 provider 每收到 tool_result 才发下一 codemode，权威 child 历史确认两个独立
assistant 响应：HEAD 下一响应工具可见，但 create 后 status 为 open:null、截图要求
重试；修复版 designer create/写 frame → 下一响应 status 为新项目路径、截图成功，
无后缀包，切回 A 后 status/截图仍正确。后台请求不会抢前台画布也已复验。原始“B
读到 A”未稳定复现，不能据此断言旧 controller 延迟来自哪次 Dock 挂载竞态。
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
结果转换、分发与 cards 保留断言。P2 集成已进行 Claude/GPT 真实模型验证，详细结果与
尚未覆盖的工具矩阵见设计稿 §10；不能以 happy-dom 或假 provider 替代真实模型证据。

P2-UI 验证（2026-11-03）：design project 163 文件、1040 passed、3 个既有 skip；侧栏/时间线/
工具卡/draft 回归 39 文件、426 passed，根 typecheck 与变更文件 Biome 通过，phone typecheck/build
通过，`pnpm build` 三段成功。产物 `globals-C-X98f9D.css` 无 scope/无 `.vetd-*` 或 `.device`，
宿主 `--radius-xl:var(--radius)`/`--font-sans:var(--font-family-sans,…)` 未被上游覆盖；
`index-kXqFfW9o.css` 有 218 个 scope，492 条 Vetta/devices 规则均在插件 scope 内。
隔离 `/tmp/enso-p2ui-smoke`、CDP 9333（PID/环境核验后操作）冒烟：面板打开并全屏，明暗画布底色
继承 secondary，外部同类无效；输入框真实键入 `c` 不触发画布绑定、面板焦点则触发；样机弹窗
具备插件根标记、Header/Panel/Footer 与宿主 z=51。隔离实例已关闭、数据目录已删除。
完整画框/依赖 controller 的工具/两厂商模型联合真机验收由主任务继续，不能把本节替代 P2 验收清单。

## 品牌替换（P2 集成）

上游界面把 agent 称作 “Vetta”，导出样机默认画 Vetta 图标与 “Designed By Vetta”。EnsoCode 中：

- `locales/{zh,en}.json` 中 18 处 “Vetta” 换成聊天界面上的 agent 名 “Enso”；插件名改为“设计 / Design”，样机开关文案改为 EnsoCode。
- `canvas/NotesLayer.tsx`、`canvas/NotesDrawer.tsx` 写死的批注作者名改为 “Enso”。
- `mockup/render.ts` 水印文字改为 “EnsoCode / Designed with EnsoCode”；`mockup/brand-logo.ts` 换成 `build/icons/128x128.png`（常量名保持不变以减少 diff）。
- `assets/assets-tool.ts` 外部图片 API 的 User-Agent 如实标明 EnsoCode。
- `vetd/check-sources.ts` 中引用按钮文案的提示同步为“让 Enso 去做”。
- 保留：`.vetdz` 保存对话框的文件类型名 “Vetta Design”（上游格式名）、给模型看的工具描述与技能正文（漂移测试要求与上游一致）。
- `test/skill-presentation.test.ts` 的插件名断言同步改为“设计”。

## P3 宿主接线与安全差异

- AppRail 新增“设计”，只在本机 Code 模式且 designEnabled 开启时可用。注册的 GalleryView
  直接挂主区；header 独立订阅，避免上游每 render 发布新 ReactNode 造成父子重渲染循环。
  选择会话（含同 id 点击）回到聊天；画廊期间不显示旧 fullscreen Dock。
- `design.projects` 仅收 list/create(name)/setArchived(projectId,boolean)。Main 决定新项目落点
  `Documents/EnsoCode/Designs` 并登记现有 source authority，名称拒绝路径/保留字，重名新建后缀目录。
  archive 仅为持久、可恢复的画廊隐藏，不删除目录/会话/撤销项目权限；宿主提供已隐藏恢复入口。
  逐个 resolveRoot，单个坏项目不阻断扫描。会话候选只取可续聊的 root，按活跃时间倒序。
- `design.openFiles` 只用原生选择器获取 vetdz/vetd，最多 8 文件、总计 32MiB；路径不授予后续
  文件访问权限。saveAs 沿用用户选择的 Main 写入路径；取消不写入，所有接口限可信主窗口。
- `@shared/design/archive` 是 Renderer、Main 和 standalone runner 使用的同一有界 ZIP32 解码器：
  压缩/单文件 32MiB、总展开 128MiB、最多万条；拒绝点段/绝对/反斜杠/NUL/大小写或 Unicode
  别名冲突、Unix 链接/非普通文件、CRC/长度/重叠 header 错误；流式小块 inflate 核对实际输出，
  不信声明大小。history.zip 单独限 24MiB 压缩/64MiB 展开，并计入总预算。
- 导入在创建项目/写文件前校验 ZIP、manifest 尺寸/路径和嵌套历史。拖入先检查 File.size 再
  arrayBuffer，读取失败显示通知。画廊与文件预览均在明确确认代码/npm 执行风险后才导入。
  离开画廊后的异步导入/新建不再抢回导航；已写文件不会伪称可撤销。
- 文件树只在本地且开关开启时提供 `.vetd` 目录画布操作与分享文件预览。读取、导入、历史
  解包绑定原 owner session ref 与规范根，并在 await 后检查选中会话/工作目录；不能凭全局
  最长路径根重新选权限。watch/URL 在卸载或迟到完成时清理，预览文件从不送文本编辑器解码。
- 分享快照通过 `design.preview` 临时不可猜 token 回环 URL，独立响应 CSP：默认无资源、无
  connect/form/base，仅内联 script/style、data 图片字体和受限内嵌 frame；不改主窗口 CSP。
  外层与内部 srcdoc 都 sandbox allow-scripts、无 allow-same-origin/preload。双层是为了兼容
  旧快照只在 about: URL 使用 MemoryRouter；show-frame 只发送给确切子窗口，ready 时重发。
  每窗口最多 8 文档，每文档 32MiB，关闭/窗口销毁释放。没有外部网络或任意磁盘 URL。
- 导出同设计串行，成功失败都清理 `.vetd-build`，限文件/总大小；保存前用完整 importer
  重新校验精确产物，保证不会生成应用自己无法导入的包。批注、本机位图及中转历史不进源码包。
- 历史/样机 UI 已在 P2 画布内，P3 验证 runner、Dialog、PNG/PDF/saveAs 链路；恢复前遍历目标
  Git 树，仅接受普通 blob/tree，拒绝 symlink/submodule/保留目录。ZIP 无 symlink 不等于 Git
  对象内无 symlink。Main、runner 双重解包校验；runner 重建入口 `scripts/build-design-runner.mjs`。

P3 真机（隔离 CDP 9333）：画廊列项目和风格、跨项目卡片回到 root 会话；新建后预填设计技能、
隐藏/恢复保留原目录；96KB 双画框分享包导出/导入保留源码和 history，文件树只读预览实际渲染
两个不同页面。独立 CSP 探针证实脚本可运行、parent DOM 与网络均拒绝、electronAPI 为 undefined。
历史抽屉恢复后源码回到旧标题并新增 restoredFrom 提交，旧版本查看有只读横幅。
样机对话框实际编码产出 1968×1668 PNG 和单页 PDF（有效 header/EOF），标识为 EnsoCode。
原生保存面板已触发，但因多份同二进制 Electron 无法可靠通过 CUA 绑定，未点击用户其它实例；
产物验收使用临时 saveAs 适配落到隔离设计包，Main 原生选择/保存的取消与精确字节写入另有服务测试。
这不等同于已完成原生面板手动验收或签名安装包发布。
