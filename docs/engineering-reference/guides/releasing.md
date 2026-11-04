# 桌面版发布与更新验收

## 默认操作：本地只提交和推 tag，不打包

用户说“发布 / 发版 / 推送更新 / 打包升级”时，默认授权本人的 Mac arm64 同证书个人更新通道，
不是对外正式 latest。单纯修改功能不等于授权发布，不得混入其它未提交开发。

**用户明确要求本地不打包：递增版本、提交 main、推 `personal-v<version>`，其余交给 GitHub Actions。**
不得在本机运行 `electron-builder`、下载 Electron 或用本机构建兜底。CI 失败就读日志修 CI，
不能因为钥匙串、网络或 runner 问题回退本机打包。旧的本机缓存规避方案不再是发版流程。

完整链路：

```text
递增版本 → 完整检查 → 提交并推 main → 推 personal-v<version>
  → CI 校验 tag/版本及 main 祖先关系 → 测试/构建 → 同证书签名
  → 本包哈希/签名/DMG/原生依赖验证 → 上传草稿
  → 重新下载草稿资产并验收 → 公开个人 prerelease（latest=false）
  → 无凭据下载公开资产并验证 → 推进 personal-updates → 验证公开清单
  → 用户自己在软件内下载、安装和重启
```

CI 结束才判断成功；queued / in_progress / artifact 上传成功都不是发布成功。
不强杀承载当前会话的应用，不热替换安装，不把发布成功等同于用户已安装或自动升级成功。

## 版本、仓库与更新源

- `package.json` 是版本权威；个人 tag 为 `personal-v<version>`，正式 tag 为 `v<version>`。
- 版本必须大于已安装和已公开版本。不要移动已有 tag；失败需要改代码时用新版本。
- 本仓库个人源：`tingyuxuan123/EnsoCode` 的 `personal-updates` 分支。
- 个人包使用 `electron-builder.personal.yml` 的 generic 更新源：
  `https://raw.githubusercontent.com/tingyuxuan123/EnsoCode/personal-updates/`。
- 正式包仍使用 GitHub latest；个人流程绝不改变正式 latest，不为个人 URL 放宽正式清单校验。
- 旧正式包不会自动切到个人源；仅首次迁移需要用户手动安装一次同证书个人包。
- 新个人发布必须在同一 tag 提交中提供 `release-notes/<version>.md`。首行严格为
  `# EnsoCode <version>`，其后填写实际变更，使用 UTF-8 Markdown，最多 24 KiB；不能是符号链接。
  [日志格式及未发布草稿](../../../release-notes/README.md)不能替代该版本文件。
  `node scripts/personal-release.mjs notes` 按 `package.json` 版本校验并附加个人证书、非正式发布和重启说明。
  CI 在使用私钥前拒绝不合规的日志；Release 正文和个人清单 `releaseNotes` 都使用这一份内容。
  手动 main 构建不发布，因此不要求本版本日志；旧清单无需补写。

## GitHub Actions 个人发布

`.github/workflows/build-personal-mac.yml`：

| 触发方式 | 行为 |
| --- | --- |
| 推 `personal-v*` tag | CI 构建、验收、公开个人 prerelease、推进个人清单 |
| 在 main 手动 Run workflow | 只产出验收 artifact，不公开 Release，不推进清单 |
| 其它分支手动触发 | 不使用个人签名私钥、不构建 |

签名使用现有 `LOCAL_SIGNING_CERTIFICATE` / `LOCAL_SIGNING_PASSWORD` Secrets，
`build/personal-signing.pem` **只含公钥证书**，指纹固定为：
`CB0DAF252F47DC25E63BCBE4F8D533A5B58844E7`。
名字相同不代表同一证书；重新生成证书或改成 ad-hoc 会破坏现有个人版的自动升级兼容性。

历史 CI 的 P12 未提取出证书。流程现在分别导入库内公钥证书和 Secret 中的私钥，
以指纹与有效 codesigning identity 校验配对，签名后再用固定 designated requirement 验证。
匹配失败必须停止，不关闭签名校验、不重新生成身份、不输出私钥或密码。
所有签名材料在成功或失败后清理；CI 不读取正式 Apple 签名 Secrets。

0.2.19 的 CI 已通过构建、签名和原生依赖验收，但在清理步骤挂起直到 job 超时，未上传或发布。
macOS `security` / trustd 的清理命令不得无界等待：`scripts/personal-signing.mjs` 先删 P12，
每条命令限时 10 秒并终止进程组，最后无条件删除独立临时钥匙串及 sidecar 文件；
`sudo -n` 禁止交互，step 另设 2 分钟上限。公钥信任清理失败可警告，但私钥文件删除失败必须失败。
不要把“清理挂起”误报成构建或签名失败；也不要仅用 Promise 超时而留下原命令继续运行。

构建 job 只有 `contents: read`；只有依赖成功构建的 tag 发布 job 有 `contents: write`。
使用私钥之前检查 tag 对应提交已进入 main，且 tag 与版本一致。持有仓库写权限的人仍能改动 workflow，
证书所有者必须审查会在 CI 执行的代码；祖先校验不能替代仓库权限保护。

### 验收与发布门

1. `pnpm release:check`：版本/tag、类型、lint、全量测试；然后 `pnpm build`。
2. CI Mac arm64 使用原证书打包，不执行 Apple Developer ID 公证。
3. 本包 deep/strict 签名、固定旧证书 requirement、DMG 完整性、原生依赖/内置二进制冒烟均通过。
   包内设计引擎也须实际编译临时画框；历史 runner 须能提交版本，并随包带齐许可文本、
   可修改源码及重建输入。此门在本包和重新下载的草稿 ZIP 上均执行，不替代 UI 安装验收。
4. 只将 ZIP、DMG、blockmap、`latest-mac.yml` 放入发布目录再生成 `SHA256SUMS`，
   不把未上传的 builder-debug 文件混入校验清单。
5. 创建草稿；已公开版本不允许重建覆盖。未公开草稿可在同 tag 重跑时重传，但仍需重新验收。
6. 从 GitHub 重新下载草稿资产，比较本地/远端 SHA-256 清单并核对 SHA-512；解压 ZIP，
   验证签名及原生依赖，验证远端 DMG。失败则不公开、不推进清单。
7. 用 `--draft=false --prerelease --latest=false` 公开个人 Release。
8. 无凭据重新下载公开资产并核对；公开下载失败不推进清单，不把有权限的草稿下载当公开可用证据。
9. `scripts/personal-release.mjs` 从已验收资产生成个人清单，URL 固定绑定对应 `personal-v<version>`。
10. 比较当前清单与新版本，必须按数字严格前进。相同版本、降级、脏版本均拒绝；
    并发串行化到个人通道，普通 push 推进 `personal-updates`，禁止强推覆盖。
11. 再读取公开 raw 清单，核对生成内容；任何阶段失败都必须报告实际进度。

文件/路径等能力变更仍须在发 tag 前完成相应真机验收；涉及模型自主调用工具，至少两家厂商。
这些 UI/工具真机结论不能由签名或构建成功代替。

## 常用命令

### 1. 开始前

```bash
git status --short
git branch --show-current
git remote -v
gh auth status
gh release list --repo tingyuxuan123/EnsoCode --limit 8
```

核对安装版版本与个人源，但不读取/导出本机私钥，不因本机有证书就走本地打包。
GitHub API token 与 Git SSH 推送权限独立；无权限时请用户在本机登录，不在聊天中索取 token。

### 2. 递增、检查、提交和 tag

```bash
# 先独立提交经过检查的功能/修复，再递增 package.json 版本，编写对应日志并单独提交发布版本。
node scripts/personal-release.mjs notes
pnpm release:check
VERSION=$(node -p "require('./package.json').version")
TAG="personal-v$VERSION"
git ls-remote --tags origin "refs/tags/$TAG"
# 仅当 tag 不存在且工作区干净时创建，不移动或强推旧 tag。
git push origin HEAD:main
git tag -a "$TAG" -m "EnsoCode $VERSION personal update"
git push origin "$TAG"
```

### 3. 观察 CI，不重复打包或反复触发

```bash
gh run list --repo tingyuxuan123/EnsoCode --workflow build-personal-mac.yml --limit 5
# 核对 tag、SHA、run id 后查看；耗时任务使用一个有界等待，不反复轮询。
gh run view <run-id> --repo tingyuxuan123/EnsoCode
gh run view <run-id> --repo tingyuxuan123/EnsoCode --log-failed  # 仅失败时
gh release view "$TAG" --repo tingyuxuan123/EnsoCode --json isDraft,isPrerelease,assets,url
```

Actions 首次启用不会补跑旧 tag 事件；确认没有重复任务后可从 Actions 重跑失败任务。
手动 Run workflow(main) 不发布；需带入代码修复时递增版本并推新 tag。
已公开 Release 禁止重建覆盖，不为了修旧版本清单移动 tag。

## 对外正式发布（仅明确授权时）

### 仅 Windows 构建

用户明确只要 Windows 时，递增 `package.json` 版本并推 `windows-v<version>`，
由 `.github/workflows/build-windows.yml` 执行。该 tag 不匹配 `v*` 或 `personal-v*`，
不会构建 Mac、Linux 或中继，不推进 `personal-updates`，不改变正式 latest。
完整检查在 Linux runner 上执行；只在 Windows runner 上打包 x64 NSIS，验收包内原生依赖、
设计引擎及更新清单哈希后，上传 Windows 专用 Release **草稿**并重新下载校验。
手动触发此 workflow 仅生成 artifact；公开草稿仍需 Windows 安装、旧数据保留验收和独立授权。

```bash
git push origin HEAD:main
git tag -a "windows-v$VERSION" -m "EnsoCode $VERSION Windows x64"
git push origin "windows-v$VERSION"
gh run list --repo tingyuxuan123/EnsoCode --workflow build-windows.yml --limit 5
```

### 多平台正式构建

正式 `v*` 由 `.github/workflows/build.yml` 触发，多平台、Mac 两架构构建并合并清单，
只保留草稿。正式公开 latest 仍要求独立授权、Developer ID 签名、公证和真实安装/升级验收。
Apple Secrets 为 `APPLE_CERTIFICATE`、`APPLE_CERTIFICATE_PASSWORD`、`APPLE_ID`、
`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID`，个人流程不使用它们。
无正式证书的 ad-hoc 包不得称为自动更新可用，也不得作为个人同证书包的降级替代。

## 软件内安装验收（用户操作）

- `available` 和 `downloaded` 的更新日志应包含仓库对应版本的实际变更及个人通道安全说明，
  与 GitHub Release 正文一致。Markdown 和正式 GitHub feed 的 HTML 都按不可信内容处理：
  只保留安全排版，不加载图片等资源；仅允许无内嵌凭证的 http(s) 链接经现有系统浏览器
  安全出口打开，不复用聊天动作或本地文件跳转。
- 关闭自动更新后，先手动检查；收到 `available` 后应能手动下载，完成后仍可查看日志和重启。
  晚开的设置窗口仅展示订阅后实际收到的状态；不假装已经读取下载快照，不新增通用 IPC。
- 真正升级前由用户正常退出/重启；保留旧应用与 userData 备份，不删除设置和会话。
- 更新完成后核对运行版本、旧设置/会话/项目和本次功能；不能把下载完成当作安装完成。
- ZIP 下载后仍可能在 Squirrel 签名验证阶段失败，错误必须允许覆盖 downloaded 状态。
- 可检查 `~/Library/Caches/enso-code-updater/pending/update-info.json`、ZIP SHA-512，
  并用 `codesign --verify -R='<旧应用 requirement>' <新应用>` 验证同证书兼容。
- 不打印本地代理中的临时凭据。人工网络排障时命令行不一定继承 macOS 系统代理，
  先短时探测，不等待长时间无进展下载；不得跳过签名或哈希验收。

回归：`scripts/release.test.mjs`、`src/main/services/updater/AutoUpdater.test.ts`、
`src/renderer/components/app/UpdateBanner.test.tsx`、
`src/renderer/components/settings/GeneralSettings.updates.test.tsx`。
这些测试覆盖日志来源、手动操作和失败 UI，不代表 Windows NSIS 的安装、旧数据保留或系统浏览器
实际打开已验收；个人 feed 仍仅用于 Mac arm64，Windows workflow 和发布规则不变。

## 结束时必须交代

- 源码 SHA、分支、版本、tag 以及是否推送。
- CI run URL 与实际状态，不冒称本地成功或沿用旧构建报告。
- 检查、签名/哈希、原生依赖和必要的双模型验收证据。
- Release 是草稿还是公开、个人清单当前版本；正式 latest 必须未变。
- 是否实际安装/重启及旧数据验收；未安装要明确说明。
- 外部阻塞具体在哪一步，需要用户做什么；CI 失败不回退本机打包。
