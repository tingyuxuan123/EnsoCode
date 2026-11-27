# 插件注入假成功：生产端字段泄漏与缺少 worker 回执

## 症状

插件注入返回 `ok`，但权威历史没有消息、provider 没收到请求；从没运行过的空白会话另报
`Unable to start session`。不能只看 renderer 正文：冷会话投影可为空，应同时核验 Main 历史与实际请求。

**纠正旧结论：**本地 Pi 的 `sendCustomMessage` 明确支持 idle＋`triggerTurn:true` 启动新轮。
“插件只能插入正在回复的回合”不是能力限制，不能从静默丢弃现象推出该结论。

## 根因

1. `extensionPlugins/service.ts` 将含 `sessionId` 的 input 整体展开进 bridge message，
   `agentHost.ts` 又展开进 `plugin-inject` 顶层命令。真实 `parseAgentCommand` 白名单没有
   顶层 `sessionId`，worker 因此拒收。此错误不区分 idle/running。
2. Main 只确认 post/queue 成功，未等消费者接收；worker 旧分支遇到无目标/换代直接返回，
   也丢弃 `deliver` 的失败结果。
3. 唤醒只调用 `resumeConversation`，无历史会话直接 no-op。Main 实际会检查 ready/alive，
   并不是“持有 identity 就必然把消息投进休眠 worker”。

## 修法

- 生产端显式投影字段，不放宽 worker 白名单；内部取消 signal 不得序列化进命令。
- 注入绑定 requestId＋实际 SessionIdentity，Main 等 worker accepted/rejected ACK；ACK 只表示
  已接收，不表示模型或任务完成。退出、换代、超时结果未知时明确失败，不自动重放。
- worker 去重缓存有硬上限，活代满额拒绝新请求，不靠淘汰活代记录来允许旧 ID 再执行；
  失效代可清理。压缩状态和 SDK 压缩标记任一有效时拒绝，不等结束后悄悄重发。
- UI 唤醒使用显式 `resumeConversation(id,{allowBlank:true})`，复用模型/工作区校验和 spawn，
  不制造占位用户消息、不改草稿或当前会话选择。
- 待办只在接收 ACK 后用快照比较更新进行中，不能盖掉较早到达的 Agent done/edit；
  复制剪贴板不表示执行，不应改变任务状态。

## 回归防线

- service → 真实命令生产者 → `parseAgentCommand`，而不是各层各自使用“正确形状”的桩。
- ACK 超时、错代、worker 退出、重复 ID、活代容量、压缩冲突、空白及历史恢复。
- 隔离 Electron＋假 provider 核对权威历史、原图摘要实际到达和 Agent 工具回写；
  假 provider 不是双厂商真实模型验收，不能混用结论。

## 相关代码

- `src/main/services/extensionPlugins/injectionRequests.ts`：精确代次回执 broker。
- `src/agent/pluginInjection.ts`：消费者准入、去重和压缩拒绝。
- `src/main/services/extensionPlugins/service.test.ts`：producer/parser 集成契约。
- `examples/plugins/memory/test/delivery.test.mjs`：不乐观标进行中、晚回执与重复点击。
- `examples/plugins/memory/test/verify-delivery.mjs`：隔离宿主验收。
