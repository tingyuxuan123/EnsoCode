# 排队消息撞上下文压缩

## 症状

轮次结束后排队消息 / goal 续跑 / 「打断并发送」偶发报
`Cannot submit a prompt while compaction is in progress. Wait for compaction to finish and retry.`，
或压缩较久时报 `The previous turn is still running and could not be interrupted`；
修掉报错后，压缩结束又会把下一条排队消息并发发出去。

## 根因

- 持续记忆扩展在 pi 的 `agent_settled` 后用 `setTimeout(0)` 才调 `ctx.compact()`；
  supervisor 早在 `agent_end` 就发了 turn-completed，renderer 已泵出下一条 prompt，
  到 worker 时手动压缩正在跑，pi `prompt()` 直接抛错。
- pi 自动压缩在 `agent_end` 之后、`_isAgentRunActive` 仍为 true 时进行，
  prompt 被当成僵尸轮只等 5 秒就失败。
- `waitForIdle()` 在 `agent_settled` 发出后同步唤醒，早于扩展的 `setTimeout(0)`：
  若醒来立刻起新轮，随后启动的压缩会 `abort()` 掉这轮。
- renderer 在压缩 end 时泵队列，不知道上一条 prompt 还在 worker 里等压完。

## 修法

- worker `prompt` 走 `waitPromptable`：`isCompacting` 不限时 `waitForIdle`（不计僵尸时限），
  只对纯 streaming 限时；每次等过之后让一拍 `setTimeout(0)` 再复查，给延后压缩先启动的机会。
- renderer 压缩 end 时若时间线里还有 optimistic 回显（投递在途），不泵队列、不续跑 goal，
  交给那一轮 turn-completed 泵。
- 空闲会话换模型时，用新选模型窗口与每模型预留判断是否提前压缩；必须同时确认 SDK 空闲、
  无在途投递/轮次，并在同会话串行门内等待压缩。不能异步启动后立即放门，否则 `compact()`
  开头的 `await abort()` 会给下一条 prompt 留出抢跑空档。模型切换事件先同步，压缩后未知用量不复用旧值。

## 回归防线

- `src/agent/supervisor.agentDispatch.test.ts`：压缩中 prompt 等压完、自动压缩超僵尸时限不失败、
  空闲后下一个宏任务才启动的压缩。
- `src/renderer/stores/sessions/index.test.ts`：压缩结束时已有投递在途不再泵下一条。
- `src/agent/supervisor.compact.test.ts`：换模型后按新窗口和每模型预留触发；压缩启动前的空档不放过后续 prompt。

## 相关代码

- `src/agent/supervisor.ts`：`case 'prompt'`、`waitPromptable`
- `src/agent/continuousMemory/vendor/hooks/compaction-trigger.ts`
- `src/renderer/stores/sessions/index.ts`：`compaction` 事件处理、`flushQueue`
