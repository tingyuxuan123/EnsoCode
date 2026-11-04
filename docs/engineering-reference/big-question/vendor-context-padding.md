# Grok 专用补空误用于 Kimi Responses

## 症状

上游 [#188](https://github.com/J3n5en/EnsoCode/pull/188) 实测：Kimi 能完成首轮推理与工具调用，
却在工具结果后的 Responses 续轮报 `Invalid request: text content is empty`。会话 JSONL 没有空文本。

## 根因

应用通用 context 清洗曾在「带签名的思考 → 工具调用、无助手文本」的历史里注入 `text: ''`。
这是 Grok Responses 的重放兼容，不应发送给 Kimi。context 钩子修改的是请求副本，
只用 JSONL 离线重放、绕过应用的出站处理，就看不到真正发出的空 `output_text`。

## 修法

- 通用清洗仍负责孤儿工具结果、历史图片和残缺的工具结果文本，不补助手文本。
- 在 worker 的 `ModelRuntime.stream` / `streamSimple` 物理模型出口，仅为 Grok `openai-responses`
  保留补空兼容。不能按历史来源模型、代理域名或虚拟模型名判断。
- 只复制变化的容器，不重写签名、调用和结果配对，也不迁移历史。

## 回归防线

用真实 Pi Responses 序列化器和测试传输捕获出站请求，验证直连和虚拟路由均只对物理 Grok
补空，工具调用仍配对且输入历史不变。Pi 升级后复检虚拟路由和 `complete*` 是否仍经这两个出口。
序列化测试不等于真实厂商请求验收。

## 相关代码

- [`src/agent/imageContext.ts`](../../../src/agent/imageContext.ts)
- [`src/agent/modelContextCompat.ts`](../../../src/agent/modelContextCompat.ts)
- [`src/agent/supervisor.modelContextCompat.test.ts`](../../../src/agent/supervisor.modelContextCompat.test.ts)
