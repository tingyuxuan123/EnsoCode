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

- `src/main/services/pairHost.ts`：同一个未答 sync 只吃掉**突发窗口内**（`SYNC_BURST_DEDUPE_MS`
  = 1.5s，覆盖 socket onopen 与 peer-joined 抢跑）的重复订阅；窗口外的重复订阅一律重新调
  `snapshotForPhone`，也就是手机第一条 10s 定时重试就直接补要快照（旧的「吃掉一次重复」写法
  要等到第二条重试、约 20s 才补要）。`requestId` 不参与去重：手机上换号重订阅时 `pendingSync`
  已换成最新号，在途快照到达后按新号兑现，不需要为省一次 worker 请求而吞掉新号。
- `packages/phone/src/client.ts`：`SYNC_RETRY_MS`/`SYNC_RETRY_LIMIT` 有界重试；
  耗尽后停表并 `onSyncFailed(sessionId, true)`，保留 `pendingSync` 让迟到应答仍可自愈；
  `retrySync()` 重新订阅（新 `requestId`），应答兑现或换订阅时撤销失败态。
  连接本身不健康（半开死链 / 断网，`close` 还没到）期间不计入重试次数、也不白发 subscribe：
  那不是「桌面端没回应」，断网几轮不该被判成同步失败。
- `packages/phone/src/App.tsx` / `ChatScreen.tsx`：本机没有正文时显示可重试的失败态，
  而不是继续转圈；有缓存正文时时间线照常显示，上面只挂一条不遮挡的失败条 + 重试按钮，
  顶栏状态灯也不再宣称「同步中…」（不伪装已同步）。连接不在线时归因给连接状态，
  不宣称「桌面端没有回应」。

## 已知未改限制

- 每次重试都会再走一遍 `snapshotForPhone(last, resume=true)`，也就是可能重复请求 renderer 的
  `resumeConversation`；在途请求已有去重，没有并发双 spawn，但失败前最多 6 次重试仍可能
  各触发一次 spawn 尝试。要根治得给 resume 加「已恢复」标记，本次不动 remoteNodes/resume 链路。
- 失败态下输入框仍可发送（只有本地回显）。syncing 期间本来就是这个语义，本次不新增队列或
  乐观回显规则；真要拦发送需要先定义「同步失败时本地消息的投递顺序」。

## 回归防线

- `src/main/services/pairReplay.test.ts`：「首轮快照请求丢失后，后续重试订阅会再次索要快照」，
  「紧跟首轮的突发重复订阅只打一次 worker」「已答过但应答丢失后同号重订阅仍重新要快照」
  「A→B→A 切会话不被突发去重吞掉」。
- `packages/phone/src/client.test.ts`：「同步应答始终不来时有界重试后明确失败，手动重试仍能接上正文」
  「迟到的应答仍兑现正文并撤销失败态」「连接不健康期间的重试不累计失败次数」。
- `packages/phone/src/ChatScreen.test.ts`：无正文时失败态接管；有缓存正文时正文保留 + 非遮挡
  失败条 + 重试入口，且不再显示「同步中…」；离线时提示归因连接状态。

## 相关代码

- `packages/phone/src/client.ts`（`subscribe` / `armSyncRetry` / `applySessionSync`）
- `src/main/services/pairHost.ts`（`case 'subscribe'`、`forwardSnapshot`、`forwardAgentEvent`）
- `src/shared/pair/syncProjection.ts`（`applySubscribe` / `applySnapshot` / `applyCatalog`）
- `src/renderer/stores/sessions/index.ts`（`resumeConversation` 的静默返回）
