# 2026-11-12 上游稳定性补丁选择性移植

基线：个人分支 `a00cf37f`，不整包合并上游、不改变版本和发布配置。

## 行为差距、所属层与必改文件

### BGE-M3 长记忆

上游来源：`afaa61f9` / [#200](https://github.com/J3n5en/EnsoCode/pull/200)。

- Main embedding 层配置错误地将 BGE-M3 限在 512 tokens，导致长记忆丢失结尾。
- `src/main/services/memory/embedding/registry.ts`：恢复原生 8192 上限。
- 同目录 `gguf.ts`：实际截断每个 provider 实例只警告一次，不记录正文。
- 同目录 `gguf.test.ts`：覆盖长文本不同结尾、8192 边界、特殊 token 预算及归一化。
- 不变更维度、模型文件或其它 embedding 上限；不自动删除或重建已有向量。

### 远程 Web 连接

上游来源：`829d82f2` / [#201](https://github.com/J3n5en/EnsoCode/pull/201)。

- `packages/pair/src/heartbeat.ts`：周期探测连续两次 8 秒超时才判死；任意帧清零，
  15 秒周期不得覆盖在途 deadline。手动前台探活仍单次超时，判死只回调一次。
- `packages/phone/src/client.ts`：消费上游新关闭码 4001（无 reason 也识别），沿用本地已有
  停链、保缓存和显式接管逻辑，不重复引入上游状态。1008 仍优先视为凭据撤销。
- 上述同目录测试覆盖容错、单次结算、旧版关闭码、新版关闭码及缓存语义。
- 不修改本地中继发送端（继续 `1000/replaced`）和 Android，避免让现有消费端互踢；
  本批只是让 Web 兼容新旧中继，不声称 Android 已支持无 reason 的 4001。

### 模型流防挂死

上游来源：`c33a1364`，按个人分支现有流守卫实现适配，不直接套上游补丁。

- `src/agent/streamGuard.ts`：远端单次请求 60 分钟硬截止，不随数据事件重置；超时
  中断上游并沿用 SDK 有限重试。取消、正常结束和错误都清理寿命计时器。
- 保留个人分支的显式 `isLocalModel` 权威判定，localhost 云网关不自动豁免。
- 同目录 `streamGuard.test.ts` 覆盖远端/localhost 涓流、本地豁免、快照与清理；
  `streamGuard.sdk.test.ts` 使用真实 Pi SDK 和确定性假流验证重试预算及回合结算。
- 不改变工具 schema、审批、自动重试次数、虚拟模型路由或用户设置。

## 明确不做

本批不纳入插件市场/模型选择器/UI 改版、Docker 部署、微压缩、自动续写、改前须读、
turn_discard 或工作流恢复等新机制，不升级 Pi SDK、不打包、不发版、不安装更新。

## 验证

- BGE-M3：先观测两个功能缺失断言失败，再实现通过，并补充原生上下文边界测试。
- 远程连接：新增测试 RED 为 8 失败，最小适配后 72 测试全部通过。
- 模型流：持续涓流的单测及 SDK 集成共 3 个 RED 失败，实现后通过。
- `pnpm typecheck && pnpm lint && pnpm test` 通过；Vitest 1282 文件、13448 测试通过，
  2 文件/15 测试沿用既有跳过。Node 脚本测试两组 43 + 25 通过。
- lint 保留 `GitChangesView.tsx` 的既有冗余 Fragment info，不修改无关 UI。
- `pnpm --filter @enso/phone typecheck && pnpm --filter @enso/phone build` 通过。
- 独立只读复查未发现 P1/P2 问题；实际网络行为不以 mock 或评审结论替代真机验收。
- 隔离 Electron dev 使用临时 userData、CDP 9333 和本地假供应商完成正常消息链路：
  新建项目与会话、发送、观测新回合 `turn-completed`（seq 25）、Main 权威历史返回
  `fake-ok`。未接触用户真实配置或账号；这只验证正常收发，不冒充真实厂商/手机网络验收。
- 60 分钟硬截止使用假时钟和真实 SDK 集成验证，未等待真实 60 分钟；BGE-M3 使用
  可预测 tokenizer/model 夹具验证预算，未下载原生模型或重算已有记忆。
- 隔离服务停止后确认 9333/8899 端口已释放，临时 userData 与项目已删除。
- 额外 `pnpm knowledge:check` 未通过：既有检查器把 `AGENTS.md` 中 `<绝对路径>` 的
  Markdown 链接连同尖括号解析为文件名，误报两条记忆链接不存在；实际两个文件都存在，
  本批未改 `AGENTS.md` 或检查器，不混入无关修复。
