# 个人更新日志

个人发布时，将确认要随包发布的内容写入 `release-notes/<version>.md`。文件名中的版本与
`package.json` 和 `personal-v<version>` tag 一致，新日志首行严格为 `# Collabra <version>`；
之后填写实际变更。使用 UTF-8 Markdown，正文不能为空，整个文件最多 24 KiB，不能是符号链接。
历史版本保留原有的 `# 小满 <version>` 或 `# EnsoCode <version>` 标题，校验仍兼容。

提交发布版本前运行 `node scripts/personal-release.mjs notes`。CI 将同一份版本日志及自动附加
的通道安全说明写入 GitHub Release 正文和个人 feed。草稿或 README 不能替代版本文件；
只构建 Windows 或手动构建 Mac artifact 时，不需要为该版本补个人日志。

## 未发布草稿

- 发现或下载新版本后可查看更新日志；关闭自动更新后，仍可手动检查并下载更新。
- 扩展页新增本地插件作者指南，源码仓库提供模板生成、类型声明和安装前静态校验。
- Codemode 提示当前会话中必须顶层调用的工具；内置可复现审查把检查候选和有证据的结论分开。

草稿不是任何已发布版本的日志；仅在准备新个人版本时按实际发布范围整理到对应版本文件。
