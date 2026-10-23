# 子代理运行过程观察侧栏：实施计划

状态：首期实现及验收完成，未提交、未发版。下文保留原实施边界与计划，实际结果见末节。

## 1. 目标与首期范围

在父会话点击子代理入口，右侧打开只读时间线，同时保留父对话。运行时看流式回复、工具参数与输出、可展示的思考内容、错误和最终回答；结束、释放 worker 或重启后，仍能读取已持久化的过程。

- 首期覆盖桌面主聊天的统一 `subagent` 工具，兼容 `task` 与 `coworker`。
- 入口包括工具摘要、运行进度项，以及当前父会话的子代理目录。
- 同一 child 重复打开只激活已有 tab；不同 child 可并列打开。
- coworker 延续多个 Run 时展示该 child 的完整会话，不承诺单个 Run 隔离回放。Run 与 Agent 不能混为同一个身份。
- 保留现有 CoworkerTabs、发送和停止语义。侧栏是额外观察入口，不改造成新的控制台。
- 不自动弹开侧栏，不自动切换主聊天的 `activeId` / `activeTabId`。

非目标：手机/PWA 新抽屉、Bot 群聊委派、工作流节点接入、递归派发能力、完整 Run 历史数据库、远程协议重构、发版。首期也不开放文件回退、审批响应或向 child 发消息。

## 2. 现状与差距

| 已核实的现状 | 目标差距 |
| --- | --- |
| `TaskBar.tsx` 用 `SubagentInfo.activities` 展示简化浮层，已结束条目会自动收起 | 需要稳定的完整过程入口，而不是依赖短期浮层 |
| `CoworkerTabs.tsx` 可切换到独立子会话 | 需要父会话与子过程同时可见，不能靠切主 tab 实现 |
| `AgentService.progress()` 只返回未结束 Run，正文是截短预览 | 不可把 progress 当正文权威或历史目录 |
| worker 已发布带 identity/seq/index 的正文、工具输出事件 | 实时链路原则上复用，不新增轮询正文的通道 |
| `readChildHistory` 当前只接受 `enso-*` safe journal | 普通 child 写的是 pi JSONL，需要按权威会话类型安全分流 |
| locked Enso safe journal 只保存受限、脱敏的记录 | 不能为“完整过程”突破原安全边界，也不能补造未记录内容 |
| task 完成会 dismiss；renderer 在 `coworker-update: dismissed` 时删除 child 元数据 | 需将运行实体回收与历史元数据保留分开，否则文件虽在也失去可靠入口 |
| 缓存只按主聊天选中项及现有旁路会话保热 | 侧栏正在观察的 child 必须计入热缓存，否则稍后会停更或清空 |
| `ChatSessionTimeline` 内含自动打开 Changes、全局搜索及部分全局活动会话操作 | 复用时必须显式隔离观察视图，不能只隐藏 Composer |

代码依据：`src/main/services/agentService.ts`、`src/main/ipc/agent.ts`、`src/agent/supervisor.ts`、`src/agent/ensoSafeJournal.ts`、`src/renderer/stores/sessions/index.ts`、`src/renderer/stores/sessions/messageCache.ts`、`src/renderer/components/chat/ChatSessionTimeline.tsx`。

## 3. 所有者、身份与数据流

```text
Main：child 身份 / parent 归属 / 会话文件来源 / Run 状态
  ├─ worker 正文事件 ──> 既有 IPC 广播 ──> sessions reducer ──> 只读侧栏
  └─ 已持久化会话文件 ──> 白名单投影 / 分页 ──> 同一会话投影

Renderer：只保存选择、tab、加载状态、观察引用，不创造运行事实
```

- Agent 使用 `agentId`，执行使用 `runId`，正文目标使用 child `sessionId`，实时事件按 `generation + seq` 防串流。
- `parentId + child.agentInstanceId` 关联现有 child 元数据，正文会话 ID 来自权威记录，不在前端拼接 `::cw-` 字符串，也不按标题或时间猜测。
- 新增 UI 目标解析纯函数，结果包含 owner/root、直属 parent、child 会话 ID；有可靠映射才可打开。前台阻塞 spawn 也必须能从运行目录打开，不等待最终报告。
- 工具行只涉及一个可靠目标时可以点击摘要打开；wait/list 等多目标操作保留既有报告展开，每个子项提供独立入口，不能随便打开第一项。
- 首期 tab 身份按所属父 dock + child 会话建键；generation 更新时走既有投影换代规则，不让旧读盘回包覆盖新代。
- 已结束 child 保留现有会话记录中的最小元数据和 sessionFile；从可恢复/可控制成员集合移除，明确 ended/不可恢复。必要时补最后一次 Run 的小型终态摘要，不持久化全文，不另建完整 Run 注册表。
- 目录从这些可靠 child 记录派生，不另养一份 running 状态。运行状态与 Run 验收状态分开：模型停笔不等于 gate/schema 验收已成功。
- 既有已删除且无法可靠关联的旧 child 不承诺恢复；不通过全盘扫描或标题匹配制造历史成员。

### 观察与结束时序

```text
child ready -> 记录权威 child/file 元数据 -> 用户打开只读观察
                                         -> pin 正文缓存
                                         -> 读取 snapshot，接续实时事件

Run 结算 -> 保存小型终态 -> task 回收/撤销原授权
                        -> 从 live 成员集合移除
                        -> 历史元数据仍在，已打开侧栏不消失

侧栏关闭 -> 释放观察 pin / UI 引用
        -X-> abort / dismiss / dispose child / 释放其它 tab 资源
```

## 4. 分阶段执行

### P0：先建立失败测试与契约

- 目标解析：同名 child、多个父会话、一个 coworker 多个 Run、单/多目标工具、无 child 的启动失败、坏回执。
- 历史留存：task 自动回收和显式 dismiss 后可只读查询，但不会被 restoreChildren 恢复成活 child；worker 退出后的记录不能仍显示运行中。
- 先写上述失败测试并运行确认 RED，再进行实现。

### P1：身份关联、回收后的元数据与安全历史读取

- 沿现有 Main child metadata 链路暴露可靠的 UI 目标；不改模型工具参数 schema，不把进度预览改成第二份正文。
- 将“从 live 成员移除”和“删除历史记录”拆开；适配 renderer 旧的 dismissed 删除分支与 Main 恢复筛选。
- 扩展现有 typed 历史读取结果，区分 safe journal 与普通会话尾窗；优先复用现有 snapshot、reload、投影及分页能力，避免再造全文读取接口。
- locked Enso 只走 safe journal；普通 child 仅在 Main 验证归属与文件来源后读取 pi JSONL，并复用 `projectMessage` 白名单投影。不能仅删除 `enso-` 限制放行所有文件。
- IPC 只接收会话标识和受限分页游标。检查会话归属、实际路径边界、符号链接逃逸、缺失/损坏文件，返回结构化失败。不通过 spawn/resume 来读历史。
- live snapshot / 历史页与在途事件按 generation、seq、绝对 index 归并；冷回包不得覆盖新代正文、复活终态或丢掉实时尾巴。
- `AGENT_CHILD_HISTORY_READ` 若扩展，所有调用方同步适配；确需新通道时同步 shared 常量、Main 注册和 preload typed 出口。

### P2：可观察投影与缓存生命周期

- 提供按会话 acquire/release 的观察入口；维护引用计数，仅作为缓存保热和读取协调，不改变 worker 生命周期。
- 打开可见详情时补快照/冷历史，折叠或关闭后释放 pin，沿既有 TTL 回收正文。
- 避免在 `onAgentEvent` 订阅里做业务归并；新增规则放 reducer 或独立可测协调函数。
- 覆盖过期 seq、generation 切换、读盘过程中到达新事件、空正文、重复打开/关闭和清理失败。

### P3：右侧只读时间线与入口

- 新增 `SubagentSessionView`，优先复用 `MessageTimeline` / `buildTimeline`；只抽取必要的时间线展示部分，不复用带启动和输入逻辑的完整 ChatView。
- 通过明确宿主上下文关闭 retry/edit/fork/withdraw/审批响应/工具控制；禁用自动打开 Changes 等副作用，隔离键盘搜索焦点。文件链接仍按 child 的项目/工作区归属路由，不落到全局当前会话。
- 显示任务名、模型、运行/等待/结束状态、最终错误与已记录正文；只显示模型/持久化实际提供的思考信息。
- 首次加载、无输出、文件丢失、历史不完整均有明确状态。历史失败保留已有正文并允许显式重试。
- 接入现有 Dockview 与 `sidePanelDock`，处理 dock 尚未挂载时的待开请求、重复激活、父会话切换和删除。
- 新 tab 关闭显式识别为观察视图，不落入现有默认 terminal.dispose 或 btw.dispose 分支。
- 工具摘要、SubagentResult 各目标行、运行进度和子代理目录共用同一个打开动作。后台终端浮层不改。
- 详情/目录 tab 首期只在 renderer 内存保留；布局持久化精确剥离这些 tab，不影响原有 Files/Changes/Terminal/Browser 布局。

### P4：已结束目录与验收

- 提供当前父会话“子代理”目录，按运行中/已结束分组，已结束项不会随 TaskBar 自动收起而失去入口。
- 只读目录按稳定会话身份展示；首期不承诺逐 Run 分页与完整 Run 账本。长消息使用既有尾窗/上滑分页，目录量大再按真实数据确定是否需要元数据分页。
- 补中文/英文、键盘焦点、长标题、窄侧栏、明暗主题、虚拟列表及贴底/上滚不抢滚动验收。
- 完成全量检查及两家不同厂商模型真机验证后再判断功能完成。

## 5. 必改与候选文件

| 层 | 预计文件及原因 |
| --- | --- |
| shared | `src/shared/types/agent.ts`：历史结果、必要的 child/终态元数据及解析；新增 IPC 时再改 `src/shared/types/ipc.ts` |
| Main | `src/main/ipc/agent.ts`：权威目标、历史来源与校验；`src/main/services/conversationReload.ts`：分流；`src/main/services/sessionHistoryTail.ts`：复用分页投影 |
| Main 生命周期 | `src/main/services/agentService.ts`、`agentSessionIndex.ts`、`agentDispatchService.ts`：仅在终态留存、目标关联、恢复筛选所需处修改，不重构运行引擎 |
| preload | `src/preload/index.ts`：typed 读取出口与调用参数/返回值同步 |
| renderer 数据 | `src/renderer/stores/sessions/index.ts`、`messageCache.ts`、必要时 `reducer.ts`：保留历史、观察保热及竞态；新增目标解析纯函数及测试 |
| renderer 侧栏 | `src/renderer/components/sidepanel/SidePanel.tsx`、新增 `SubagentSessionView.tsx` / 目录组件、`src/renderer/lib/sidePanelDock.ts`、`stores/sidePanel/`：tab 与清理/持久化规则 |
| renderer 聊天 | `TimelineRow.tsx`、`SubagentResult.tsx`、`TaskBar.tsx`、`ChatSessionTimeline.tsx`、`chatHost.ts`、`stores/sessions/timeline.ts`：入口与只读宿主；`src/renderer/i18n.ts`：文案 |

worker 现有正文链路原则上不改；只有经测试证实缺少必要关联事件时才补协议，不引入新 writer 或改 locked journal 的安全合同。

## 6. 验收清单

1. spawn 后运行未结束即可打开，回复和至少两次工具调用实时出现；并发 child 不串内容。
2. task 自动结束回收后，已打开视图与目录仍能读过程；关闭 tab 不停止任务。
3. 冷缓存回收、worker 退出、应用重启后，已有可靠元数据的普通 child 可只读回放，不产生新的模型请求或授权。
4. coworker 连续两个 Run 使用同一会话视图，旧 runId 不被误当 child ID；不宣称恢复未持久化的完整 Run 历史。
5. 同名 agent、跨父会话、换 generation、迟到快照与旧分页不会串流或回滚正文。
6. 侧栏长时间观察不因五分钟缓存 TTL 停更；用户上滚后新输出不抢滚动，回到底部后恢复跟随。
7. retry/edit/fork/withdraw/发送/审批等写操作在观察视图缺席且不能误作用于父会话；原 CoworkerTabs 控制行为不变。
8. 恶意/未知 ID、跨归属、路径逃逸、symlink、坏文件和 locked journal 均走预期边界；原始凭据与未投影字段不返回 UI。
9. 删除父会话清理目录/观察引用；删除/回退导致目标失效时不跳到另一个 child。旧历史不可证明关联时给出不可用状态，不伪造正文。

测试顺序：身份/历史/缓存/布局纯逻辑 RED → 最小实现 GREEN → 集成回归 → CDP 真机。文件 fixture 使用临时目录。

```bash
pnpm typecheck && pnpm lint && pnpm test
```

真机使用独立 `ENSO_USER_DATA_DIR` 与不同 CDP 端口，先验证 fake-provider 的确定性事件顺序，再使用两个不同厂商模型验证真实 subagent 派发、流式工具调用、失败和结束回看。保留截图、IPC 返回与临时 JSONL 对照证据，不修改真实用户配置。

## 7. 交付门槛与实施约束

- 按 P0 → P1 → P2 → P3 → P4 推进；不能只做好侧栏外壳就宣称完成。
- 测试先行与实现可在契约固定后分别委派；历史/身份依赖完成后，UI 与目录可并行，不多人同时修改大 store/IPC 文件。
- 开始实现时复查当前源码；本文行号不作为接口合同。
- 如需调整 pi SDK 的读取/投影适配，先读取当前 SDK 文档，不新增未登记的私有 API 依赖。
- 未取得真机或模型条件时，报告具体验证缺口，不把单测通过等同于功能验收完成。

## 8. 实际实现与验收记录

已实现：

- 工具摘要的单目标导航、报告/等待结果的逐目标入口、输入框上方运行项与子代理目录。
- 复用现有时间线的只读 Dockview 详情，重复打开聚焦；不切父对话、不提供写操作，关闭不停止任务。
- typed child 回收保留 ended 元数据与 sessionFile，普通 JSONL / locked safe journal 分流、白名单投影和分页。
- 可见观察引用保热，隐藏/关闭释放；详情与目录不写入持久布局。
- Main 精确身份的最终验收摘要；当前 Run 进度优先，避免把上一轮成功或模型停笔当作本轮验收通过。

TDD 覆盖身份/多 Run、回收留存、普通冷读/路径与 symlink/类型边界、generation 竞态、
历史失败收口、末个观察引用释放、瞬时回收的迟到快照、仅生命周期 seq 变化、进度初始查询迟到、
只读 SSR 及 transient 布局/资源清理。每组新增逻辑均先运行 RED，再实现 GREEN。

隔离真机：独立 `/tmp/enso-observer-verify` userData、CDP 9337；受控本地 provider 与
真实 DeepSeek `auto/deepseek-v4.1-flash`、OpenAI `auto/gpt-6.1-sol` 均执行父模型自主
`subagent.spawn(mode=task)`，child 实际执行 `read README.md` 和带延迟的 `bash`。
两家模型均观察到运行中的侧栏正文/工具行；关闭观察标签后 child 仍为 running/started，
随后自然 succeeded，普通冷读返回七条消息及 read/bash 两个结果，父会话选择不变。

完整停止并重新启动隔离 Electron 后，ended child 未恢复运行实体；从目录打开仍读到七条
消息及两个工具结果。真机还核对了隐藏侧栏 pin 为 0、重新显示后 pin 恢复，以及持久布局不含观察 tab。

真机暴露并修复了详情外层非 flex 导致虚拟时间线高度为 0：修复后可见时间线高度约 800px，
不再只有标题没有正文。此项以实际 DOM 几何/截图验证，不以 SSR 结果冒充布局验收。

跨平台限制：Windows native UI 与 SSH live 用例仍由现有测试条件跳过；本次桌面验收在 macOS。
没有新增手机/Bot 群聊入口，也没有补造旧版已删除、无法可靠关联的 child 历史。

最终检查：`pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm knowledge:check`、
`git diff --check` 均成功。Vitest 为 833 个测试文件通过、9436 个测试通过、7 个条件用例跳过。
lint 仅提示既有 `GitChangesView.tsx` 的 redundant fragment 信息；知识检查无坏链接，保留既有结构警告。
隔离 Electron、两台本地 fake provider、测试 userData（含临时凭证副本）、测试工作区及临时脚本均已清理。

## 9. 入口收敛：一次性任务与持久协作者

用户指出观察侧栏与「雇佣 coworker」入口概念重叠后，第二轮仅收敛 Renderer 展示和操作；
不修改 Main 的创建、派发、恢复、权限或模型工具协议，也不新建代理实体。

- 统一目录叫「代理」，按「一次性任务 / 持久协作者」分类，来源取权威
  `dispatchOrigin`（手动创建 / 模型派发 / 提及派发），不按名称猜测。
- task 不再占顶部可交互标签。持久 coworker 可以在顶部发消息，也可额外打开只读过程；
  详情明确说明不能发送消息，关闭观察不会停止代理。
- 顶部 X 仅隐藏对话视图，运行中也不 stop/dismiss，不从 parent.coworkerIds 移除。
  目录「打开对话」与顶部恢复菜单重开同一实例；恢复不创建新 child。
- 解雇移入操作菜单和右键菜单，明确二次确认“会结束会话并停止工作”，取消不改变实例。
- 「添加协作者」弹窗说明其持久语义，名称与实际角色分开，创建在途禁用重复操作。
- 目录将 Run 结束与实例关闭分开：完成一轮的 coworker 仍是待命协作者，可继续对话；
  已解雇、历史只读或一次性任务不能通过「打开对话」进入可交互视图。
- UI 资格共用纯策略，保留缺省 mode 的旧协作者兼容；旧选中 task 自动回到父视图而不终止任务。

TDD：标签过滤/隐藏恢复/成员保留/非持久隐藏状态、目录来源及类型、实例与 Run 生命周期、
关闭与解雇按钮语义、旧版缺省 mode 恢复均先 RED 后 GREEN。

隔离真机（userData `/tmp/enso-agent-ui-verify`、CDP 9341、本地受控 provider）：
从真实弹窗创建 manual coworker，关闭顶部标签后记录仍 started、仍在编，随后通过目录打开
同一 child ID，实例数不变；运行中关闭后仍 running/started，并自然完成真实 bash 命令。
恢复菜单同样重开原 child；解雇前的确认和取消均保持实例存活，明确确认后才 ended/started=false，
并移出活成员集合。模型工具派发的一次性 task 不出现在顶部，目录标注“模型派发”，只有查看过程。
本轮没有重新进行云端模型协议验收；上一轮两厂商派发验证记录仍保留，不冒充本轮新验收。

本轮最终检查：typecheck、lint、全量 test、knowledge:check 和 diff --check 均通过；
Vitest 为 835 个文件、9459 个测试通过，7 个现有条件用例跳过。lint 仅有既有 fragment 信息提示，
知识检查无坏链接。测试 Electron、本地 provider 和两处隔离目录已清理，未提交、未发版。
