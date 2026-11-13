# 保守微压缩接入

参考上游 `a0a31bf99b`；不整包合并、不升级 Pi SDK、不引入 `turn_discard`。

## 行为差距与所属层

现有单次工具结果外置、探索折叠和摘要压缩不负责自动清理累积的旧读取正文。
在 worker 的 `context` / `turn_end` 扩展边界选择、替换和追加 `context_edit`，不改原始消息，
不从 renderer 清历史。设置经既有 typed spawn 和 `set-compact-route` 下发，无新增 IPC。

## 必改文件

- `src/agent/microcompact.ts` 与同目录策略/SDK 测试：确定性选择、受保护结果、持久化与统计。
- `src/agent/supervisor.ts`、`src/main/services/agentHost.ts`、`src/shared/types/agent.ts`：接入、
  布尔设置校验与热更新；子会话沿用同一开关。
- `src/agent/contextOccupancy.ts`：仅从已持久化编辑统计条数和正文字符差值。
- settings store、Main settings 字段表、配置同步字段策略与设置 UI：默认开启的设备本地开关。
- `ContextInspector.tsx` 与中英文词条：展示当前分支有效清理量，不推算 token、费用或缓存收益。

## 保守边界

- 只清成功且纯文本的 `read/grep/find/ls/web_fetch/web_search` 结果；保留最近五条可清结果。
- 总量超过 500,000 字符时向 250,000 字符低水位清理；上次 assistant 回复超过一小时可清旧结果。
- 错误、图片/未知内容块、外置 artifact 引用、shell/后台任务、写入、用户回答、子代理结果均不清。
- 不将比占位更短的结果替换得更大；重复 toolCallId 无法可靠定位时拒绝清理。
- 请求前只生成模型视图；正常完成的 `turn_end` 复查权威投影后追加编辑，取消/失败不写编辑。
- 关闭只阻止后续清理，不撤销既有编辑；时间线和 JSONL 原文保留供审计。

## 明确不做

不承诺节省费用或保持缓存命中；不重放工具、不清磁盘原文、不恢复被清正文到模型上下文。
不改普通摘要策略、工具 schema、审批、模型路由、版本、打包和发布配置。

## 验证证据

- 策略与 SDK 集成先 RED（41 个缺失行为断言失败），最小实现后转绿；协议、Main 下发和
  worker 热开关另有明确 RED → GREEN。复查发现的 source entry 身份、有效正文字符归因、
  已摘要目标排除、排队 spawn 和工作区解锁重入均补复现断言。
- 隔离 Electron 使用临时 userData、CDP 9334、本地确定性假供应商（8898）和 SDK 生成的冷会话：
  实际网络请求不含最旧 `read` 正文、仍含下一条 `read` 与 `bash` 证据，恰有一个占位；
  Main 权威历史仍含原文；轮次 `turn-completed`、seq 23，统计 1 条 / 1270 字符。
- 关闭开关后另一个同形冷会话请求保留全部原文且没有占位；设置窗口的中文开关已截图走查。
- SDK 测试验证重复请求不重复落编辑、磁盘原文不改、重启投影仍保留编辑、关掉不撤销旧编辑。
- 这是确定性请求/持久化验证，不冒充两个真实厂商的模型自主调用验收，也不声称费用收益。
- 最终 `pnpm typecheck && pnpm lint && pnpm test` 通过：1293 个 Vitest 文件、13564 项测试通过，
  2 文件 / 15 项沿用跳过；lint 仅保留既有 `GitChangesView.tsx` 冗余 Fragment info。
- `pnpm --filter @enso/phone typecheck && pnpm --filter @enso/phone build` 通过；未打包或发版。
