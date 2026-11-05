# 手机远程一直停在「正在读取历史…」

## 症状

手机 PWA（或桌面远程节点）打开某个会话后，正文区长期只有 spinner +「正在读取历史…」；
标题、tabs、模型、用量条、输入框都正常，说明目录通道是通的。切到别的会话再切回来仍然一样，
桌面端此时给该会话发消息，手机也不会更新。

## 根因

手机 guest 只有一条出路能离开 `syncing`：host 下发一条包含该会话的 `session-sync`/`snapshot`。
host 侧这条应答要靠 `snapshotForPhone` 向 worker/renderer 要快照；如果第一次请求丢在
resume/spawn 线上（renderer 的 `resumeConversation` 静默返回、worker 里没有该会话、
`requestSnapshot` 还在等 worker 就绪），host 一句否定的应答都不发。于是：

1. `conn.pendingSync.answered` 永远是 falsy；
2. 手机每 10s 用同一 `requestId` 重试订阅，但 host 用 `waiting` 把这类重试整体吞掉
   （`else if (!waiting) snapshotForPhone(...)`），**重试变成空转，不会重新索要快照**；
3. 在等应答期间两端都主动丢弃该会话的实时事件
   （host `forwardAgentEvent` 的 `syncLiveRevision` 门、guest `acceptAgentEvent` 的 `pendingSync` 分支），
   于是正文既不来自快照也不来自 live，界面永久停住。

即"没有终态"：guest 侧重试无上限、无失败态；host 侧无否定应答。

## 修法

- `src/main/services/pairHost.ts`：同一个未答 sync 只吃掉紧随首轮的那一次重复订阅
  （peer-joined + onopen 抢跑），之后的重试必须再调一次 `snapshotForPhone`，
  `requestId` 保持不变以便慢快照仍能兑现。
- `packages/phone/src/client.ts`：`SYNC_RETRY_MS`/`SYNC_RETRY_LIMIT` 有界重试；
  耗尽后停表并 `onSyncFailed(sessionId, true)`，保留 `pendingSync` 让迟到应答仍可自愈；
  `retrySync()` 重新订阅（新 `requestId`），应答兑现或换订阅时撤销失败态。
- `packages/phone/src/App.tsx` / `ChatScreen.tsx`：本机没有正文时显示可重试的失败态，
  而不是继续转圈；有缓存正文时不动时间线。

## 回归防线

- `src/main/services/pairReplay.test.ts`：「首轮快照请求丢失后，后续重试订阅会再次索要快照」，
  同时守住突发重复只打一次 worker 的原有约束。
- `packages/phone/src/client.test.ts`：「同步应答始终不来时有界重试后明确失败，手动重试仍能接上正文」。
- `packages/phone/src/ChatScreen.test.ts`：失败态只在没有本地正文时出现。

## 相关代码

- `packages/phone/src/client.ts`（`subscribe` / `armSyncRetry` / `applySessionSync`）
- `src/main/services/pairHost.ts`（`case 'subscribe'`、`forwardSnapshot`、`forwardAgentEvent`）
- `src/shared/pair/syncProjection.ts`（`applySubscribe` / `applySnapshot` / `applyCatalog`）
- `src/renderer/stores/sessions/index.ts`（`resumeConversation` 的静默返回）
