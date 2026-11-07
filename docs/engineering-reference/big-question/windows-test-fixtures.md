# Windows 测试夹具与文件身份

## 症状

同一套全量测试在 Windows 出现数百失败：symlink `EPERM`、PATH/路径分隔符差异、
`0600` 断言失效、shebang 不能执行、Git checkout 改写换行，以及数据库或子进程占用临时目录。
单独运行成功的 700 文件扫描在全并行时可能超过默认 5 秒。

## 根因

- Git 的系统 `core.autocrlf=true` 将 LF 源码变成 CRLF，formatter、文档预算和源码副本比较同时失败。
- 无管理员/开发者模式的 Windows 不能创建普通文件符号链接，但能创建目录 junction。
- 用本机 `node:path` 解释模拟 macOS 身份、Linux PATH 或远端 SSH 路径会改变测试目标语义。
- POSIX mode、shebang、`/bin/sh` 和 `O_NOFOLLOW` 不是 Windows 能力。
- POSIX 允许 unlink 打开的文件；Windows 要先关闭 SQLite/文件句柄，并等待真实子进程释放目录。

## 修法

仓库使用 `.gitattributes` 固定 LF；Git fixture 固定本仓库换行策略。测试真实 junction 的
父目录逃逸/别名，严格叶文件链接则仅注入该叶元数据，保持真实 IO 和拒绝/不写出边界断言。
shell fixture 使用 Git 自带 shell，JS executable fixture 在 Windows 以真实 Node 子进程启动。
计时语义使用 fake timers，真实集成使用局部有界预算，不改产品 timeout。

排查也发现两处真实文件读取缺少 Windows 守卫：仅 `open(O_NOFOLLOW)` 无法保证拒绝链接。
`BrowserDataFile.read()` 和 `PendingNotificationStore.load()` 现先 `lstat` 拒绝非普通文件/
符号链接，再将打开后的 `fstat` 与先前的 **BigInt dev/ino** 比较，不一致则不交付正文，
并始终关闭 fd。这防止检查与 open 之间路径被替换；不是通用父目录沙箱或 Windows ACL 改造。

## 回归防线

- `browserHistory.test.ts`、`pendingNotifications.test.ts`：选定叶的链接元数据、检查/open
  之间真实文件替换，均先验证错误内容泄露的 RED，再验证拒绝和 fd 关闭。
- 原有路径逃逸、链接去重、权限、SSH、Git、完整扫描断言保留，不新增平台 skip。
- 使用未手工补 PATH 的 `pnpm typecheck && pnpm lint && pnpm test` 验证。

## 相关代码

- `src/main/services/browserHistory.ts`
- `src/agent/pendingNotifications.ts`
- `test/helpers/shell.ts`
- `scripts/release.test.mjs`
