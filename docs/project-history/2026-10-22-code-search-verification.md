# code_search 内置接入验收记录

> 本文保留首次接入时的验收范围；后续可靠性修复及双厂商补验收见
> [2026-10-30 记录](2026-10-30-code-search-reliability.md)。

## 范围

实现受限本地代码检索 + Devin Fast Context，复用已有 Devin 登录。
默认关闭、账号显式选择；不增加 MCP、DSH 插件、另一份凭据或通用模型后端。
行为契约见 [内置代码搜索](../engineering-reference/main/code-search.md)。

## 自动验证

- `pnpm typecheck`：通过。
- `pnpm lint`：通过；仓库相邻 GitChangesView 存在非阻断的已有提示。
- `pnpm test`：17 项 Node 脚本测试通过；Vitest 824 文件、9353 用例通过，
  2 文件 / 7 用例按平台和 live 开关跳过。
- `pnpm build`：通过；保留既有动态导入 / chunk 大小警告。
- `pnpm knowledge:check`：无坏链接；已有知识条目结构警告未扩大本次范围。

安全问题分别先写失败回归后修复：子目录必须从 cwd 读取祖先 ignore，不能用
显式子目录绕过被忽略目录；每次查读验证 cwd→root→file；最终片段绕过缓存；
凭据目录作为 cwd 时不能丢绝对敏感前缀；截断同步裁剪结构化结果并返回 partial；
模型不能通过 Enso 能力自行打开代码外发工具；冷 worker 的账号配置先于 spawn 排队。

## 隔离 Electron 真机

使用独立 `/tmp/enso-code-search-verify` userData、CDP 9333，核对监听 PID
环境，未修改真实安装实例的 userData。仅使用人工创建的临时示例仓库，
没有把 EnsoCode 源码或用户项目送到云端。

1. 初始默认列表含 `code_search`，账号为 null；设置页有明确的代码外发提示。
2. Devin 登录在既有订阅入口完成后，代码搜索能选择同一账号，无新增登录流程。
3. 本地假主模型发起真实 `code_search` → Devin 云端返回 `src/price.ts:1–3`，
   工具耗时约 3.2 秒。`web_search` 仍同时存在于工具目录。
4. 真实 `swe-1-6-slow` 主模型自主调用同一工具并正确总结文件及行号，
   搜索耗时约 2 秒，整轮约 6 秒。
5. Main 真实创建隔离 worktree；只在 worktree 的第 2 行加入
   `WORKTREE_ONLY_MARKER`。该会话搜索命中该标记，文件引用指向 worktree，
   不指向主树。
6. `reloadConversation` 后成功结果仍存在。JSONL 只有外层 `code_search`
   调用和结果，未出现内部 `restricted_exec` / `ANSWER` 调用，也未出现会话 token 前缀。
7. 在工具调用出现后主动中断，约 63ms 返回取消错误，没有迟到源码片段。

## 尚未验收

当前可用的真实登录只有 Devin；本地假模型不能算第二个厂商。
**双厂商主模型真机验收仍缺一组**，不能以 mock 或模型名称推断厂商来凑数。
Windows 文件围栏的真机验证未执行；私有接口未来兼容性、价格和账号授权不作保证。
本次未打包安装、发版或提交。
