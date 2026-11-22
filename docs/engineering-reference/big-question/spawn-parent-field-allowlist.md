# spawn-parent 白名单缺字段，整条启动命令被静默丢弃

## 症状

Main 侧 `spawnSession()` 返回 `ok: true`，UI 显示会话已创建，但会话永远不开始：没有 assistant
输出、没有报错，只有 worker 控制台一行 `[agent] dropped unparsable command: spawn-parent`。
更隐蔽的版本是：给 `spawn-parent` 加了一个新字段后，只有携带该字段的会话失败，不携带的照常。

## 根因

`parseAgentCommand` 对 `spawn-parent` 用 `hasOnlyKeys(value, [...])` 做**严格白名单**：
只要出现一个未列出的键，整条命令就返回 `null`。`src/agent/index.ts` 收到 `null` 后只打印一行
`console.warn` 并丢弃，不回复任何事件，因此 Main 只能等到 ready 握手超时。

字段可以只存在于两端之一而长期不暴露：

- 生产端写了、协议没登记 → 一旦该值非空就整条命令作废（本仓库真实踩过：
  `systemPromptAppend` 由预设/插件提示词尾段产生，白名单和 worker 消费方都不存在；
  记忆启动注入首次让它非空，立刻炸）。
- 协议登记了、worker 没有消费方 → 字段静默无效，功能看起来"没生效"但没有任何报错。

## 修法

1. 新字段必须**三处同时改**：`AgentCommand` 的 `spawn-parent` 类型、`hasOnlyKeys` 白名单、
   字段类型校验（`isNonEmptyString` / `typeof` 等）。
2. Worker 侧必须有真实消费方。追加系统提示词走 `appendSystemPromptExtension`（写
   `before_agent_start` 的 `appendSystemPrompt`），不要新造注入路径。
3. 空字符串之类"看起来等于没有"的值也要定规则：`isNonEmptyString` 会判非法，生产端应省略字段。

## 回归防线

- `src/shared/types/agent.test.ts`：白名单字段的 round-trip（合法值 → 原样通过；空串/错类型 → `null`）。
- 带该字段的真实启动链路测试（`agentHost.builtinTools.test.ts` 断言 `spawn-parent` 载荷），
  不要只断言 `postMessage` 被调用。
- 排查时先看 worker 日志里的 `dropped unparsable command`，不要从 UI 状态倒推。

## 相关代码

- `src/shared/types/agent.ts`：`spawn-parent` 类型与 `hasOnlyKeys` 白名单
- `src/agent/index.ts`：丢弃时的诊断日志
- `src/agent/supervisor.ts`：`spawn()` 参数与 `systemPromptAppend` 消费点
- `src/main/services/agentHost.ts`：`spawnSession()` 组装载荷
