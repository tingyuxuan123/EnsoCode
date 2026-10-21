# Move to worktree 的三重竞态（会话换 cwd 重生的完整坑单）

> 来源：08-30-worktree-isolation 任务，CDP 真机排障。单元测试全绿的情况下，
> 端到端连续踩了三个独立的坑才让「迁移后写文件落在 worktree」成立。
> 凡是「杀掉 worker 会话 → 换参数重新 spawn」的功能（fork、换 cwd、换运行时）都会撞。

## 坑 1：新增 AgentCommand 必须同步改 parseAgentCommand 白名单

worker 入口对 main→worker 命令做 shape 白名单校验（`src/shared/types/agent.ts`
`parseAgentCommand`），漏加的命令被**静默丢弃**，只在 stdout 打一行
`[agent] dropped unparsable command: <type>`。类型系统不会提醒你——`AgentCommand`
联合类型加了新成员，parser 的 switch 缺 case 不报错。

**规矩**：加命令三件套 = 联合类型 + parseAgentCommand case + 回归测试（agent.test.ts）。
嵌套配置加字段也一样：2026-10-21 新增 `thinkingLevels` / `vision` 后，Main 已经下发，
但 `parsePhysicalSpawnModelConfig` 白名单没同步，整个 `spawn-parent` 被丢弃。
后续 prompt 报 `unknown or stale session generation`，界面只剩「送达待确认」；
权威记录仍为 draft、无 sessionFile，依赖历史文件的自动恢复也不会触发。

修复必须同时覆盖协议和消费：白名单校验合法字段，worker 注册模型复用统一能力提取函数，
不能继续手抄旧字段。回归用 Main 的真实选型产物调用 worker parser，并断言最终注册模型的
档位与图片能力，避免生产端、解析端各自单测通过而实际契约断裂。
回归位置：`src/shared/types/agent.test.ts`、`src/main/services/agentHost.test.ts`、
`src/agent/supervisor.resolve.test.ts`。

## 坑 2：post 型 IPC 的「ok」不等于「做完了」

`sendAgentCommand` 只是 postMessage，返回 ok 不代表 worker 执行完。
release-parent（销毁会话）后紧跟 spawn-parent（新 cwd 重生）时，spawn 可能在
release 完成前到达：supervisor 的 spawn 对「已存在且同 generation」的会话走
**短路复用分支**（不打 [spawn] 日志！），旧 cwd 的会话继续活着，新 cwd 永不生效。

**修法**：需要顺序语义的命令在 main 侧等确认事件回流（AGENT_RELEASE 等
parent-ended，带超时兜底），再返回 IPC。

## 坑 3：`spawning` 不能当互斥门用——worker 事件会清它

renderer 想用 `spawning: true` 挡住 ChatView 的自动 resume，但 sessions store
的事件处理会在 worker 事件（含 release 触发的 parent-ended）到达时把 spawning
清掉，守卫在最需要它的窗口期失效。auto-resume 趁 worktree 尚未登记，用旧 cwd
把会话复活。

**修法**：互斥门用专职字段（`workspaceMigrating`），只由迁移动作本身设置/清除，
不与任何事件驱动的运行态字段复用。

## 治本原则：路径类授权/决策收口到 main

renderer 的状态永远可能陈旧（HMR、事件竞态、多入口 resume）。cwd 这类安全敏感
参数不要依赖 renderer 传对：main 在 AGENT_SPAWN 里按 worktree registry
**无条件覆写** cwd，整类「陈旧 cwd 抢跑」从有害降级为无害。

同一 worktree 可被多个会话引用，不能把会话 ID 当作物理目录身份：

- 新会话须先完成 Main 绑定，再发布为 active；绑定失败不得静默落回主树。
- 清理只解除当前绑定，最后引用才删除目录；共享、创建与删除必须使用同一操作门，异步后重读引用。
- 名称与重建路径同步同一 `projectId + repoPath + path` 的绑定，保留每条记录自己的会话 ID。
- typed dispatch、hire、restore 的 parent/child spawn 也要读 Main 当前绑定；文件引用快照必须使用同一 cwd，不能只修 spawn 路径。

回归位置：`src/main/ipc/worktree.test.ts`、`src/main/services/agentDispatchService.test.ts`、
`src/renderer/stores/sessions/worktree.test.ts`。

## 同目录切分支也需要 worker 确认

切分支不改变 cwd，不必释放 idle worker，但 Main 的 busy 门挡不住 worker 内部 notifier、coworker 续轮或验收 shell。
安全顺序为：Main 按真实 Git 工作树立门 → worker 原子检查整树空闲并冻结、ACK → Git 检查与切换 → 安装分支背景并解锁、ACK。
锁覆盖同树路径别名与项目子目录，不能用 Git commonDir 把不同 worktree 锁成一组。

- `git status` 干净不代表可切：merge/rebase/cherry-pick 等进行中状态须独立检查。
- 分支背景在下一次真实 `before_agent_start` 消费，不主动发送消息或改变 slash 输入；消费事件以 generation、seq、操作 nonce 清除 renderer 提醒。
- Git 已变更但读盘、落库或 ACK 失败，仍返回 `changed` 投影刷新文件和分支，不自动回滚 Git。
- 有限解锁重试后仍不能确认恢复，返回 `workspaceBlocked` 并保留 Main/renderer 门，提示重启；不能只报错却放开下一次发送。
- 文件刷新使用 workspace revision 丢弃旧回包，保留未保存草稿并标记冲突，不能重挂载编辑器来清状态。

回归位置：`src/main/ipc/workspaceBranches.test.ts`、`src/main/services/gitBranches.test.ts`、
`src/agent/workspaceSwitch.test.ts`、`src/agent/supervisor.coworkerWait.test.ts`。

## 排障手段备忘

- supervisor `[spawn]` 日志带 cwd 是定位关键（本次顺手加上了，别删）。
- CDP 包 store action 记 trace（`store.setState({ action: wrapped })`）可拿到
  精确到 ms 的竞态时序，比猜快得多。
