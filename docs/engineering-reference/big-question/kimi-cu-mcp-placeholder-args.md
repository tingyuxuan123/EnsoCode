# Kimi CU MCP：模型填满可选参数，触发互斥校验

## 症状

接入 Kimi CU（`kimi-cu mcp -s user`，0.6.8）后，模型调用界面工具反复失败，看起来像 Kimi CU 自身的 bug：

- `get_app_state` 报 `error: AX pagination requires mode=ax`，或 `AX pagination does not accept screenshot arguments`；
- `list_windows` 返回空列表，`get_window_state` 报 `window_id 0 not found`；
- `js` 报 `EXEC_ERROR: kimi is not defined`；
- 改对 js 写法后又报 `NATIVE_PIPE_ERROR: runtime socket connect failed: Connection refused`，但普通 kimi_cu 工具调用正常。

## 根因

三个问题叠在一起，只有前两个在本仓库内。

1. **占位参数被当成真实参数。** 某些模型会给每个可选字段填零值（会话记录里 gpt-6.1-sol 的 kimi_cu 调用有 25/35 条这样做，Claude、DeepSeek 一条都没有）：
   `app: ""`、`window_id: 0`、`snapshot_id: ""`、`offset: 0`、`limit: 120`、`additional_window_ids: []`、零尺寸 `rect`。
   这些值都能通过 JSON schema，但 Kimi CU 按语义处理：出现 `limit` / `offset` / `snapshot_id` 就进入 AX 分页，
   分页要求 `mode=ax` 且不接受截图参数；空 app 过滤出空列表；0 号窗口不存在。schema 无法表达这些字段间的互斥，
   所以只有服务端报错。
2. **上游 `js` 描述没说 cell 里怎么调用 KimiCU。** 真实入口在
   `KimiCU.app/Contents/Resources/node-repl/packages/kimi-cu/public/index.mjs`：
   `let { kimiCU } = await import('@kimi/cu')`；全局只有 `nodeRepl`（`write` / `rpc` / `track`）。
   模型只好臆造全局 `kimi`。用 `const` 声明也能运行，但之后每个 cell 都会提示
   `kimiCU was declared with const`，因为顶层绑定跨 cell 保留。
3. **（KimiCU 外部问题）残留的 runtime socket。** js 通道走 `~/Library/Application Support/KimiCU/runtime.sock`。
   实测该文件和 `runtime.sock.lock` 停留在旧时间，lock 里记录的 `device`（16777232）与当前卷（16777231）不一致；
   常驻的 `kimi-cu service` 没有打开这个 socket，连接被拒。服务的设计是"证明不了归属就不删"，所以只重开 KimiCU 界面无效，
   界面不会重启 launchd 下的服务进程。

## 修法

- `src/agent/mcpKimiCu.ts` 的 `normalizeKimiCuArguments` 在 `mcp.ts` 里作为 kimi_cu 工具的 `prepareArguments`，
  在 schema 校验前运行；`execute` 里再跑一次（幂等，不依赖调用方是否走过 prepare）。规则**只删除可选键、不新增、不改值**：
  - 空白字符串、空数组、`pid` / `window_id` 为 0、宽或高不大于 0 的 `rect` 视为未传；
  - `get_app_state` 非 `mode=ax` 时删除分页键；`mode=ax` 且在分页时删除截图键；
  - schema `required` 里的键一律保留（例如 `type_text.text: ""`）；坐标 `x/y: 0`、`index: 0` 是合法值，不删。
- 给 kimi_cu 的 `js` 描述追加 `@kimi/cu` 用法（`KIMI_CU_JS_HINT`），沿用 `get_window_state` 补 app/pid 说明的做法：只补文案，不猜目标应用。
- 不改其他 MCP server：只按 `mcpNamespaceName(server.name) === 'mcp__kimi_cu'` 生效。
- socket 问题不在仓库内修复，恢复步骤如下：确认 `lsof` 无进程持有旧文件后，把 `runtime.sock` 和 `runtime.sock.lock` **移走备份（不要删除）**，
  再 `launchctl kickstart -k gui/$(id -u)/ai.kimi.cu.service`。服务会重建 socket 和 lock，lock 的 device 与当前卷一致。
  服务二进制提示 "do not delete a live socket or its .lock file"，所以务必先确认无人持有。

## 回归防线

- `src/agent/mcpKimiCu.test.ts`：用 KimiCU 0.6.8 `tools/list` 的真实 schema 和会话里的完整占位载荷；
  每个用例断言归一结果通过 `matchesJsonSchema` 并且两次归一幂等；覆盖 full/省略 mode/ax 分页/ax 续页/保留截图参数/required 与坐标 0。
- `src/agent/mcp.test.ts`「McpManager Kimi CU 工具描述」：`prepareArguments` 已接线、`callTool` 收到归一后参数、
  `js` 描述包含 `@kimi/cu`、其他 server 没有 `prepareArguments`。
- 真机证据：近 80 个会话里 60 条真实 kimi_cu 调用，归一后经 pi `validateToolArguments` 全部通过，
  分页冲突为 0；归一后的 ax 分页与带 `rect` 的 image 载荷直接发给 KimiCU 0.6.8 都成功；socket 恢复后
  js 里 `kimiCU.list_apps` / 分页 `get_app_state` 正常。
- 升级 KimiCU 后先用 `tools/list` 重新核对 schema：新增互斥字段要补规则，`@kimi/cu` 入口改名要改提示。

## 相关代码

- `src/agent/mcpKimiCu.ts`：占位归一与 js 提示
- `src/agent/mcp.ts`：`toToolDefinition` 中的 Kimi CU 适配
- [tool-prepare-arguments-schema-drift.md](tool-prepare-arguments-schema-drift.md)：同类"归一产物必须满足 schema、只改已声明键"规则
