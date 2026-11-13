# 2026-11-12 第二批 worker 可靠性移植

用户指定依次实现五项；基于个人分支 `a00cf37f` 及上一批未提交稳定性修复，
不覆盖并行品牌/UI 改动，不提交、不推送、不发布，不升级 Pi SDK。

## 行为差距、所属层与必改文件

1. **排队消息误判僵尸回合**（上游 `48cf7663`）
   - `src/agent/supervisor.ts`：只按会话事件计数判断等待窗口内活跃，命令不算产出；
     SDK 仍忙但确实活跃时继续等，静默仍有限失败。保留已经记录的原轮终态以完成收束。
   - `supervisor.agentDispatch.test.ts`：三种复现场景先 RED，再 GREEN，整文件 89 例通过。
2. **工具声明稳定排序**（上游 `464e0251`，适配当前 SDK）
   - `toolOrder.ts`、`toolOrder.test.ts` 及 supervisor runtime 注册：不改持久化消息、schema、
     权限或注册顺序。共享 runtime 两出口排序，公开 `onPayload` 最终排序 HTTP 工具声明。
   - 真实 SDK 工具从 transcript `toolsAdded` 解析，仅排 `Context.tools` 不生效；新增
     OpenAI Responses / Anthropic Messages 实际 payload 测试，先观测 `z,a` 再修为 `a,z`。
   - 原有 payload hook（包括异步/替代 payload）先执行，再稳定化；原生无名工具保留槽位。
3. **按工具调整输出外置预算**（上游 `e320ef81`，中文适配）
   - `toolOutputBudget.ts` 及测试：`web_fetch` 下限 160 KiB，覆盖中英文 5 万字符正常页与
     续页提示，而非上游 64 KiB（中文页仍被外置）；`read` 自管，其它工具/异常大结果保持外置。
   - 不改变 SSRF、网页不可信提示、分页 offset 或 artifact 回读边界。
4. **输出上限有限续写**（上游 `ae31f4e8`，适配 SDK 1.4）
   - `outputLimitRecovery.ts`、测试及两个 ResourceLoader 注册：纯文本/思考 `length`
     达实际物理模型上限才续，最多三次，真实新 run 重置；未知用量、错误、取消不续。
   - 截断工具参数仍由 SDK 拒绝，不执行、不重放；只追加拆分指导供 SDK 后续请求使用。
   - `sessionAdapter.ts`：空回复恢复跳过 `length`，保留思考前文且不额外续跑。
5. **后台通知溢出告知**（上游 `d79511f4`，补齐合并场景）
   - `reminderQueue.ts` 及测试：保留最新结果与唯一累计告知，容量含告知一格。
   - 独立评审发现投递失败重排会漏计旧/新告知；补 RED 用例，识别入队告知并合并计数，
     两批原先各丢 2 条、合并再丢 2 条时正确报告 6，而不是 5。

## 范围外

不新增 IPC、工具 schema、设置或 UI，不接入微压缩、turn_discard、改前须读、市场改版、
Docker，也不改通知持久化字节上限。自动续写有额外请求成本，三次是新增续写上限，
不是重定义现有 SDK 工具错误/供应商重试循环的全局上限。

## 验证证据

- 各项 TDD：排队 3 RED；排序 4 RED 后补真实 HTTP payload 2 RED；输出预算 2 RED；
  续写 6 RED；通知 9 RED 后补合并计数 2 RED。实现后相关测试 GREEN。
- `pnpm typecheck && pnpm lint && pnpm test` 退出 0；Vitest **1286 文件、13503 测试通过**，
  2 文件/15 测试沿用既有跳过；Node 脚本测试两组 43 + 25 通过。
- lint 仅保留既有 `GitChangesView.tsx` 冗余 Fragment info；本批编辑文件格式检查通过。
- 隔离 Electron dev：CDP 9333，临时 userData/工作区。仅拷贝选定网关配置到 0600 文件，
  没有复制真实项目/会话，凭据不出现在 renderer 返回值或验收日志。
- 两个实际厂商模型（经用户已配置网关）：`auto/deepseek-v4.1-flash`、`auto/gpt-6.1-sol`。
  各自自主调用 `read README.md`，Main 权威历史包含成功工具结果与标记 `EN5-READ-7341`；
  新回合分别在 seq 33、35 收束成功。
- 把隔离配置的两模型输出上限设为 128，要求长列表，二者 Main 权威历史均观测到
  **4 条 `length/output=128` assistant + 3 条恢复 custom 消息**，随后 idle，不无限续写。
  DeepSeek 前几段为思考输出，OpenAI 从被截断位置接正文；不把模型内容衔接质量等同代码保证。
- 截断工具不执行、取消/错误不续、正常结束即停、下一用户 run 重置、思考前文不删除，
  使用真实 Pi SDK 与确定性 provider 夹具验证，不靠模型偶然输出代替边界测试。
- 最终复查修正了实际 HTTP 排序和通知失败重排计数；独立复核未发现剩余 P1/P2。
- 用户要求继续收尾后，针对当前含其它并行改动的工作区再跑本批六文件定向测试：
  **161 项全部通过**，`git diff --check` 通过；不将其它并行微压缩、品牌/UI 改动归为本批。
- 收尾时重跑最新工作区完整门禁同样退出 0：`typecheck`、`lint` 通过，Vitest
  **1292 文件、13560 测试通过**（2 文件/15 测试既有跳过）。此数字包含其它并行改动，
  不代表本批单独新增测试数。
- 本批隔离 Electron PID 95411 已退出，确认本批临时 userData 无打开文件后，删除临时
  userData（含复制的凭据及测试会话）与验收项目。9333 已由另一实例占用，不擅自关闭它。
