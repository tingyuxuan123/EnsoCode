# Responses 摘要缺少路由 key，被网关判为非法 Codex 请求

## 症状

普通对话可用，默认上下文压缩却显示：

```text
Context overflow recovery failed: Summarization failed:
OpenAI API error (400): ... invalid codex request ... invalid_responses_request
```

错误来自模型请求，不是压缩页面渲染。同一份用户内容在 Codex 可用，不能证明两个客户端发出的 HTTP 请求相同。

## 根因

Pi 0.85.1 的原生摘要链路：

```text
completeSummarization
  → cacheRetention: 'none' + fresh sessionId
  → OpenAI Responses serializer
       cacheRetention === 'none' → 删除 body.prompt_cache_key
  → 当前接入网关拒绝请求
```

普通会话通常带 `sessionId` 且未禁用缓存，因此仍发送 `prompt_cache_key`。
这个字段虽然名为 cache key，部分网关也用它校验或路由 Codex 请求。

真实单变量对照使用同一模型和不含项目内容的短摘要，并保留 `store:false`、
`stream:true` 和原推理档位：

| 相对失败摘要请求的变化 | 结果 |
| --- | --- |
| 不变，缺少 body key | 400 `invalid_responses_request` |
| 只增加工具列表 | 同一 400 |
| 只将输出预算由 13107 改为 32000 | 同一 400 |
| 只补 session affinity headers | 同一 400 |
| 只补随机 UUID `prompt_cache_key` | 200，实际返回非空摘要；重复对照成立 |

这是**本次接入网关的实测行为**，不是 OpenAI Responses 标准或所有 New API 服务的必填规则。
同一错误码也可能对应其他校验条件，不能把所有 400 都归因于缺 key。
HTTP 200 本身不等于生成成功，验收仍须检查流结束状态和非空摘要。
随后使用同一网关／模型执行真实 `generateSummaryWithUsage → runtime.streamSimple`，
连续两次得到 `stopReason:stop` 和非空摘要；验证仅使用虚构短对话，不发送真实项目正文。

## 修法

在 worker 自定义 API-key `openai-responses` provider 的请求出口补缺失的 key：

- 同时包装 `stream` 和 `streamSimple`，分别委托原实现，保留 raw provider 参数。
- 先执行原 `onPayload`，尊重异步替换、原地修改和 `undefined` 返回语义；
  只对最终对象缺失或 `undefined` 的 key 补一次性 UUID，已有值不擅自改写。
- 每次独立请求使用不同的兜底 key；同一次底层请求重试可以复用。
- 不修改 `cacheRetention`、`prompt_cache_options`、输出预算、消息角色、工具、鉴权或存储参数；
  不新增 affinity headers，不把 `none` 强改为 `short`。
- 一次性 key 避免主动跨调用复用路由标识，但**不承诺服务端绝不写缓存**。
- 通过 `registerNativeProvider` 安装，确保 runtime refresh 后仍生效；
  OAuth Codex 和其他 API 不经过该安装分支。

不能只挂 Agent 的 `before_provider_request`：原生摘要及独立 complete 调用不经过它。
也不能仅注册自定义 `streamSimple`：Pi 的 legacy composer 会让 raw complete 也走该函数，
从而改变 `reasoningEffort`、`serviceTier` 等参数语义。

当前安装点只接收 Enso 构造的 provider-level headers，且 runtime 使用 `modelsPath:null`。
`registerNativeProvider` 会移除 legacy extension 配置；若以后增加 model-level headers 或
models.json 覆盖，须复检鉴权／headers 的额外解析，不应将此安装方式当成任意 provider 的通用迁移。

## 回归防线

`src/agent/supervisor.responsesRouting.test.ts` 使用真实 ModelRuntime、Pi serializer 与 SSE 解析，
仅 HTTP transport 为假网关：缺 key 返回 400，有 key 才返回摘要。

18 个用例覆盖默认摘要、正常会话阳性对照、独立 complete、Smart ModelRegistry.complete，
以及 raw 参数、鉴权／UA、refresh／重复注册、并发隔离、回调替换与异常和非目标 API。
同时检查预算、缓存策略及已有 key；所有凭据、对话与网络均为隔离 fixture。

```bash
pnpm exec vitest run src/agent/supervisor.responsesRouting.test.ts
```

升级 Pi 时复检 raw/simple 委托、payload callback、native provider 注册和 refresh 语义。

Pi 1.4.0 已复检：原生摘要不再从 `reserveTokens` 派生固定输出预算，改用模型输出上限；
`reserveTokens` 只控制压缩触发余量。回归用两种余量验证 HTTP 请求仍保留 `none` 缓存策略、
`store:false` 与独立 routing key，输出上限来自模型，而不是恢复旧的 13107 token cap。
上面的 13107/32000 单变量结果保留为历史实测，不是当前版本的固定预算契约。

## 相关代码

- `src/agent/openaiResponsesRouting.ts`：最终 payload 的一次性路由 key。
- `src/agent/supervisor.ts`：`resolveBaseModel` 中 API-key Responses 的安装边界。
- Pi：`dist/core/compaction/compaction.js` 的 `completeSummarization`。
- Pi AI：`dist/api/openai-responses.js` 的缓存／请求参数构造。
