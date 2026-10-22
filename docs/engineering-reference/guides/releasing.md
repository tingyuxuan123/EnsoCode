# 桌面版发布与更新验收

## 新会话如何执行

用户说“帮我发版 / 推送这次更新 / 打包升级”时，以本文为操作手册，先核对当前源码，
不要依赖旧会话中的版本号、构建链接、登录状态或测试结论。单纯“修改某个功能”不等于授权发布。
先说明范围：本地试装、远程草稿、正式公开分别做到哪一步；缺证书时默认走手动试装草稿，
只有用户明确要求正式发布且验收/签名条件满足，才能公开为 latest。

固定顺序：**核对环境 → 修复与版本递增 → 全量检查 → 本地包验证 → 提交/tag →
远程构建 → 草稿产物验收 → 安装验收 → 经授权正式公开**。遇到外部阻塞仍可完成前面的安全步骤，
但不能把未完成的阶段报告为成功，也不要为了“全绿”跳过测试或安全校验。

## 发布边界

- `package.json` 是版本权威；tag 必须为 `v<version>`，旧版本已被安装也要递增版本。
- `.github/workflows/build.yml` 在构建前运行 `pnpm release:check`。tag 构建只上传到
  GitHub **草稿 Release**，不会自动公开。手动 workflow 选择分支时只保留 Actions artifacts；
  手动选择 `v<version>` tag 时，同样会生成草稿 Release。
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
4. 从草稿/Actions 下载对应架构包，检查版本、核心功能和原生依赖。
   开发实例可使用 `ENSO_USER_DATA_DIR` 与独立 `ENSO_CDP_PORT` 做隔离真机验证，
   先读 [enso-cdp skill](../../../.agents/skills/enso-cdp/SKILL.md)。**打包版不接受该 userData 环境覆盖**，
   不能假定设置这个变量就能安全启动第二份打包应用；需隔离 OS 用户或在正常退出旧应用后试装。
   Mac 自动更新必须保留 ZIP 与合并后的 `latest-mac.yml`，不能只上传 DMG。
5. 真实升级前正常退出所有 EnsoCode 窗口并备份旧应用与整个 userData。手动覆盖安装
   不删除用户数据。不要在旧应用仍写盘时用副本修改同一 userData。
6. 检查旧会话、设置和项目仍存在，新功能正常。正式自动更新还要从旧版本走完
   检查→下载→校验→安装→重启，并确认无忙任务被打断。两厂商模型工具验收须单独记录。
7. 全部验收通过且具备正式签名条件后，由维护者在 GitHub 将草稿公开为 latest。
   未验收/无正式签名的测试包保持草稿，不冒充已发布更新。

GitHub `gh` token 与 Git SSH 推送权限互相独立。`gh auth status` 失败时需维护者在本机
终端执行 `gh auth login -h github.com`；不要在聊天中提供 token。

## 常用命令与执行检查点

### 1. 开始前

```bash
git status --short
git branch --show-current
git remote -v
gh auth status
security find-identity -v -p codesigning  # 仅 macOS；不要读取/输出私钥
```

核对 `package.json`、`electron-builder.yml`、`.github/workflows/build.yml` 和目标仓库。
用户的未提交变更不得覆盖或混入发布提交。版本必须大于拟升级的已安装版本；仅修复通常递增 patch，
不复用已安装或已公开的版本。升级版本可用 `pnpm version patch --no-git-tag-version`，
之后再完整检查。先确认目标架构，不在 Apple Silicon 上误交付 Intel 包。

### 2. 本地测试包

以下示例为 Mac arm64、无公证手动试装包；有证书的正式构建交由配置好的 CI：

```bash
pnpm release:check
pnpm build
pnpm exec electron-builder --mac --arm64 --publish never \
  -c.directories.output=dist/test -c.mac.notarize=false
node scripts/release.mjs verify dist/test
codesign --verify --deep --strict dist/test/mac-arm64/EnsoCode.app
ELECTRON_RUN_AS_NODE=1 dist/test/mac-arm64/EnsoCode.app/Contents/MacOS/EnsoCode \
  scripts/smoke-packaged-natives.cjs "$PWD/dist/test/mac-arm64/EnsoCode.app/Contents/Resources"
```

对生成的 DMG 执行 `hdiutil verify <DMG路径>`。可交付至用户 Downloads 的独立版本目录，
同时附安装说明、校验和及验收记录；复制后再校验一次。模型工具改动须按项目规定双厂商真机验证，
结束后关闭隔离实例并清理临时凭据，不修改真实用户配置。

### 3. 推送与观察远程构建

先独立提交经过检查的变更。以下命令仅在用户已授权本轮发布、当前工作树及目标分支确认无误时执行：

```bash
VERSION=$(node -p "require('./package.json').version")
TAG="v$VERSION"
REPO=tingyuxuan123/EnsoCode  # 与本轮核对过的 origin、更新源一致
git ls-remote --tags origin "refs/tags/$TAG"
# 若同名 tag 已存在，先检查其提交和构建状态，不移动或强推 tag。
git push origin HEAD:main
git tag -a "$TAG" -m "EnsoCode $VERSION draft update"
git push origin "$TAG"
gh run list --repo "$REPO" --workflow build.yml --limit 5
```

只有 tag 不存在时才执行创建/tag 推送。fork 首次使用时，维护者可能需要进入
`https://github.com/tingyuxuan123/EnsoCode/actions` 启用 Actions。**启用后旧 tag 事件不会自动补跑**，
确认没有同版本正在运行的任务后，显式触发：

```bash
gh workflow run build.yml --ref "$TAG" --repo "$REPO"
gh run list --repo "$REPO" --workflow build.yml --limit 5
# 从列表核对 ref、SHA 和 run id 后：
gh run view <run-id> --repo "$REPO"
gh run view <run-id> --repo "$REPO" --log-failed  # 仅失败时
```

`queued` 仅表示排队，`in_progress` 仅表示运行中。全部 jobs 成功后再检查
`gh release view "$TAG" --repo "$REPO" --json isDraft,assets,url`，确认仍是草稿且多平台包、
两架构 Mac ZIP、`latest*.yml`、`SHA256SUMS` 齐全。下载并重新校验后才进入安装验收。
不要反复触发重复构建；权限不足或平台构建失败时报告具体阻塞和失败步骤，勿提前公开。

### CI 测试在本地通过、远程被取消

先看 `gh run view <run-id> --log-failed`，不要把 lint 的 info 当作真正失败项。
若 Node 测试报 `Promise resolution is still pending but the event loop has already resolved`，
检查所等待的超时是否只有 `AbortSignal.timeout` / `unref()` 计时器，且模拟请求没有真实网络句柄。
RTK 下载采用会保活的计时器，并在读取响应体结束或失败后 `finally` 清理；独立子进程测试
验证“没有其它活动句柄仍能超时”和“提前失败后进程能立即退出”。不要靠跳过测试或增加随意 sleep 修复。
尽量同时用 `.nvmrc` 指定的 Node 与开发机 Node 运行脚本测试。修复后递增版本并创建新 tag，
重新运行旧 tag 的任务仍会使用旧源码，不能带入新修复。

## 结束时必须交代

向用户分别说明并提供证据，不用一句“更新好了”代替：

- 代码：提交 SHA、目标分支、版本和 tag；是否已推送。
- 检查：类型/lint/测试、原生冒烟、哈希/签名结果，及双模型验收结果（如适用）。
- 构建：run URL、真实状态、草稿或公开状态；本地安装包和校验文件位置。
- 安装：是否实际替换安装、启动的新版本、旧设置/会话是否保留；手动试装不算自动升级。
- 阻塞：缺权限、Actions 未启用、无正式证书、用户尚未退出应用等；说明需要用户做的最小操作。

正在承载本次会话的应用不要强杀或热替换。若退出会中断执行，先交付包、备份/安装步骤与验收清单，
明确等待用户正常退出后继续。临时目录和旧会话中的验收报告不作为下一次发版的通过证据。
