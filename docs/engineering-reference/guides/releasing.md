# 桌面版发布与更新验收

## 发布边界

- `package.json` 是版本权威；tag 必须为 `v<version>`，旧版本已被安装也要递增版本。
- `.github/workflows/build.yml` 在构建前运行 `pnpm release:check`。tag 构建只上传到
  GitHub **草稿 Release**，不会自动公开。手动 workflow 构建只保留 Actions artifacts。
- `scripts/release.mjs` 校验 tag/版本、合并 Mac 两架构清单、检查实际安装包大小及 SHA-512，
  并生成 `SHA256SUMS`。禁止重跑构建覆盖已公开 Release；出错后使用新版本。
- 当前更新源为 `tingyuxuan123/EnsoCode`。上游官方包不会自动切换到这个更新源。

## macOS 签名

本地 `mac.identity: '-'` 仅用于 ad-hoc 完整性签名，不等于 Developer ID，也不是公证。
`CSC_IDENTITY_AUTO_DISCOVERY` 不会覆盖显式的 `'-'`。CI 读取证书后通过
`-c.mac.identity` 显式选择 Developer ID Application，执行公证与签名验证。

GitHub Actions Secrets（仅在仓库设置中配置，不写代码、日志或聊天）：

- `APPLE_CERTIFICATE`：包含私钥的 Developer ID Application `.p12` 的 base64。
- `APPLE_CERTIFICATE_PASSWORD`：`.p12` 导出密码。
- `APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID`：公证身份。

无证书时 CI 允许生成 ad-hoc **手动试装包**并留在草稿；不能把它称为自动升级验收通过。
从现有 ad-hoc 应用迁移到正式签名版可能需要首次手动安装，再验证后续同签名更新。
不要禁用签名或完整性校验来强行实现自动升级。

## 一轮发布

1. 独立提交修复与发布流程变更；升级版本，执行 `pnpm release:check`。
2. 本地试装：`pnpm build && pnpm exec electron-builder --mac --arm64 --publish never`。
   使用独立输出目录时：追加 `-c.directories.output=dist/test`，随后
   `node scripts/release.mjs verify dist/test`。产物留在 `dist/` 下，避免进入源码 lint 扫描。
3. 推送分支与新 tag。Actions 构建多平台包、跑原生依赖冒烟，合并
   `latest-mac.yml`，验证各平台清单引用的安装包并上传 `SHA256SUMS`。
4. 从草稿/Actions 下载对应架构包，在隔离 userData 试启动；检查版本、核心功能和原生依赖。
   Mac 自动更新必须保留 ZIP 与合并后的 `latest-mac.yml`，不能只上传 DMG。
5. 真实升级前正常退出所有 EnsoCode 窗口并备份旧应用与整个 userData。手动覆盖安装
   不删除用户数据。不要在旧应用仍写盘时用副本修改同一 userData。
6. 检查旧会话、设置和项目仍存在，新功能正常。正式自动更新还要从旧版本走完
   检查→下载→校验→安装→重启，并确认无忙任务被打断。两厂商模型工具验收须单独记录。
7. 全部验收通过且具备正式签名条件后，由维护者在 GitHub 将草稿公开为 latest。
   未验收/无正式签名的测试包保持草稿，不冒充已发布更新。

GitHub `gh` token 与 Git SSH 推送权限互相独立。`gh auth status` 失败时需维护者在本机
终端执行 `gh auth login -h github.com`；不要在聊天中提供 token。
