# 桌面版发布与更新验收

## 新会话如何执行

用户说“发布 / 发版 / 推送这次更新 / 打包升级”时，以本文为操作手册，先核对当前源码，
不要依赖旧会话中的版本号、构建链接、登录状态或测试结论。单纯“修改某个功能”不等于授权发布。
**本仓库供用户本人使用：上述发布指令默认授权个人更新通道，不是对外正式发布。**
无需每次再询问个人版还是正式版：默认 Mac arm64、复用现有可信签名证书、
`electron-builder.personal.yml`、`personal-v<version>` prerelease 和 `personal-updates` 清单。
验收通过后应公开个人 prerelease（`--latest=false`）并推进清单，让已安装的个人版可在软件内获取更新，
不是仅交付草稿或 artifact。用户只说“发布”不等于授权混入其他未提交开发、强杀应用或代替用户安装重启。

先说明本轮做到构建、个人通道公开或安装验收哪一步。CI 证书不可用而本机仍有原证书时，
可用本机同证书构建、上传并验收，明确报告实际构建来源及 CI 阻塞；不能回退 ad-hoc 并声称自动更新可用。
签名或校验不满足则保留草稿并说明阻塞。只有用户明确要求**对外正式发布**且验收/正式签名条件满足，
才能公开为正式 latest；个人自签名更新不适用该对外签名门槛，也不能冒充对外正式包。

个人发布顺序：**核对环境与当前安装版/更新源 → 版本递增 → 全量检查 → 本地包验证 → 提交/tag →
构建上传草稿 → 远端下载/哈希/旧签名兼容验收 → 公开个人 prerelease → 推进并验证个人清单 → 用户软件内升级验收**。
已接入个人源的应用不需每轮重新安装引导版；只有首次迁移才手动安装一次。对外正式发布仍遵循本文后续正式流程。
遇到外部阻塞仍可完成前面的安全步骤，
但不能把未完成的阶段报告为成功，也不要为了“全绿”跳过测试或安全校验。

## 发布边界

- `package.json` 是版本权威；个人 tag 为 `personal-v<version>`，对外正式 tag 为 `v<version>`；旧版本已被安装也要递增版本。
- `.github/workflows/build.yml` 在构建前运行 `pnpm release:check`。tag 构建只上传到
  GitHub **草稿 Release**，不会自动公开。手动 workflow 选择分支时只保留 Actions artifacts；
  手动选择 `v<version>` tag 时，同样会生成草稿 Release。
- `scripts/release.mjs` 校验 tag/版本、合并 Mac 两架构清单、检查实际安装包大小及 SHA-512，
  并生成 `SHA256SUMS`。禁止重跑构建覆盖已公开 Release；出错后使用新版本。
- 正式更新源为 `tingyuxuan123/EnsoCode` 的 GitHub latest；默认个人更新源为该仓库的 `personal-updates` 分支。
  上游官方包及旧正式源安装包不会自动切换到个人源。

## macOS 签名

`electron-builder.yml` 不写死 `mac.identity`：electron-builder 先找 `Developer ID Application:`
前缀的证书，找不到时回退到任意非 Apple 的 codesigning 身份（本机自签名证书）。CI 读取证书后
通过 `-c.mac.identity` 显式选择 Developer ID Application，执行公证与签名验证。
完全没有证书的机器必须显式传 `-c.mac.identity=-` 走 ad-hoc 完整性签名：不签名只剩「改过
Info.plist 的 Electron.app 拷贝」，TCC 授权对不上运行实体，arm64 上还可能无法启动。

### 本地自签名证书（免 Developer ID，仅本机自动更新可用）

ad-hoc 的 designated requirement 绑当前构建的 cdhash，永远无法自动更新。要在**本机**把自动更新
链路跑通，可在登录钥匙串建一张自签名 Code Signing 证书；requirement 会变成
`identifier "com.j3n5en.enso-code" and certificate root = H"<证书哈希>"`，跨构建稳定。

```bash
# 生成（openssl 3 必须用 -legacy，否则 security import 报 MAC verification failed）
openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem -days 3650 -nodes \
  -subj "/CN=EnsoCode Local Signing/O=EnsoCode Local/C=CN" \
  -addext "basicConstraints=critical,CA:false" -addext "keyUsage=critical,digitalSignature" \
  -addext "extendedKeyUsage=critical,codeSigning"
openssl pkcs12 -export -inkey key.pem -in cert.pem -out id.p12 -passout pass:<pw> \
  -name "EnsoCode Local Signing" -legacy -macalg sha1 \
  -certpbe PBE-SHA1-3DES -keypbe PBE-SHA1-3DES
security import id.p12 -k ~/Library/Keychains/login.keychain-db -P <pw> -T /usr/bin/codesign
security add-trusted-cert -r trustRoot -p codeSign \
  -k ~/Library/Keychains/login.keychain-db cert.pem
security find-identity -v -p codesigning   # 应出现 1 valid identities found
```

之后 `pnpm build:mac` 会自动选中它。**从 ad-hoc 版本切到自签名版本必须手动覆盖安装一次**，
旧应用的 requirement 已写死 cdhash，Squirrel 无法自替换；此后的同签名构建才能自动更新。
自签名证书只在信任该证书的机器上有效，不能作为对外分发方案，也不解除 Gatekeeper 隔离提示。

#### GitHub Actions 个人自签名测试构建

`.github/workflows/build-personal-mac.yml` 是独立、仅手动触发的 Mac arm64 测试流程，
使用 `electron-builder.personal.yml` 写入隔离的 generic 更新源，不替代正式 `Build`，
不创建或公开 Release，不更新正式 latest。使用方式：

1. 将当前安装版本对应的证书及私钥导出为带密码的 `.p12`。把 Base64 内容存入仓库
   Actions Secret `LOCAL_SIGNING_CERTIFICATE`，导出密码存入 `LOCAL_SIGNING_PASSWORD`。
   不要把 `.p12`、私钥、密码提交到仓库或发到聊天中。
2. workflow 合入 `main` 后，在 Actions → **Build Personal Mac** → **Run workflow**，
   分支选 `main`。`certificate_sha1` 填当前安装应用签名证书的 SHA-1（40 位大写十六进制，
   可从 `codesign -d -r- /Applications/EnsoCode.app` 的 `certificate root` 获取并转大写）。
   名称相同不代表同一证书，重新生成证书也不能兼容旧签名。
3. 流程先跑完整检查、构建，再导入临时钥匙串；核对证书指纹、配置签名信任后显式选择该身份，
   关闭公证，验证包的哈希、签名要求、DMG 和原生依赖。签名材料在成功或失败后都清理。
4. 成功后下载 `personal-mac-arm64-<run number>` artifact（保留 7 天），这只表示构建与静态验证通过。
   草稿和 Actions artifacts 均不会被普通自动更新发现；不能把下载产物等同于已安装或自动升级成功。
   新版必须高于已安装版本，并另行验收个人测试更新源及完整升级链路。正式对外 latest 仍遵循
   本文的 Developer ID、公证与发布授权要求。

经用户明确授权个人通道测试时，允许将验收后的同证书包公开为 **个人 prerelease**，
不能设为正式 latest。首次正常退出后手动安装个人包（例如 0.2.14），才能读取个人更新源；
仍使用正式 GitHub provider 的旧包不会自动切换。后续个人包仍须递增版本（例如 0.2.15）。

- 个人 release tag 为 `personal-v<version>`（不会触发正式 `v*` 构建）；产物先建草稿上传，
  校验后用 `--prerelease --latest=false` 公开，不覆盖已公开版本。不要把个人 tag 交给正式版本校验。
- `node scripts/personal-release.mjs <artifact目录> <feed目录>` 先校验本地文件哈希，再生成
  `latest-mac.yml`，其中下载 URL 固定指向同仓库对应的 `personal-v<version>` 资产。
  正式 `release.mjs` 仍拒绝任意远程 URL，不能为个人源放宽它的安全边界。
- 只有对应资产公开且重新下载校验成功后，才把生成的清单提交到独立的 `personal-updates`
  分支。个人包读取 `https://raw.githubusercontent.com/tingyuxuan123/EnsoCode/personal-updates/`，
  正式包仍读取原 GitHub latest，两者互不替代。此分支清单是可推进的通道指针，不是安装包。
- 用户手动执行第一次安装和后续软件内更新；不要强杀承载会话的进程、热替换应用或提前报告升级成功。

该流程只允许运行 `main`，权限仅 `contents: read`，不读取正式 Apple 签名 Secrets。
证书持有者仍须审查 `main` 上会执行的代码及仓库写权限：CI 中能访问私钥的恶意代码可能盗取私钥。

GitHub Actions Secrets（仅在仓库设置中配置，不写代码、日志或聊天）：

- `APPLE_CERTIFICATE`：包含私钥的 Developer ID Application `.p12` 的 base64。
- `APPLE_CERTIFICATE_PASSWORD`：`.p12` 导出密码。
- `APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID`：公证身份。

无证书时 CI 允许生成 ad-hoc **手动试装包**并留在草稿；不能把它称为自动升级验收通过。
从现有 ad-hoc 应用迁移到正式签名版可能需要首次手动安装，再验证后续同签名更新。
不要禁用签名或完整性校验来强行实现自动升级。

### 下载完成但“重启更新”无反应

macOS 的 ZIP 下载完成仅表示 electron-updater 已缓存文件；Squirrel 仍须验证签名并准备安装。
ad-hoc 签名的 designated requirement 常绑定当前构建的 cdhash，新构建不满足旧应用的要求，
即使两个包各自的 `codesign --verify` 都通过，也不能据此认定可自动替换。

先检查 `~/Library/Caches/enso-code-updater/pending/update-info.json` 与缓存 ZIP 的 SHA-512，
解压到独立临时目录，用 `codesign -d -r- <旧应用>` / `<新应用>` 比较要求，再使用
`codesign --verify -R='<旧应用的 designated requirement>' <新应用>` 验证兼容性。
验证失败时手动覆盖安装，不能关闭签名校验。不要打印本地代理 URL 中的临时认证信息。

应用必须允许下载后的安装错误覆盖 `downloaded` 状态，取消退出标记与空闲安装重试，向设置页和
更新横幅显示真实错误；不能用“下载完成后忽略其它状态”的守卫吞掉原生安装器错误。
回归：`src/main/services/updater/AutoUpdater.test.ts`、`src/renderer/components/app/UpdateBanner.test.tsx`。

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

平台特有行为的单测不能依赖开发机的 `process.platform`。例如 macOS 权限设置测试需明确
模拟 `darwin`，并覆盖 Linux/Windows 拒绝调用；测试后恢复平台 mock，不能在 Linux CI 直接
期待 macOS 接口被调用。首次给已有仓库接入全量发布门禁时，先对分支手动构建并验证所有平台，
通过后再创建 release tag，避免每发现一个历史平台假设就消耗一个版本。

## 结束时必须交代

向用户分别说明并提供证据，不用一句“更新好了”代替：

- 代码：提交 SHA、目标分支、版本和 tag；是否已推送。
- 检查：类型/lint/测试、原生冒烟、哈希/签名结果，及双模型验收结果（如适用）。
- 构建：run URL、真实状态、草稿或公开状态；本地安装包和校验文件位置。
- 安装：是否实际替换安装、启动的新版本、旧设置/会话是否保留；手动试装不算自动升级。
- 阻塞：缺权限、Actions 未启用、无正式证书、用户尚未退出应用等；说明需要用户做的最小操作。

正在承载本次会话的应用不要强杀或热替换。若退出会中断执行，先交付包、备份/安装步骤与验收清单，
明确等待用户正常退出后继续。临时目录和旧会话中的验收报告不作为下一次发版的通过证据。
