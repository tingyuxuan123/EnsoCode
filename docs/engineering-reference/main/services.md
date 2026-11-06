# services 层规范

`src/main/services/` 放不依赖 `ipcMain` 的业务逻辑。三类典型：**扫描外部应用配置**、
**对外发起网络请求**、**agent worker 的生命周期托管**（`agentHost.ts`）。

配对 Web 的 HTML / React / Vue 预览采用电脑侧隔离渲染，不在配对 origin 执行网页代码；
传输、授权、Vite 兼容和真机回归契约见 [网页预览](pair-preview.md)。

内置设计的根授权、单画布归属、分享包/历史校验与独立 CSP 预览见
[设计子系统](../guides/design-subsystem.md)。

## Bot 宿主的投递边界

本地群任务托管的根群授权、编号直通、回执记账、提醒去重和受控恢复契约见
[本地群任务托管](../guides/task-supervision.md)。托管不等于自动重放命令，也不替代审批。

- `status: idle` 不是回合终态：worker 还会发送 session-meta、turn-completed。Bot 槽位、结果归属与队列只在终态结算；但中断、命令失败等路径只有 idle/failed，宿主在宽限期后兜底结算并 pump，无宿主轮次的会话回到 idle 时也要 pump，否则排队投递与并发槽永久挂起。
- deliveryId 是「某会话的一次投递」的身份，按会话去重：群聊一轮里人类/例行/委派结果的 deliveryId 只给首个投递，接力一律新生成；命中去重（`duplicate`）对群当前成员按失败写 system 条目并推进，不能当作已发出。
- 委派结果使用稳定 delegationId，worker 开始处理后确认；重启通过 jsonl 用户消息去重，不以“已入队”当作已投递。
- Bot 插话的 IPC 发送成功不等于消费成功：宿主等 `delivery-settled` 才推进群游标；`delivery-deferred` 沿用原投递顺序重新准入。相同会话的旧排队/准备中/未确认插话不能被新插话越过，但其它会话的排队任务不能阻塞当前活轮补充。停止、会话终止和 worker 退出必须显式结算未确认插话。
- 委派按目标成员自身的工具、skill、MCP 执行，审批档取双方更严并持久化，嵌套/恢复沿用该审批档；readonly 父会话的子代理仍继承 workspace_write 禁用。
- Bot 停用先冻结投递，再取消委派和排队项、清路由、退订并停止调度；排队取消按 deliveryId 结算，不能清掉同会话另一项的审批计时器。

## agentHost：worker 生命周期与命令下发

`agentHost.ts` 托管唯一的 agent worker（`utilityProcess.fork(out/main/agent.js)`，
故障域 A：一个进程装全部活会话）。关键约束：

- **apiKey 到 Main 为止**：Renderer 发 `AgentSpawnRequest` 只带 `providerId`，
  `spawnSession` 从 settings 补全 apiKey 组装 `SpawnModelConfig` 下发 worker；
  worker 回来的事件经 `parseAgentWorkerEvent` 收窄，类型上不给 auth 位置。
- worker `exit` 时向 Renderer 广播 `worker-exited`（全部会话视为 failed），
  **不自动重启**——重启牵出 jsonl 恢复，是独立一刀。
- pi 的全局目录与会话目录经 `ENSO_AGENT_DATA_DIR` 指到 `userData/agent/`，
  不碰用户的 `~/.pi`。
- **代理要在 worker 里单独装 dispatcher**：Node `fetch` 不读 `HTTP_PROXY` env，光把 env
  传进 fork 没用。两条腿缺一不可：worker 入口先 `bootstrapWorkerProxyFromEnv()` 按继承 env
  自举；main 在 `spawn` 后按 `process.env` 补发一次 `set-proxy-env`（fork 前 `ProxyConfig`
  下发的命令因 worker 不存在被丢，worker 重启同理）。`sendAgentCommand` 不检查 `workerReady`，
  凡是「worker 必须知道的状态」都应在 `spawn` 回调里重推，而不是只在状态变化时下发。

worker 侧的 `SessionSupervisor` 在 `src/agent/`（与 main/renderer/shared 平级，
只准 import `@shared` 与 pi sdk），协议类型在 `src/shared/types/agent.ts`。

⚠️ 「只准 import `@shared`」这条约束的一个后果：订阅 provider 的注册在主进程与 worker
两侧各要做一遍（worker 不注册，选到该 provider 的模型推理起不来），于是这类
**主进程 + worker 共用、渲染层碰不到**的运行时代码只能放 `src/shared/providers/`——
那是 shared 层「不碰 `node:*`」的唯一例外，理由与守卫见
[../shared/index.md](../shared/index.md)。

## 模型流与后台通知的边界

- `streamGuard.ts` 包装共享 runtime 的公开流出口，不接管 session 重试或结算。
  任意事件刷新空闲时钟；90 秒只记日志，默认 300 秒无事件产生可重试超时。
  localhost 可能是云端网关，不能据地址自动放宽；900 秒只供权威本地推理调用方显式注入。
  用户取消始终为 aborted，长段正文/思考的完全周期复读为不可重试错误；不检测工具参数。
  正常终态、取消、超时都必须只结算一次，清 timer/listener，迟到数据不得改变已返回快照。
- 后台完成通知带有界输出尾部，不代表新的用户请求。命令和输出进入通知包络前须转义；
  `ensoCompact/extract.ts` 不从自动通知提取用户目标、约束、路径或授权，摘要模板也必须
  保留来源区别，不能把工具输出中的指令升级为用户决定。
- 本地 Shell 工具在启动子进程时统一覆盖非交互设置并清空 `BASH_ENV` / `ENV`，包括可能再启动 Bash
  的 PowerShell；不改 worker 全局环境，保留 PATH、代理、非交互凭据及自定义 Git SSH 命令。
  前台通过 Pi 的 `spawnHook` 保留 SDK 注入的会话环境，显式后台走同一覆盖函数；远端 SSH 的
  operations 和本地传输包装命令不套用这层设置，以免破坏 SSH 认证。回归见 `sessionShell.test.ts`
  和 `backgroundTasks.test.ts`。
- `dismiss-child` 与同一 child 的创建命令共用串行门；创建失败或已换代时清理幂等，
  清理异常不得把父会话标成 failed。旧形状 `resume-coworker` 的恢复异常同样只记日志，
  不得因按 parent 排队而把失败归给父会话，也不得伪报恢复成功。仍须验证 exact 父代和完整 child 身份。
- 未投递通知在去抖前写入 `sessions/pending-notifications/`，JSON 大小、条数和文本均有上限，
  不跟随通知目录/文件链接，原子替换。新通知仅在 SDK preflight 接受后确认；恢复的旧通知
  单独保存，只搭下一次真实工具结果，不在打开会话或轮次收口时自动唤醒模型，不承诺恢复进程。
  删除会话时 Main 清盘并发送 `forget-notifications`，防止旧任务迟到重新创建孤儿文件。

## 临时会话与工具热切换

- scratch 是仅 Main 可创建的隐藏项目载体；每个根会话 cwd 固定为 `userData/scratch/<UUID>`。
  共用无 Node 依赖的 `conversationCwd` 词法规则，Main 再验证 exact realpath 与符号链接边界；
  文件树、浏览器、子代理和 workflow 不得退回共享 scratch 根或旁边会话目录。
  临时历史保留到显式删除，不参加自动删除；不把 scratch 作为 Bot/手机普通项目或项目级权限覆盖。
- 可热切内置工具在启动时注册，由 Main 按 generation 推有效全局/项目/固定禁用列表，
  worker 只在 SDK 真正 idle 时激活；正在跑的回合只缓存最新配置，不中止工具与既有 child。
  sandbox/write/goal 保持 spawn 固定，个人版 code_search 仍须通过本机账号配置门。
  关闭 plan 必须带一次 OFF 提示，缓存引用和 codemode 也不能绕过禁用。
- `builtin:designer` 在本地且父会话启用 `design` 时登记 `vetd_*`：child-ready 证明列出全部
  已登记定义，可见集合另由 cwd 的 `DesignPresence` 决定。规划和审批在 worker，Main 用根会话的
  权威 cwd 与画布路由，结果回原 child generation；历史 hook 仅由父会话触发。

## 内置记忆的相关度、取消与失败恢复

- 混排 score 仅用于排序，对外返回 rank 与可选向量余弦 relevance；FTS 命中不填伪相关度，
  旧历史 score 不能继续当百分比展示。显式匹配年份加分最多 0.1，不降低语义权重。
- 向量距离相同时按记忆 rowid（插入序）排，不用随机 UUID 决胜，也不改原始相关度。
- deep 辅助使用有界超时和真实 AbortSignal，远端完整链路传到 worker，本地传到 llama；
  不只丢弃 Promise 结果。降级原因与是否使用模型辅助必须可观察；检索次数沿用 appearances。
- KG 重试复用 failed 列、幂等重置，关闭时不启动抽取。冷库管理操作使用临时句柄并关闭，
  不提前占用宿主全局 db，否则正常开库的蒸馏/向量/KG 恢复钩子会被跳过。
- KG Level 1 输出预算为 4096 tokens；仅输出不可解析时在同一次任务尝试内提示只输出 JSON，
  最多补一次。供应商报错直接交给任务层，不额外请求，也不额外累计任务尝试次数。

回归：`streamGuard.test.ts`、`streamGuard.sdk.test.ts`、`backgroundTasks.test.ts`、
`ensoCompact/extract.test.ts`、`supervisor.agentDispatch.test.ts`、`pendingNotifications.test.ts`、
`builtinLoadout.sdk.test.ts`、`scratchWorkspace.test.ts`、`memoryHost.retry.test.ts`。


## 桌面后台输入、原生插件与托管代审

**macOS 后台桌面输入**（`services/computer/`）
- 目标应用身份是 canonical 路径 + bundle id，不是名称或 pid；每个动作执行前重新解析窗口并按
  exact pid/bundle/path 复核，租约按 app 串行、不同 app 并行。
- 后台路线禁止回退 `hid` 全局事件或前台接管；解析不到窗口、授权被撤销、pid 失效都 fail-closed。
  用户明确要求前台投递时才允许前台路径。
- 应用授权（一次 / 本次会话 / 永远）由 Main 独立询问，与工具审批无关；受保护底线与 assistant
  代审都不能替代它。画中画只显示被操作窗口，点击指针画进画中画，不覆盖用户正在用的应用；
  一轮结束后延时收起，用户关闭过的窗口本轮不再弹。
- 内置 `computer` 对实际呈现的 AX 引用记录 role/title/description；动作在原授权与 guard 后复核，
  身份变化则拒绝并要求重新 `ax()/find()`。diff 省略的行和旧 ref 解析不能悄悄更新身份，
  AXPress 失败转坐标前仍需核对；value/focus/selection、合成行标题不作身份。
  这不是原子核验与投递，字段完全相同的元素复用仍有盲区；外部 LCU 扩展不受此实现保护。
  回归：`computer/guest.test.ts`、`computer/backgroundSafety.test.ts`、`shared/computer/axTree.test.ts`。

**原生插件**（`services/extensionPlugins/`、`pluginHost/`、`renderer/plugins/`、[plugins.md](../../plugins.md)）
- 安装只复制到 `userData/extension-plugins`，不引用源目录；zip/URL 下载校验公网地址、重定向、
  解压边界与符号链接。安装/更新**不执行插件代码**，停用与待批准版本从不运行。
- `main.mjs` 是完整 Node 子进程，`ui.js` 与主界面同权：这是信任边界，不是 OS 沙箱；界面必须明说，
  不能用清单权限暗示隔离。侧栏 HTML 才是 opaque-origin sandbox iframe。
- 插件工具经 worker → Main → 插件进程往返，沿用 `withPlanGate` 与 `withApproval`；规划期默认拒绝
  所有 `plugin_*` 工具。工具名带插件 id，会话许可不能跨插件或跨版本借用（fingerprint 不匹配即拒）。
- 插件调宿主 MCP 必须带 exact session generation，Main 侧再查 live 会话与 Plan 状态，worker 侧用
  真实 MCP 工具名过审批；安装授权不等于逐次授权。
- 管理通道只接受主界面/设置窗口的 top frame 且 URL 精确匹配本地入口；安装 token 绑定发起窗口。

**分类器代审与托管**（`agent/approvalReview.ts`、`shared/approvalReviewRecord.ts`）
- 普通聊天模型代审仍是 JSON 契约；分类器（Jev 等）走 allow/ask/block 概率，缺字段、非有限值、
  分布矛盾一律退回人工，不把缺项当 0 放行。
- 托管默认关闭、只存本机（configSync 排除）。只有置信度达到阈值才放行；未达标只拒绝当前这一条
  并把理由交回模型；判定失败/超时退人工。受保护动作、桌面应用授权、插件安装永远不由托管决定。
- 每组判定写入工具结果的可投影记录（allow/deny/fallback + actionHash），按 pi session + toolCallId
  作用域绑定，迟到结果不能串到别的请求。

回归：`computerHost.test.ts`、`computer/*.test.ts`、`extensionPlugins/*.test.ts`、
`pluginHost/*.test.ts`、`renderer/plugins/*.test.ts`、`agent/pluginMcpGateway.test.ts`、
`agent/approvalManaged.test.ts`、`agent/approvalReviewSupervisor.test.ts`。

## ChatGPT 顺序账号池的额度权威

`oauthProviders.getOauthQuotaCoordinator()` 持有 Main 唯一额度缓存，UI 的
`getOauthAccountUsage` 和 `agentHost.selectOauthPoolAccount` 共用它。配置顺序决定首个账号，
切换后一直使用当前账号，旧账号恢复不会抢回游标。只查询需要确认的候选账号：正常数据
缓存 60 秒，未知或失败缓存 15 秒，同账号并发查询合并；未知账号先让位于已确认可用账号，
全部未知才有限降级，并在 Main 日志保留警告、UI 查询保留 error。

- 一次选号的额度查询共用 20 秒单调时钟等待预算，单次挂起也必须 bounded race；
  预算到时不启动剩余网络请求，仍扫描本地健康/封锁证据，只有没有已确认健康候选且存在
  unknown 时才带 warning 有限降级。超时本身不作为耗尽证据，不取消 UI/其它池共享查询；
  后台迟到结果仍可缓存，但必须通过原有身份、查询代际及 reset 后发起校验，迟到拒绝被处理。
- 有效窗口任一 100% 即跳过，不向 worker 下发该账号试发模型请求。最早耗尽窗口 reset
  到期后重新查证；查询失败保留其它未过期耗尽窗口，过期证据不永久封锁。
- 完整有效窗口均非耗尽才是健康证据；空窗口、坏窗口和网络错误不能解封仍有效的证据。
  模型返回的结构化硬失败截止时间独立保留，晚到的健康查询也不能清除它。
  身份或查询代际过期的结果向 UI 返回空窗口和 error；恢复查询必须在 reset 后发起，
  reset 前发起、reset 后才完成的结果不算恢复证据。
- `/wham/usage` 的全局 `allowed: false` / `limit_reached: true` 是额度证据，恢复时间只取
  真正耗尽窗口；没有明确 reset 时短暂封锁并复查。额外 credits 和未匹配目标模型的窗口
  不推导为全账号不可用，普通 429 也不作为永久耗尽证据。
- `userData/oauth-quota-state.json` 只保存 key、身份 SHA-256 摘要、耗尽窗口和有限硬失败截止
  时间；不进 settings/config sync，不保存 token、email 或展示标签。读入校验版本、文件大小、
  key、身份摘要、有限时间和窗口数量，坏文件降级为重新查询；写入采用同步临时文件+rename，
  防止并发旧快照覆盖新状态。
- 身份由本地凭证账号 ID/用户 ID 派生，不透明凭证保守按凭证摘要失效。login/logout、
  就地 Codex 导入和真实凭证删除均清除旧记录，即使缓存尚未初始化也必须清磁盘 sidecar，
  因为删除最高账号号次后 `nextAccountKey` 可能复用同 key。额度网络等待结束后，host 再次
  校验成员启用状态、模型和登录态，变更中的陈旧选号拒绝下发。
- 每次真实请求的选号带不透明 UUID receipt，worker 在 fetch/SSE/refresh 失败中回传
  当次票；恢复 boundary 的候选票不替代真实请求票。Main 在内存绑定池、key、身份摘要和
  凭证代际，仅有效绑定的失败可以更新硬封锁，旧身份的迟到失败不得封锁复用 key 的新身份。
  票不落盘、不发给 Renderer，24 小时 TTL、最多 4096 条；硬失败只更新查询代际，不撤销
  同身份其它并发模型请求的票，凭证失效才提升凭证代际。
- 全池耗尽返回最早可能恢复的额度复查时间（各账号耗尽窗口最大 reset 的最小值），
  该时间不代表自动确认恢复。

回归：`oauthQuotaCoordinator.test.ts`、`agentHost.oauthPool.test.ts`、
`oauthProviders.test.ts`。测试使用依赖注入、临时目录和假网络，不读取真实用户凭据。

## MCP 工具补入以 SDK 空闲状态为准

常驻 MCP 授权/预热后，只向 spawn 时已选择该服务器的会话补入工具；活轮中先排队，
在 SDK 空闲后更新工具表。空闲判定以 `session.isIdle` 为准：`agent_settled` 回调中
SDK 已空闲，但 supervisor 的 `managed.status` 仍可能是 `running`，不能用滞后投影
挡住补入。否则父会话的 `promptFresh` 尚能兜底，直接走 `prompt-child` 的下一次 Run
却一直看不到新工具。回归：`supervisor.agentDispatch.test.ts` 的子代理 MCP 活轮补入用例。

## 能力授权以 child generation 为单位

`capabilityGateway` 的 invocation 上下文按 `generationKey(child)` 建键，
**不得把 `turnId` 叠进授权键**。理由：

- `registerCapabilityInvocation` 一次派发只调一次，代码里**没有任何“每轮重新授权”的路径**；
- worker 在 `agent_end` 会清空 `currentTurnId`，下一轮 `agent_start` 取新的随机 uuid；
- 于是 child 的活儿一旦跨了内部 agent turn，能力调用就被判 not bound，
  表现为**同一条指令时成时败**。

内部 agent turn 是模型循环产物，没有产品语义，不能当权限边界。真正的门是：

- `sameChild` 的 exact generation 比对（旧 / 伪造 generation 一律拒）
- `terminateGeneration` 的级联撤销

**撤销边界只能是 child 生命周期，不能是回合结束。** `trySettle` 只收口「本次派发
任务」（发完成通知、清 active），**不得调 `terminateGeneration`**：child 会话在派发轮
结束后仍活着并继续接后续轮次，提前撤销会让第二轮起的 `enso_app` 全部返回
`not bound`（现象：第一轮添加成功、后面删除全被拒）。合法撤销点只有
`child-ended` / `child-rejected` / `worker-exited` / `releaseWindow`。

receipt 事件同理：发的是**绑定上下文的 `context.turnId`**（= 派发轮次），
不是 child 内部每轮的 uuid，否则跨 turn 的 receipt 在协调器侧关联不上。

## child 恢复由 Main 级联，双形状过渡命令有到期日

重启后 coworker/child 的恢复入口在 `agentDispatchService.restoreChildren`（parent-ready
触发，幂等键是 parent generation），渲染层零参与：sessionFile/类型/名字全部由
`persistedConversation()` 自读。两条铁律：

- **resume 类操作的防撞检查必须排除自身的持久化条目**。`usedNames` 扫盘防跨
  重启撞名，而被恢复者自己的名字必然在盘上——直接复用会自撞，恢复永远失败。
  写这类单测时夹具的 `readSettings` 必须带上被恢复者自己的持久化条目（真机
  形状），否则抓不到这类 bug（见 0e8fc11）。
- **`resume-coworker` / `dismiss-coworker` 是双形状过渡命令**：工具直雇 coworker
  （普通 SessionIdentity，不进 Main sessions 索引）的遥控通路。coworker 工具统一
  到 Main dispatch（typed child）后这两条命令应随之删除，不要在其上叠新功能。

## 对 pi 私有 API 的依赖要登记

目前有三处。第一处：`src/agent/supervisor.ts` 的 `materializeSessionFile()` 调用
`SessionManager._rewriteFile()`，并在成功重写后同步其私有 `flushed` 标记。

**为什么需要**：pi 的 `_persist` 在会话出现第一条 assistant 消息前一个字节不写
（避免留空会话文件），而纯派发的父容器按设计永远不跑主 coding 回合、永远没有
assistant 消息。不干预的后果是父会话文件从未创建，重启后 `resumeConversation`
报「会话文件已丢失」，**连带该会话下所有 child 的历史都打不开**。

**升级 pi 时必须复检这一处**。回归测试（`src/agent/sessionPersistence.test.ts`）故意包含
一条**上游行为基线断言**——“pi 当前在没有 assistant 消息时不落盘”；上游改了这个
启发式，该断言会先飘红提醒复检适配层是否还需要。

Pi 0.87.1 的 `_rewriteFile()` 不设置 `flushed`；不显式同步时，首条 assistant
会以 `wx` 创建已有文件并抛出 `EEXIST`。回归还须覆盖物化后追加首条 assistant、
重开 JSONL 后消息仍存在。只有重写成功后才能设置该标记。

第二处：`src/agent/sessionAdapter.ts` 的 `continueSessionActivity()` 在 pi 1.4.0
通过每次调用独立的 Proxy 调用私有 `_startRun`，以 custom trigger 准备规则并移除合成消息。
1.4 删除了旧 `_runAgentPrompt([])`；公开 API 仍没有不新增消息的 session 级 continue，裸
`agent.continue()` 绕过自动重试、`agent_before_settle` 与 `agent_settled`，手工补发
settled 无法恢复 OAuth 池的结算前接替。不能直接跳过 `_prepareRun`：SDK 已在上轮结算时清空
run options，跳过后会丢失强制 persona，并在工具后持久撤回扩展段落。
续跑会发出 `before_agent_start{messageType:'custom'}` 重建扩展规则，但不触发仅属于 user 的
UserPromptSubmit/分支 note、不追加合成 user/custom 任务；真实扩展返回的上下文和 system
更新仍交给 SDK。准备阶段用第二层独立代理隔离 nextTurn 的读写，异步 hook 中新排队的消息
也留给下一个真实 prompt，不消费、不替换共享数组或 session 方法。
原任务及已完成工具结果不重放。显式用户 retry 才复位池的 per-activity `attempted`，自动接替不复位；
池会话与通知路由在 `agent_start` 初始化，因此恢复后直接 retry 也能获得结构化失败证据。
入口要求 `session.isIdle` 且不在 `_isEmittingAgentSettled` 回调中：SDK 在异步 settled hook
期间已置 idle，直接启动会造成嵌套结算。压缩、branch summary 或其它活动中不允许续跑；保留原
`agent.continue()` 的上下文边界：空、仅 system 或 assistant 尾部都拒绝，不发起请求。

**升级 pi 必须复检第二处**：优先查找公开无消息继续 API；确认 `_startRun` 仍通过
`this._prepareRun` 准备消息、custom trigger 消息按引用进入结果（从结果剔除）、空消息续跑
仍被接受，并保留完整 post-run / before-settle / settled 生命周期。
两个私有方法缺失时必须在启动前拒绝，不留下 busy 状态。
真实 SDK 回归还验证强制 persona/扩展段落在工具前后保留、临时错误自动重试、abort 后只结算
一次，以及后续正常 prompt 消费 nextTurn，避免代理泄漏；不将方法 bind 回真实对象，否则会
绕过拦截并创建伪任务。
当前 SDK 的 before-settle 位于低层 loop 结束后，`ctx.signal` 可能为空；取消由
`session.abort()` 的活动标志和 before-settle 取消守卫阻止延迟选号后的续跑，不能自行
补发结算或假定低层 `agent.signal` 覆盖整个活动。回归见 `oauthAccountPool.test.ts`
（真实 SDK + supervisor retry 分支 + 假 provider：四账号顺序、活动排除复位、工具只一次、
选号等待时取消与唯一结算）、`sessionAdapter.test.ts` 和 `supervisor.silentTurn.test.ts`。

第三处：`sessionAdapter.steerActiveSession()` 针对 Bot 插话，以每次调用独立的代理拦截
pi `_queueSteer`（1.4.0 已复检），在异步 input hook 后、同步入队前再次检查活轮，仍沿用原生
steer 的扩展命令拒绝与模板展开语义。不使用 `prompt(..., streamingBehavior:'steer')`
在 `started` 回调抛错：那时已经可能做过压缩并清空 nextTurn 消息。
已入队但到 `agent_settled` 仍未消费的消息（如 abort）按对象引用从
`agent.steeringQueue.messages` 移除，并同步 `_steeringMessages` / `_emitQueueUpdate`，
再回报 deferred；不能 `clearQueue()`，否则普通 steer、扩展 custom 消息和 followUp 也被清掉。
队列 drain 会替换 messages 数组，不能缓存旧数组引用。

**升级 pi 必须复检第三处**：优先采用公开的活轮限定投递/单条撤销 API；确认私有入队方法
仍同步追加消息，队列对象和文本索引形状未变。`sessionAdapter.test.ts` 使用真实 SDK 验证
异步 hook 跨结束、边界成功消费一次、abort 后仅移除目标且保留普通/扩展插话；
`supervisor.agentDispatch.test.ts` 和 Bot 宿主/群联测验证消费回执与重新准入。

新增此类依赖前先找公开 API；确实没有时，三件事缺一不可：

1. 封成带注释的适配函数（说清为什么需要、上游行为是什么）
2. 回归测试断言**可观测结果**（文件落盘）而不是“调用了某私有方法”
3. 在本节登记

预设仅替换开头角色段落，不替换整份系统提示词。在 `before_agent_start` 用
`replacePersonaParagraph` 匹配开头默认段落，`Available tools` 及之后的内容原样保留；
不使用 loader 的 `systemPrompt` / `systemPromptOverride`，避免绕过 pi 默认工具准则生成。
设置页默认预览也只展示 `DEFAULT_PERSONA_PROMPT`；升级 pi 时复检默认段落，匹配失败时
保留原文并追加角色描述。回归见 `systemPrompt.test.ts`、`supervisor.agentDispatch.test.ts`。
正文以 UUID 文件保存，Renderer 仅修改预设引用，Main
在设置原子落盘成功后才清理取消引用的文件，不能在 debounce 期间先删正文；回归见
`settingsPresetPrompts.test.ts`。配置导入为正文分配新 UUID，不覆盖本机同 ID 正文；旧导入
正文保留给设置备份恢复使用。

## 委派前展示能力，缺口不靠猜测补齐

`agentTypeCapabilities.ts` 从 `childProfileToolIds` 和父会话工具档生成 subagent/workflow
类型说明：readonly 无 shell，父会话禁写也不能显示 shell/编辑工具；writeScope 只描述
确实存在的文件编辑能力。它不序列化模型凭证、MCP env 或启动参数，也不授予新权限。
需要 Git diff/测试等命令时，由有权的主代理采集有界证据后交给只读子代理，不能要求它
越权执行或改读其他仓库来猜结论。子代理合同要求缺能力早报，区分已核验事实、推断和未核验项。

subagent 保持跨厂商兼容的平面 schema；`prepareArguments` 在 schema 校验前完成已声明
可选字段的空占位归一、model:thinking 拆分、schema JSON 解析和操作字段预检，产物须满足
自身 schema 且幂等。非空串用字段在 Main RPC 前拒绝，不静默选择模型。
wait 只返回 Run 状态；取正文必须用 `operation=report` + runId，task Agent 已 closed 仍可读取。
回归：`subagent.control.test.ts`、`agentTypeCapabilities.test.ts`、`subagent.test.ts`。

## 工具目录只辅助发现，不裁剪权威说明

`promptCatalog.ts` 在 `before_agent_start` 为已激活、已注册且没有 prompt snippet 的工具
补充有界的 `tool_catalog` 段。每轮从 SDK 当前工具表重算，空目录删除旧段；来源和名称排序稳定。
它不改 schema、工具使用准则、子代理模型选型说明或完整 skills 描述；代码导航仍遵循
已知路径用 read、已知符号用 grep、未知行为用 code_search。扩展应先于最终 persona 替换运行。
回归：`promptCatalog.test.ts` 与真实 SDK 链路 `promptCatalog.session.test.ts`。

## 扫描器的三件套结构

`providerScan/` 和 `assetScan/` 都是同一套形状，新增扫描来源时照此扩展：

| 文件 | 职责 |
|------|------|
| `locations.ts` / 编排文件里的 `sourceSpec()` | 「去哪找」：各应用配置路径，含平台差异与自定义数据目录 |
| `readers.ts` / `skills.ts`、`mcp.ts`… | 「怎么读」：每种格式一个纯函数，返回归一化结构 |
| `index.ts` | 编排：遍历来源、去重标记、缓存明文、对外暴露 scan / collect |

读取器必须是**纯函数**：入参是路径，出参是归一化数组，不打印、不抛给上层。
格式解析失败就返回空数组（见 `assetScan/skills.ts` 的 `readFrontmatter`）。

单个来源出错不能让整体扫描失败 —— 编排层逐来源 try/catch，把状态记进报告：

```ts
try {
  // 读取该来源
  report.status = 'found';
} catch (error) {
  console.warn(`[AssetScan] Failed reading ${sourceId}:`, error);
  report.status = 'read-error';
}
```

## 敏感数据不出主进程

明文 API Key、MCP 的 env 值只保留在主进程的一次性缓存里：

```ts
// 仅保留最近一次扫描，供确认导入时取回完整数据（含 env 明文）
let lastScan: { scanId: string; byId: Map<string, Cached> } | null = null;
```

流程是两段式：

1. `scan()` 返回**脱敏候选**（`apiKeyMasked`、`envKeys` 只有键名）+ 一个 `scanId`
2. 用户确认后 `collect(scanId, ids)` 才从缓存里取出完整数据返回

`scanId` 不匹配就返回空数组，防止用过期的 id 捞数据。新增扫描类型时保持这个切分。

## 去重按各自的身份定义

不同资产的「同一个」含义不同，用错就会漏判或误判。当前的定义：

| 资产 | 指纹 | 为什么 |
|------|------|--------|
| 模型服务 | `baseUrl + apiKey` | 同一个端点同一把钥匙就是同一个服务 |
| 技能 | **名称**（小写） | 技能以名称调用，同名无法共存；同一技能常被多个工具各装一份到不同路径 |
| MCP 服务器 | 启动命令 + 参数，或 URL | 名字各家不同（`cunzhi` / `寸止`），命令才是身份 |
| 指令文件 | **内容 SHA-256** | 文件名相同内容各异（多家的 `AGENTS.md`），内容相同文件名各异（`CLAUDE.md` 与 `AGENTS.md` 常是同一份） |

实现在 `assetScan/index.ts` 的 `skillNameKey` / `mcpKey` / `seenInstructionHashes`。

重复项**标记而不丢弃**：候选带 `duplicated` 和 `duplicateReason`
（`registered` / `same-content` / `same-name`），界面上置灰且默认不勾选，
用户仍可手动选。三层都要拦：扫描标记、collect 批内去重、store 落库前再判一次。

## Claude Code 插件

插件不拆成技能 / MCP 条目入库。设置里只存 `PluginEntry`（`name@marketplace` key + 开关），
Main 在每次 spawn 时按 key 从 `~/.claude/plugins/installed_plugins.json` 找当前安装目录并现读组件
（`claudePlugins.ts`），所以 Claude Code 升级插件后路径变化无需同步。插件跟随自己的开关，不受预设影响。

| 组件 | 去向 |
|------|------|
| skills | 追加进 `skillPaths` |
| commands | `pluginCommands` → worker `promptsOverride`，命名 `/插件:命令` |
| agents | `withPluginAgentTypes()` 以名字派生的 UUID 并入自定义子代理类型（registry、dispatch、spawn 同一口径） |
| `.mcp.json` | 并入 `mcpServers`，与已启用的同名 MCP 冲突时让位；需要 OAuth 的暂不支持 |
| hooks | `pluginHooks` → `claudeHooks.ts` 内联扩展；远程会话不下发 |

Enso 不调 pi 的 `bindExtensions`，pi 不发 `session_start`/`session_shutdown`：SessionStart 在首轮
`before_agent_start` 补跑，SessionEnd 由 supervisor 释放父会话时自行 emit。插件在配置同步中排除。

## Pi 扩展的人机选择与授权

设置 → 内置工具中的「LCU 电脑控制」由本机 `lcuEnabled` 独立控制，缺省开启只保留已安装扩展的既有加载，
不安装 LCU，也不影响内置 `computer`。改动在新建或冷恢复会话时读取，不热卸载运行中扩展；
已打开的会话需要释放后重新打开（或重启应用）。该设备策略不随配置同步导入/导出，也不开放给模型修改。
关闭时，`lcuExtension.ts` 先通过 SDK 公开包解析器发现资源，在执行扩展前按安装入口的文件身份排除 LCU，
再关闭磁盘扩展自动发现并显式传入其余入口；相对路径、目录包、file URL 与符号链接均由 SDK 统一解析。
不能用加载后的 `extensionsOverride` 或按 `js` 名称隐藏替代，否则扩展副作用已执行或误伤同名第三方工具。
不修改 Pi settings 或 LCU 安装文件；升级 SDK 时复检 `noExtensions` 与显式入口的加载顺序。
回归：`projectCode.test.ts`、`supervisor.agentDispatch.test.ts`、`lcuEnabled.test.ts`。

`extensionUI.ts` 在会话注册后通过公开 `extensionRunner.setUIContext` 接入 `select` / `confirm`，
以 `rpc` 模式复用 `AskManager` → `ask-request` → AskBar → `ask-respond`。不要为接一个选择框调用
`bindExtensions`：它还会触发 `session_start` 和资源发现，改变以上既有生命周期。

- 扩展选择带 `selectionOnly: true`，隐藏自由输入；只返回扩展提供的精确原始标签，不 trim、不截到四项。
- 空字符串仅对严格选择表示取消；普通 `ask_user` 忽略空白答复。非原始选项、超时、中断和失效代际均返回
  `undefined`（确认返回 `false`）。普通选择不设默认许可、不替扩展记住许可，也不把会话许可提升成永久许可。
- `full` 对已安装 LCU 的原生应用许可自动返回 **Allow once**，不写 session/always 白名单；降档后下次许可恢复询问。
  必须同时匹配 canonical 扩展文件身份、`js` / `js_reset` 的 LCU 标签、实际会话执行的同一工具定义，以及完整原生许可形状。
  不按同名工具或标题单独放行；网页、录音、普通 `select` / `confirm` / `ask_user` 均不在自动范围内。
  受保护动作底线仍优先，系统辅助功能/屏幕录制许可不由此授予。
- 工具执行前（包括 codemode 嵌套调用）通过公开注册定义为可信 LCU 注入该次执行的 UI 代理；不使用全局当前工具名或
  AsyncLocalStorage（MCP stdio 回包不处于原工具异步上下文）。LCU 并行调用共享一批活调用生命期，避免较后调用结束使
  较早调用的许可误取消；最后一个调用结束/取消后整批代理失效，旧批次不能借用下一批的授权。失效代际始终拒绝。
  切到 `full` 只收口可信待选请求；已提交的人工拒绝、取消或超时不被覆盖，尚未交付的自动允许在降档后失效。
- 请求绑定具体 managed session / AskManager；发送失败立即收尾。所有结束路径只发一次 resolved，清计时器与
  abort 监听；旧会话不得创建悬空卡片或采用迟到许可。已配对手机沿用既有可信答复通路。
- 停止/释放/解雇先封闭扩展交互，再取消旧请求；shutdown hook 不得重新弹框阻塞释放。
  停止的封闭令牌只由对应 abort 收尾解除，不得解开随后发生的释放/再次停止；截止后的答复即使先于计时器回调也拒绝。
- 这里只支持选择与确认。终端 custom、输入编辑器、状态小组件以及 `/lcu pick` 的 composer 写入不在本桥范围内；
  macOS 屏幕录制/辅助功能仍由系统授权，工具审批模式也不代替 LCU 的应用许可。

升级 Pi 时复检公开 runner UI 绑定及 runtime 重建行为：重建 runner 必须重新绑定，不能默认保留。
另复检工具 wrapper 是否仍在实际执行时读取原注册定义的 `execute`；若改成注册时复制，需要重新适配（安全降级为人工卡片）。
回归：`extensionUI.test.ts`（真实 SDK、临时目录）、`ask.test.ts`、`supervisor.agentDispatch.test.ts`、
`extensionUI.fullApproval.test.ts`、`extensionUI.sdkApproval.test.ts`（真实 SDK 动态注册及负对照）、
`shared/types/agent.test.ts`、`main/ipc/agent.test.ts`、`AskBar.test.tsx`。

## 异步资源替换与取消

内置 `code_search` 的职责、默认关闭、云端数据边界和检索预算见
[内置代码搜索](code-search.md)。它复用 Devin 账号，不另建凭据存储；搜索失败不得
删除普通聊天的共享凭据。

- 缓存失效比较实际有效配置；Provider 的 ID 不变，不代表端点或凭证未变，删除记录也必须失效。
- 重配、刷新和关闭都要使旧初始化失效；成功、失败及 `finally` 只允许当前任务发布状态，过期资源须释放。
- 发出 abort 不等于文件 I/O 已结束。同目录下载重启前等待旧任务收尾，不能仅删除 `running` 后立即复用 `.part`。
- 回归须挂起初始化或重试，再跨事件轮次切换、取消和重开，验证旧任务不会覆盖新配置、释放新资源或删除新任务状态。

回归位置：`src/main/services/memoryHost.test.ts`、`src/main/services/chatModels.test.ts`、`src/main/services/memoryModels.test.ts`。

## 网络请求按协议分派

`providerApi.ts` 按 `ModelApiKind` 分派 URL、请求头和请求体。约定：

- base URL 为空时用 `DEFAULT_BASE_URLS` 兜底。
- 版本段用 `withVersionSegment()` 拼接，已含 `/v1` 就不重复加。
- 统一 15 秒超时（`AbortController` + `setTimeout`，`finally` 里清 timer）。
- 错误统一转成可读字符串：`errorText()` 截断响应体到 300 字符，
  `toMessage()` 把 `AbortError` 翻译成 `Request timed out`。
- 拉模型 / 连通性测试必须走 Chromium `net.fetch`，不要用 Node `fetch`。
  部分网关（Cloudflare）会按 TLS 指纹把 undici 拦成 403 挑战页；聊天能通是因为
  worker 装了系统代理，设置页主进程直连就会挂。发请求前先 `getProxyConfig().whenReady()`。

**连通性测试会真实调用模型**（`max_tokens: 1` 的最小请求），会计费。
没指定模型时退化为拉取模型列表，只验证鉴权和连通。改动这里要保持这个代价意识。

### 模型列表鉴权兼容（不推导聊天鉴权）

- 入口：`listModels(config: ProviderApiConfig): Promise<ListModelsResult>`。
- 仅第三方 `anthropic-messages` 目录首次返回 **401** 时，在同一个已解析 URL
  以 `Authorization: Bearer` 替换 `x-api-key` 再请求一次，保留 `anthropic-version`。
  官方请求按 `URL.hostname === 'api.anthropic.com'` 判断，不按整段 URL 或子串判断。
- 所有目录请求使用 `redirect: 'manual'`；3xx、403、429、5xx、网络异常和超时不触发
  鉴权回退。不能带着密钥跟随重定向，也不能把目录兼容逻辑扩展到 `/messages`。
- 成功响应必须是对象：Anthropic/OpenAI 含 `data` 数组，Google/Ollama 含 `models`
  数组。坏 JSON、HTML、错误结构均返回 `ok: false`；合法空数组仍可成功。
  非 2xx 不读取服务端响应体；异常继续脱敏。UI 在失败时不合并模型，空列表不删除旧行。
- 回归测试见 `providerApi.test.ts`：第三方 401→200 两次且同 URL；官方 401 一次；
  401→401 最多两次；非401和 AbortError 不回退；回退后的坏响应失败；
  Google/Ollama 空数组兼容；消息请求无新增回退或 redirect 设置。
- 错误：因为消息协议是 Anthropic，就认定目录必定接受 `x-api-key`。
  正确：仅对已观察到的目录 401 做有限兼容，不猜测模型实际可调用性。

## 写入校验

任何按渲染层传入的路径写文件，都必须先校验。`instructionStore.ts` 的两道：

```ts
// 1. id 只接受 uuid 形态，避免路径穿越
const isValidId = (id: string): boolean => /^[a-f0-9-]{36}$/i.test(id);

// 2. 写回源文件前，核对该路径确实是这个条目已登记的 sourcePath
function isRegisteredSource(id: string, sourcePath: string): boolean { ... }
```

没有第二道，`instructions:write-source` 就成了「渲染层可写任意文件」的通道。
新增任何写文件通道时想清楚：**攻击者控制这个参数能写到哪里**。

## browserHost：内嵌浏览器宿主

`browserHost.ts` 持有 `persist:enso[-dev]-browser` 独立 session 与 tab 表（按 agent
`sessionId` 记「当前 tab」）。worker 经 `browser-invoke` 事件调用，Main 回 `browser-result`。

- URL 门在 `@shared/browser/urlPolicy`；Main 的 `browserFileRoot.assertBrowserUrl` 追加当前可信
  本地会话的工作区边界与 realpath 校验，允许 http(s) 和工作区内现存的普通文件，拒绝符号链接
  逃逸、目录和缺失文件。模型导航、手动导航、页内跳转、重定向、弹窗和 file 子资源请求
  都复用这一校验；file URL 不进持久化历史或标签恢复。
- 模型可用的 `browser_cdp` 只走 `@shared/browser/cdpPolicy.assertAllowedCdpMethod`：给调试面
  （Runtime / DOM / CSS / Profiler / Performance / Log / Network.enable），拒 `Input.*`、Cookie、
  `Page.navigate`、下载、`Target.*` / `Browser.*` / `Storage.*`。点击 / 输入 / 导航一律走专用工具，
  要放宽先改策略测试再改名单。host 自用的 CDP（截图、设备度量）不过这道门。
- 快照只收视口内可见控件（带 `kind=click|fill|select`）和可见正文，不把屏外文章推进模型。
  password 控件要进 snapshot（`kind=fill`），但**不带当前值**；file / hidden 仍排除。
- 点 / 填 / 键 / 滚 / 选 / 拖走页内脚本与可信原生输入（`@shared/browser/pageScripts`），ref 只认最近一次快照。
  点/填前 `elementFromPoint` 检查遮挡；被挡住返回 covered，不要当 stale 重试死 ref。
  动作后在页内等两帧或 50ms，combobox 输入最多再等 200ms 出建议。
- 拖拽不走合成 `MouseEvent`（HTML5 DnD / 部分库不认）。Main
  页内用同一份 `DataTransfer` 发 `dragstart/dragover/drop`（原生 HTML5），然后
  `webContents.sendInputEvent` 发可信 mouseDown → 先微移 8px → 分段 mouseMove → mouseUp
  （jQuery UI 一类 mousedown 拖拽）。模型仍不能调 `Input.*`。
- **人与 Agent 默认协作，不做互斥控制权切换**：人工点击、键盘、导航、刷新不进入 manual，
  不永久阻断后续工具，也不要求「允许 Agent 继续」。`browser_lock` / `locked` 仅保留标签生命周期，
  不安装吞输入的遮罩，不禁用工具栏、不因 locked 上报 covered；成员 Agent 之间的 tab 占用协调仍保留。
  `release: true` 未指定 tabId 时释放本会话全部保留标记，指定 tabId 时仅释放目标。
- 人工操作 / 导航使旧 ref 和读取游标失效；读取过程中页面变化只拒绝本次迟到快照，重新读取即可继续。
  文本 / URL 等待不因人工操作中止，允许人协助完成条件；显式取消、会话结束和关闭 tab 的保护仍生效。
  页面加载时仅清理旧版或 BFCache 残留的锁页遮罩，不再创建。
  `did-navigate-in-page` 只推送状态；Agent 输入触发的 replaceState / hash 不视为人工操作，
  真实 input-event 和用户工具栏仍负责失效旧引用。
- 取消（含排队阶段）立即结束调用者等待；同 tab 队列和该次操作的取消信号保留到实际任务退出。
  取消后 2 秒仍未退出则关闭该 tab 回收队列，不在原 tab 上放行下一次操作，防止迟到点击 / 输入
  读到新信号继续执行。回归：`browserHost.capabilities.test.ts`。
- 浏览器工具 `executionMode: 'sequential'`：navigate 会清 ref，并行必假 stale。
- **「当前 tab」有两个指针，不能合并**：`currentBySession` 服务布局和面板显示，可被
  renderer 的 `setViewport` / 用户导航改写；`agentBySession` 只由工具本身（隐式选中、
  显式 tabId、`tabs new|select`）推进。合并的后果是面板一可见就改写 agent 指针，
  下一条不带 tabId 的 reload/导航打到别的页面（真实现象：空 tab 上 reload 报
  `Navigation URL is not allowed`，模型反复在错页打转）。
- 面板可见性上报只允许认**已存在**的 tab；`restoreTab` 没有持久化 URL 时不得建 tab，
  否则会留下永久空白页。空白 tab 的 reload 报「no page loaded」，不要冒充 URL 策略拒绝。
- 回合结束（`turn-completed` / `turn-failed`）关未锁且用户没在看的 tab；`parent-ended` 强关。

## 用量「按项目」不能用 cwd basename

`parseSessionJsonl` 从 session 头 `cwd` 取叶子目录名当 `project`。Enso 隔离 worktree 的路径是
`userData/worktrees/<projectId>/<8 位会话短 id>`，叶子名会变成 `3085e88f` 这类 hash，
设置页「按项目」就会把同一仓库拆成多个条目。

正确身份是**主项目名**，不是当前工作目录名：

- 解析层仍保留 basename + `cwd`（jsonl 事实）
- 归并在 `usage/projectLabel.ts`：用 settings 项目 + `worktrees.json` 按 cwd / 叶子名 / `worktrees/<projectId>/…` 映射
- `ingestSessionJsonl` 与 `getUsageSummary` 都走同一套别名，旧账本只剩短 id 也能并回去

Wrong：`project = basename(cwd)` 直接进聚合。
Correct：`usageProjectLabel(basename, cwd, aliases)` 后再 `aggregateUsage`。

## 用量解析缓存

会话目录可达 GB 级，全量解析一次要数秒。`usage/parseCache.ts` 把每个 jsonl 的解析结果按
`mtime/size` 落盘到 sessions 同级 `usage-cache/<文件名>.json`（内存再叠一层），重启后只读小缓存；
账本文件同样按 `mtime/size` 在内存复用。

- 缓存存的是**未套别名**的解析原值，别名仍在读取时套用；账本存的是套过别名的冻结值，两者不能互相替代
- `parseSessionJsonl` 输出语义变化必须递增 `CACHE_VERSION`，否则旧缓存会继续生效
- jsonl 消失时 `loadSessions` 同步清掉对应缓存文件
