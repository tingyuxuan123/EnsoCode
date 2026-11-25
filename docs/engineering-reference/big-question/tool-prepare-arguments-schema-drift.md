# 工具归一化产物必须满足自己声明的 schema

## 症状

`memory_capture` 单测全绿（`prepareArguments` / `execute` 直接调用都通过），真机上模型每次调用都被
拒绝，报参数不合法，记忆永远不落库。同一个工具的 `memory_search` 正常。

## 根因

pi 的工具执行顺序是 **`prepareArguments` → JSON schema 校验（TypeBox `Value.Check`）→ `execute`**。
归一函数在参数里追加了一个内部派生字段 `unitTypeSource`，但工具 schema 的 `properties`
没有声明它，且 `additionalProperties: false`。于是归一后的对象比模型发来的原始对象**多了一个键**，
校验阶段整体判非法。

症状出在「模型传参不合法」，根因却在我们自己的归一函数：症状与根因隔了一层。
测试之所以全绿，是因为直接调 `prepareArguments` / `execute` 绕过了 pi 的校验步骤。

## 修法

1. 派生信息不进工具参数。`unitTypeSource`（`explicit | fallback | default`）改由 Main 侧
   `parseMemoryCaptureRequest` 根据 `unitType` 的原文自行判定；worker 只做 trim / 小写透传。
2. 归一函数只允许产出 schema 里已声明的键；需要「回退到缺省值」时也只能改已声明键的值。

## 回归防线

`src/agent/tools/memory.test.ts`「prepareArguments 的输出必须通过本工具自己的 JSON schema」：
对每个工具、多组代表性输入，断言 `matchesJsonSchema(tool.parameters, prepareArguments(input))`。
新增带 `prepareArguments` 的工具，照抄这条测试。

## 可选演进字段也要成对归一

另一次 `memory_capture` 真机失败来自填齐可选字段：`evolvesFromId: ''` 搭配合法枚举 `evolvesRelation: 'enriches'`。归一只丢空 id、留下关系，虽然 schema 通过，Main 成对校验仍拒绝；改用只传必要字段的调用才成功。

仅将「显式空白字符串 id + 合法关系枚举」视为未指定演进并成对丢弃。关系先 trim/小写；非空 id 缺关系、缺 id 键却给关系、非字符串 id 或非法关系仍拒绝，不得统统降级成新写入。Main 校验不放宽。

回归覆盖完整占位载荷、对象/JSON 字符串、两次归一幂等，以及 `prepareArguments → schema → execute → Main parse`；真正成对的演进参数保持不变。隔离真机用 OpenAI `gpt-4.1-mini` 与 xAI `grok-4.6` 直接调用完整占位载荷，两者均返回 `inserted`。

## 截图工具的互斥可选参数也会被填空

`vetd_screenshot` 真机验收中，GPT 发送 `{frame: '', frames: ['', ''], all: true}`。
这些字段能通过类型校验，但 renderer 会把空字符串和空列表也计为选择模式，报只能选一种。
在 worker 的 `prepareArguments` 中先完成通用类型归一，再仅移除空 `frame` 和全空字符串
`frames`；非空冲突、混合脏列表和错误类型保持原样，仍由既有校验拒绝，不放宽导出等其它工具。
回归见 `src/agent/tools/design.test.ts`。隔离 Electron/CDP 9333 重启 worker 后，
DeepSeek `auto/deepseek-v4.1-flash` 与 OpenAI `auto/gpt-6.1-sol` 都自主完成一次批量截图、
一次总览 read 并识别 alpha/beta；GPT 复验仍带全空可选字段，工具已正常执行。

## 批量工具的按动作可选字段也会被填齐

`browser_act` 第一次双厂商真机检查中，DeepSeek 只传每步需要的字段，可以完成整批；GPT 则给
click/fill/wait 每一步都填齐 schema 的所有可选字段（含空 ref、空 url、values: [] 等），触发
严格的按 action 字段检查。GPT 回退为单步工具后虽然完成任务，批量优化实际没有生效，不能算验收通过。

worker 必须在 `prepareArguments` 阶段按 action 白名单去掉**不属于该动作**的字段，再移除空白
ref/target/role；无 target 时清掉只用于标签定位的 role/nth。不得放宽 Main：非空 ref+target 冲突、
缺少必需载荷、坏类型和越界序列依旧拒绝。测试复用真实 GPT 载荷，覆盖归一 → schema → execute。
验收必须读 Main 权威工具结果，确认 `browser_act` 本身无错误并报告全部步骤完成，而非只看模型说成功。

回归：`src/agent/tools/browser.actions.test.ts`；实现：`src/shared/browser/actions.ts`。
修复后重启隔离 Main/worker，两家模型均只用 navigate + act 完成四步，Main 权威历史的
`browser_act` 均为 `isError: false`、`completed: 4`，且观察结果包含各自输入的唯一标记。

## 原生插件的可选字段占位

`codekiln.memory` 的隔离真机验收中，DeepSeek 省略新增记忆的 `id`，而 OpenAI Responses
将可选字段填齐为 `id: ''`；原实现误入“更新已有记录”，模型反复失败。原生插件作者 API
不提供 worker 侧 `prepareArguments`，不能假设 handler 能修复已经被宿主 schema 拒绝的参数。

插件清单应先**显式接受有意义的可选占位**（如 nullable 可选类型和空日期），再在领域校验前
仅移除已声明可选字段的 null/空串；必填 ID、非空非法 ID、错误类型与跨项目访问仍拒绝。
新增和更新的身份边界不放宽，不能把任意错误 ID 降级成创建。回归应同时调用真实
`validateToolArguments` 与插件处理器，不只直接调存储函数。

回归：`examples/plugins/memory/test/main.test.mjs` 中真实 OpenAI 占位载荷；实现：
`examples/plugins/memory/params.mjs` 与 `enso-plugin.json`。2026-11-25 隔离宿主中
DeepSeek `auto/deepseek-v4.1-flash`、OpenAI `auto/gpt-6.1-sol` 均实际使用全部 7 个记忆工具，
工具结果无语义失败，正文与待办持久化已核验。

## 相关代码

- `src/shared/memory/toolParams.ts` — `normalizeMemoryCaptureParams` / `parseMemoryCaptureRequest`
- `src/agent/tools/memory.ts` — schema 声明
- `src/agent/tools/ensoApp.ts` — 同类「归一在校验之前」的注释
- `src/tooling/productCapabilityCoverage.fixture.ts` — `matchesJsonSchema`
