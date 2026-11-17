# 2026-11-15 上游更新评估与选择性移植计划

## 基线与执行边界

- fork：`tingyuxuan123/EnsoCode`，起点 `40524c8e`（Collabra 0.2.82）。
- 上游：`J3n5en/EnsoCode`，本轮 fetch 后 `86693cfc`（0.3.8）。
- 共同祖先为 `efdd54eb`（0.2.9）；两边分别有 364 / 580 个独有提交，不能按版本号直接整仓合并。
- 用户粘贴的插件扩展条目重复一次，按三个独立能力处理：会话静音、`agent.run`、`ui.view.close`。
- 保留现有 Collabra 品牌、自有插件市场、金山浏览器桥、会话与工作区安全边界，不恢复上游服务器架构。
- 不覆盖已有 `android/` 未提交修改；不升级版本、不提交、不推送、不发布、不安装到正式应用。
- 本轮只做指定功能及直接相关可靠性修复，不做桌面重新设计。PWA 不新增界面入口，只同步静音元数据和通知语义；若后续增加 PWA 静音交互，仍须先确认设计稿。

## 必要性评估

| 更新 | 上游证据 | 对 fork 的价值与风险 | 本轮决定 |
| --- | --- | --- | --- |
| 会话静音 | `4b9f1c67` | 多会话/多代理使用下有直接价值。须在 Main 通知/推送入口拦截，不能靠隐藏 UI 或停止 agent；运行、未读、审批与提问继续存在。 | **加入**，用户明确指定 |
| 插件只读代理 `agent.run/cancel` | `c5eaae92` | 现有原生插件市场可以使用独立分析能力；不是新增普通子代理。涉及权限、代际、模型凭证、并发与取消，风险高于一般 UI 功能。 | **加入**，严格按 fork 权威会话与只读边界适配 |
| 插件 `ui.view.close` | `c5eaae92` | 补齐现有 open 对称操作，避免插件只能开不能关。只能关闭自己的声明页面，不得错误收起用户原先打开的侧栏。 | **加入** |
| Mermaid SVG/PNG 导出 | `b5619141` / #228 | 当前有本地 Mermaid 渲染、缩放和全屏，没有导出。收益明确、改动局限 Renderer，无需新增任意磁盘路径 IPC。 | **加入**，复用当前主题与渲染装饰 |
| Gemini 工具 schema `$ref` 兼容 | `fa01ec9b` / #229 | 当前 Antigravity 会丢 `$defs`/definitions，却未先展开 `$ref`，可能生成悬空引用而整请求 400。与已有子代理 schema 关键字修复不是同一问题。 | **加入**，本地引用展开后再归一化，补循环/缺失/转义测试 |
| spawn 真实拒绝被 STALE 覆盖 | `0578fa46` / #225 | 现有 spawn-rejected 能重试，但仍需保留同代真实失败，避免错误自愈掩盖配置问题。 | **加入** |
| 闲置回收/过期代次卡在「送达待确认」 | `f5fc793d` / #222 | 涉及 worker 命令队列、Main detached 状态及 Renderer 回显终态，属于实际可靠性修复，不应只改卡片文案。 | **加入**，按完整链路补回归 |
| subagent 漏传 operation | `2932a551` / #221 | 小范围参数兼容修复；只能在 description/prompt 均非空时推导 spawn，不能把任意坏输入变成代理创建。 | **加入**，保留 fork 的 coworker 默认值及完整 schema |
| 自定义 CA 证书 | `106a7629` / #224 | 企业代理/内网自签 CA 场景有价值，但不是通用聊天必需。设置变更会重启 worker；上游只检查文件可读、不校验证书内容，设置 IPC 也需按 fork 限制调用方，不能照搬。 | **暂缓**；出现实际证书链错误或明确企业代理需求再加；不得以关闭 TLS 校验代替 |
| 窗口任意位置拖放 | `6b3936e1` / #231，前置 `19a4ba95` | fork 尚无上游 ProjectDropOverlay；并非孤立几个按钮，会新增全局拖放接管，需确保不抢编辑器/输入框/设计画布的原生 drop。属于便利性增强。 | **暂缓**；另做交互与真实拖放验收后再移植 |
| Finder 投放浮窗 | `4bc6eb9c` / #233 | 上游自己标为默认关闭的 macOS 实验功能；需原生 ObjC/Koffi 调用、轮询拖放剪贴板、额外窗口/preload、隐私与多屏验证，依赖全局拖放链路。 | **暂缓**，不为可选便利功能引入常驻原生轮询 |

## 行为所属层与必改文件

### 插件能力

- `src/shared/extensionPlugins/{manifest,protocol}.ts`、`src/shared/types/agent.ts`：公开权限、模型配置与 worker 协议。
- `src/main/services/extensionPlugins/{agentRuns,gate,process,service,index}.ts`、`src/pluginHost/host.ts`：Main 权威校验、并发配额、生命周期和插件 API。
- `src/agent/{supervisor,codemode}.ts`、`src/main/services/{agentHost,agentSessionIndex}.ts`：独立只读运行及 fork 上下文，不写入父会话历史。
- `src/main/ipc/agent.ts`、`src/preload/index.ts`、`src/renderer/plugins/**`、`src/renderer/lib/sidePanelDock.ts`：typed 接线和本插件视图关闭。
- 插件配置渲染入口、作者声明与测试桩：跟随实际 API 同步，不让模板与宿主漂移。

### 会话静音

- `src/shared/sessionMute.ts`、sessions store/persist/sidebar 元数据：可持久的会话标识，而非暂停状态。
- `src/main/services/{sessionMuteGate,notifications,pushNotifier,pairHost}.ts`：落盘读值加即时覆盖，拦截主动打扰。
- 插件 `ui.notify`、Dock/PWA attention badge：遵守同一静音语义，不屏蔽会话事件或审批。
- `src/shared/types/ipc.ts`、Main agent handler、preload：新增静音通道必须完整三点式且校验 unknown。
- `packages/pair` / `packages/phone`：只同步可选字段和角标行为，保持旧客户端兼容，不做 PWA 视觉改版。

### 小范围导出与可靠性

- `MermaidRenderer.tsx`、`mermaidExport.ts`、`src/shared/i18n.ts`：复用渲染 SVG 导出，不重画图表。
- `src/shared/providers/antigravity.ts`：只改工具 schema 兼容；不泛化为所有 Gemini 供应商都存在同一问题。
- `supervisor.ts`、`agentSessionIndex.ts`、`agentDispatchService.ts`、`ipc/agent.ts`、sessions reducer/store/persist：分别修命令排队回收、已释放会话发送与真实拒绝保护。
- `src/agent/subagent.ts`：归一化发生在 schema 校验之前，不修改既有权限与代理选择契约。

## 执行顺序与验收

1. 先处理插件扩展；独立并行处理 Mermaid、Antigravity schema 和 subagent 参数，避免共享文件冲突。
2. 再接入会话静音及会话派送修复，核对多窗口、归档/删除、重启持久化及只读代理清理。
3. 可单测逻辑先添加回归，确认 RED，再写实现并确认 GREEN；不能以类型检查替代行为测试。
4. 最终执行 `pnpm typecheck && pnpm lint && pnpm test`；涉及手机共享数据另跑 phone typecheck/build。
5. 使用独立 userData/CDP 端口做 Electron 验证；模型工具链需要两个不同厂商真模型证据。若环境或凭证阻断，记录未验证部分，不把 fake provider/单测当真机成功。
6. 汇总每项实际完成情况与残余风险，未通过验收不宣称已经可发布。

## 执行结果（2026-11-16）

计划中标为「加入」的项目均已在当前工作树实现；CA 证书、全局拖放、Finder 浮窗仍暂缓，没有整仓合并上游。版本保持 0.2.82，未提交、推送、打包、发布或安装；原有 Android 修改及并行任务的远端完整模式计划均未覆盖。

### 适配中额外收紧的边界

- 插件权限与 typed 作者声明、starter、Main gate、worker 协议、preload、真实扩展配置表单全部同步；不是仅向旧 PluginsSettings 页加一个无效入口。
- `agent.run` 保留 Main exact generation，冷会话由 Main 唤醒后重新捕获身份，已有代次不可悄悄改投新代。父会话在资源初始化 await 期间被替换时，旧请求不能开始运行。
- AbortSignal 在启动 ACK 之前到达时立即结束插件 Promise，ACK 后再补取消，解决取消先到、run 尚未登记的竞态。
- 只读 fork 执行白名单与 codemode 嵌套调用双重约束；无人值守审批不建卡片。临时记录使用 inMemory，不写父会话/代理树/jsonl。
- 只读初始化不沿用真实项目/全局 package 设置，避免「noExtensions 已设但 loader 先 npm install」的隐蔽副作用；使用真实 SDK 正反对照测试约束。
- 会话静音 IPC 只接受本机主窗口顶层 frame、已知根会话和 boolean；子会话/BTW 沿权威 parent 链继承静音；即时覆盖在持久值追上后释放，不永久遮住新配置；Bot 异步通知在 await 后复查。
- Antigravity 引用展开除上游的深度限制外另加总引用预算，避免菱形引用指数膨胀；未照搬扩充上游响应体日志，保留 fork 的脱敏/截断口径。
- Mermaid PNG 真机复现了单测未覆盖的永久降级，修为根级 `htmlLabels:false`；PWA 共享渲染器不增加导出按钮，维持既有移动布局。

### 已取得的验证证据

- 最终 `pnpm typecheck && pnpm lint && pnpm test` 全部通过；**1,411 测试文件通过、2 文件跳过；14,637 tests passed / 15 skipped**。lint 保留既有 GitChangesView 冗余 Fragment 的 info，不影响退出码。
- `pnpm --filter @enso/phone typecheck` 与 `build` 通过，只有既有大 chunk 提示。
- 独立 Electron userData：`/private/tmp/collabra-upstream-port-profile`；CDP 仅 `127.0.0.1:9333`，未使用正式 profile 或 9222。验收后已停止实例并删除隔离 profile（含复制的测试凭证）与临时项目，只保留不含凭证的验收日志和导出产物。
- 真实模型：`auto/deepseek-v4.1-flash`（none 与 fork）、`auto/gpt-6.1-sol`（conversation）均自主调用 read 读取临时 README 的 proof token 并返回正确结果；每次父会话消息数和原文件内容均保持不变。后端修复后已重新启动实例并复测，不以旧进程结果充数。
- 公共插件 API 的 view.open/view.close 实际打开并关闭页面；静音实际出现图标，正文/status/unread/审批/ask 不变。
- 真实释放父会话后再发 agent.run，冷会话成功由发起窗口唤醒并完成 read proof；静音父会话的 child/BTW 仍下发审批/提问条目，但手机角标不计入它们（跨共享协议回归）。
- Mermaid 浅/深色实际组件按钮导出：SVG 可解码 587×70；PNG 可解码 1173×131，浅色 18,243 bytes、深色 17,470 bytes。验证实际 MIME/像素，而非仅有下载动作。
- 安全复审发现的提前取消、冷唤醒和只读初始化包安装三个 P2 均修复并复核关闭，未遗留已确认的阻断问题。

### 尚未宣称的验收范围

没有用真实 Gemini/Antigravity 账号向 Google 后端验证 `$ref` 修复；该项有协议转换、循环/缺失/转义引用与资源预算回归，不能把 DeepSeek/GPT 调用视为 Google 后端证据。未做 Windows 真机系统通知、真实手机 Web Push、macOS 原生通知点击/声音的逐设备验收；这些出口有回归测试。未迁移 Android 原生静音 UI。

可复跑入口：`scripts/verify-plugin-agent-run.mjs`、`scripts/verify-mermaid-export.mjs` 与 `test/fixtures/plugin-agent-run/`。真实模型脚本必须显式设置 `ENSO_VERIFY_REAL_MODELS=1`，防止无意消耗额度。
