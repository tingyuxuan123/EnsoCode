# Collabra 精选插件市场

## 仓库与发布

- 市场源码：<https://github.com/tingyuxuan123/collabra-plugins>
- 网页及主源：<https://tingyuxuan123.github.io/collabra-plugins/>
- 镜像：该仓库 `dist` 分支的 `v1/`，不是第二个市场。
- 发布协议与操作手册以市场仓库的 `SPEC.md`、`docs/PUBLISHING.md` 为准。

市场采用维护者审核 GitHub PR、CI 测试/打包、独立 Ed25519 签名、静态 Pages 分发。
不执行投稿插件入口或安装脚本，不自动抓取上游插件；没有作者账号、支付、评分或上传后台。
第三方插件和美术素材须分别核实再分发许可，平台 MIT 许可不覆盖第三方内容。

## 客户端边界

- 当前市场只认 `schemaVersion: 2`、`marketId: collabra` 及独立生产公钥；`v1/` 是 URL
  目录名，不是索引 schema 版本。公钥、主源及镜像在 `main/services/extensionPlugins/market.ts`。
- 版本必须声明 Collabra host、插件 API 版本、应用版本范围、平台和实测界面列表。
  选择最高**兼容**版本，不盲装最新发布版；配色能加载不等于装饰覆盖所有界面。
- 缓存和防回滚计数位于 `extension-plugins/market/collabra/`。旧的 `market/state.json`
  不参与新市场验签或 sequence 判断，不能清除新计数来绕过回滚保护。
- 内置索引是已发布原始 JSON 字节及原始签名，仅用于断网目录回退；不内置 ZIP 包。
  更新 `builtinMarket.ts` 时必须先用生产公钥验签，不能重新格式化 JSON 或使用测试签名。
- 市场安装保存 Main 权威 `source.marketId`，renderer 仅传插件 ID 和可选版本。
  旧记录缺少 `marketId` 视为旧 enso 来源；原安装继续可用，但不被新市场接管或自动更新。
- 目录、ZIP、URL 来源不因同名市场条目而变成市场安装。现阶段不支持保留插件数据的
  跨来源迁移；冲突必须在预览与提交落盘前分别校验，不建议用户卸载重装来“无损迁移”。
- 网页 ZIP 下载按本地 ZIP 安装，后续手动更新；希望从市场更新应在应用内市场安装。

## 密钥与运维

生产私钥只存受保护的本地备份和市场仓库的 `COLLABRA_MARKET_PRIVATE_KEY` Secret，
不得进入桌面仓库、市场仓库、日志或构建产物。PR 校验不注入私钥，签名仅在生产 CI 的
独立步骤执行。主分支要求维护者/CODEOWNERS 审批；`dist` 不允许强推或删除。

市场私钥轮换、历史签名账本恢复、下架和 CI 失败处理见市场仓库操作手册。市场网页上线
不等于桌面客户端已发版；Main 改动需要重启 dev，正式桌面更新仍走项目发布流程。

## 验收与回归

- 发布端：`npm test && npm run validate && npm run check:secrets`。
- 客户端：`pnpm typecheck && pnpm lint && pnpm test`。
- 关键回归：`marketIndex.test.ts`、`market.test.ts`、`marketCsp.test.ts`、
  `builtinMarket.test.ts`、`service.market.test.ts`、`registry.test.ts`。
- 联调必须使用隔离 userData 与独立 CDP 端口，核验生产公钥签名、镜像一致性、包哈希、
  新装/启停/卸载、旧来源不更新不覆盖，不能操作用户真实插件配置作为测试夹具。
