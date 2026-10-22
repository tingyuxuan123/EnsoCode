# 内置代码搜索

`code_search` 是普通本地父会话的可选工具。它复用 EnsoCode 的 Devin OAuth
账号，不是 MCP、不创建普通子代理，也不构建向量索引。

## 使用与数据边界

在「设置 → 内置工具 → 代码搜索」手动打开，并明确选择已登录的 Devin 账号。
开关和工具目录在新会话生效；账号失效或切换会即时取消旧搜索。没有可用账号时
不猜测另一个账号，不回退主会话模型。SSH、类型化子代理、Bot 和锁定 Enso
会话不注入此工具。已有 `web_search` 不变。

参数为 `{ query, path? }`，path 只允许相对当前会话 cwd 的子目录。隔离 worktree
使用自己的 cwd，不搜索主仓库的副本。查询、目录布局、查读过程中选中的代码及
内部检索对话会发送到 Devin/Windsurf 私有服务。敏感文件名过滤不是内容级脱敏，
普通源码仍可能包含硬编码秘密，不能把“只读”或“隔离上下文”宣传为代码不出云。

## 职责分层

- `shared/codeSearch.ts`：脱敏配置与未知数据收窄；设置仅存 accountKey。
- Main `agentHost`：校验凭据存在性、配置去重、单调 revision、worker ready 重推。
- `codeSearchHost.ts`：worker 全局有界并发、同会话串行、取消与迟到结果守卫。
- `tools/codeSearch.ts`：schema、当前会话 cwd、结构化结果、校验后的文件引用。
- `codeSearch/local.ts`：无 shell 的文件围栏与查读，祖先 `.gitignore` 规则、硬排除。
- `codeSearch/searchLoop.ts`：独立内存搜索历史、6+2 轮有界循环、答案重读与输出预算。
- `codeSearch/completion.ts` / `protocol.ts`：私有 Fast Context RPC、严格 framing、
  有界解压、脱敏错误；不替代现有 Devin 聊天接口，不删除共享聊天凭据。

主会话 JSONL 只记录外层工具调用与结果，不记录内部搜索消息。
结果区分 `success`、`partial`、`no_matches` 和 `error`；`no_matches`
只针对已检查范围，不证明整个代码库不存在实现。

## 安全与生命周期

路径同时做词法、realpath、各级 symlink 与文件身份检查；最终片段重读，
不能复用搜索缓存作为最终证据。POSIX 文件打开使用 O_NOFOLLOW；Windows
不应宣称完全消除了文件系统 TOCTOU。硬排除不可被 `.gitignore` 反忽略放开。

查询最长 8192 字符，90 秒总预算（含队列），每轮最多 4 条结构化只读命令，
单文件 512 KiB、总扫描 512 个不同文件、累计本地输出 192 KiB；最终最多
8 个文件、16 个行区间、模型可见正文 32 KiB。截断与不完整必须显式报告。

内部模型的 `restricted_exec` schema 只声明 `command1` 至 `command4`。兼容上游
响应偶尔带到 `command16` 的情况：只校验和执行前四条，后续编号命令绝不执行，
回执说明未执行部分，结果标为 `partial` 并带 warning；不增加单轮执行量或总预算。
缺 `command1`、带其它未知字段（包括 `command17`）或前四条格式错误时，整批不执行，
返回明确格式回执让模型在原有 6+2 轮和总时限内纠正，不能把内部参数错误当成外层
`{ query, path? }` 调用错误。纠正不接受 shell 字符串、不扩大路径或读取预算；
未知工具和执行命令中的越界路径仍直接拒绝。

注销、切账号、停止、会话释放均取消旧任务。取消返回后，底层 I/O 若尚未结束，
并发槽仍须等实际收尾才释放，不能因发出 abort 就无限启动替代任务。
JWT 缓存仅在该次调用内部使用，不跨账号或搜索任务共享。

## 验证与升级

回归测试位于 `src/agent/codeSearch/`、`codeSearchHost.test.ts`、
`tools/codeSearch.test.ts`、`supervisor.codeSearch.test.ts` 及 Main/settings
对应测试。全部 fixture 使用临时目录或假网络，不读取真实用户凭据。

全量执行 `pnpm typecheck && pnpm lint && pnpm test` 和 `pnpm build`。
真机验证使用独立 userData/CDP 端口和已允许外发的测试仓库，并由两个不同厂商
主模型调用同一工具。真实账号或服务不可用时明确记录未验收，不能把离线
fixture 或构建成功当作私有协议线上兼容证据。

协议及素材来源、版权和免责声明见根目录 `THIRD_PARTY_NOTICES.md`。
