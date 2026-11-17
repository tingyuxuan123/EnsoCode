# Collabra 浏览器完整模式：移植计划

状态：**仅规划，未实施、未部署**。2026-11-16 用户选择先规划移植上游完整模式。
当前 fork 基线 `40524c8e`（Collabra 0.2.82）；上游参考固定为 `86693cfc`（EnsoCode v0.3.8）。
后续开发前须复核基线，不能把本文当作已完成验收。

## 1. 行为差距与目标

当前 PWA 使用 Pair 的目录、订阅、快照和会话事件，自行渲染适配手机的聊天界面。
桌面节点 guest 也依赖这套投影，不是上游完整模式的 RPC renderer。
fork 没有 `packages/phone/src/desk/`、`src/main/services/remoteRenderer/`、`src/web/`
或 `src/shared/remoteDelta.ts`。

上游完整模式从 `567de720` 引入：浏览器壳持有加密连接，取得电脑上的 renderer 构建产物，
浏览器内运行工作台，通过 Web preload 桥调用受限制的 Main 能力。它不是视频投屏，
也不是把电脑的通用 IPC 开放到公网。

目标：**新增可选的浏览器完整工作台，与现有手机精简模式并存**，保留 Collabra 的桌面布局。
“完整”指布局和受支持的工作流，不代表任意 Electron/系统/插件能力都可远程使用。

建议 MVP：复用已有配对，显示项目/会话列表、权威历史、实时回合、模型选择、消息发送、
停止与问答/审批；操作继续经过现有 worker、Bot 和审批规则。项目先只选已有项。
尚未通过权限审计的功能必须显式隐藏或显示不支持，不能提供空按钮或假成功。

## 2. 保留范围与非目标

- 不替换当前 PWA 的 27 页设计稿及生产聊天页面；新增模式入口、切换、下载/恢复提示须先改
  `collabra-pwa.vetd`，用户确认后才能实现 UI。PC 视觉继续冻结。
- 保留 Collabra 品牌、应用身份、数据路径、更新渠道、现有配对格式和证书。
- 不覆盖本地 Bot/成员/群聊、目标、审批、插件市场、防重放与代际隔离实现。
  MVP 可暂不开放部分模块，但不能破坏它们在桌面/精简模式下的现有行为。
- 不改 Android 源码及用户当前未提交的 Android 改动；协议增量保持可选并回归旧消费端。
- 不顺带引入秘书 Agent、上游 UI 重构、无界面服务端、Electron 45 或 Pi 升级。
- 首版不远程管理凭据、配对/设备、配置导入、插件安装；不接入系统电脑控制、原生浏览器面板、
  终端、设计画布、图像工作室或协作看板独立窗口。后续逐项评估，不承诺天然兼容。
- 本文不授权发版、安装、重启用户桌面、部署线上 PWA 或修改 Caddy/中继。

## 3. 架构及必改领域

```text
现有手机精简模式 ── Pair 目录/订阅投影 ──────────────┐
                                                  │
新增完整模式壳 ── 既有配对、加密、防重放、relay/直连 ── Main pairHost
      │                                           │
      └─ renderer 资源 + typed Web preload ── 远端身份/能力白名单
                                                  │
                                        现有领域 handler / worker
```

下表是候选文件边界；实现前逐个确认所需通道和本地 handler，不能照清单整文件覆盖。

| 层 | 新增/适配候选 | 原因 |
| --- | --- | --- |
| Pair 协议 | 新增 `packages/pair/src/remote.ts`；适配 `protocol.ts`、`index.ts` | RPC、资源、分片/序号、ack、压缩与严格解析，仍用既有加密帧 |
| 共享纯逻辑 | 新增 `src/shared/jsonDelta.ts`、`remoteDelta.ts`、`conversationsPatch.ts`、`remoteBridge.ts` | 有界增量、读写基线与补丁协议 |
| 远端通道契约 | 新增 `src/shared/remote/channels.ts`；适配 `src/shared/types/ipc.ts`、`src/preload/index.ts` | 显式能力分类、typed 出口；不把 Main 模块导入 Web |
| Main 宿主 | 新增 `src/main/services/remoteRenderer/` 下 registry、sender、commands、assets、bulkWindow、conversationSync 等模块 | 远端生命周期、调用路由、资产和流控 |
| Main 接线 | 适配 `src/main/index.ts`、`services/pairHost.ts`、`pairPolicy.ts`、`pairScope.ts`、`ipc/settings.ts` 及窗口广播/身份辅助 | 注册次序、认证、作用域、重连和双界面同步 |
| 凭据/审批 | 复用 `services/settingsSecrets.ts`；按需适配 `ipc/capabilities.ts` 等 | 只给脱敏配置；按远端来源绑定审批和返回结果 |
| Web 桥/构建 | 新增 `src/web/electronShim.ts`、`preload.ts`、`vite.web-preload.config.ts`；适配 `package.json` | 将现有 typed preload 编译为浏览器桥，不向 Web 打入 Node/Electron |
| 第二 renderer | 新增 `src/renderer/lib/rendererRole.ts`、会话 `remotePatch.ts`；适配 sessions 持久化、settings storage、自动任务 hook、pairCatalog | 避免陈旧快照写回及重复执行副作用 |
| PWA 壳 | 新增 `packages/phone/desk.html`、`src/desk/`；适配 Vite 多入口、`public/sw.js`、模式切换及 `client.ts` | 独立入口、资源路由、连接恢复及能力降级 |
| 图片与产物 | 按需适配 `services/localImageProtocol.ts` 等 | 仅从已授权会话取得资源，不开放任意磁盘路径 |
| 文档/交付 | 新增 `docs/engineering-reference/main/remote-renderer.md`，更新 Pair 与 Web 部署规范 | 记录实际契约、兼容矩阵和回滚步骤 |

上游最新实现已依赖 `@platform` 等重构；参考旧版基线及后续专属修复，按本地 Electron 架构适配。
若需要 `resumeFull` 等 worker 字段，须证明现有历史接口不足，再同步修改命令校验及测试，
不能为迎合上游类型而引入无用字段。

## 4. 开工前硬门禁

### 4.1 默认拒绝的 RPC 能力表

上游 `remoteRenderer/channels.ts` 主要采用 denylist，未命中的通道默认允许；本 fork 不照搬。
须按通道登记读/写、输入解析、配对 scope、对象归属、sender/代际、返回脱敏和事件可见范围。
**新增或未分类通道一律拒绝**。事件订阅也需白名单，不只限制 invoke。

传输内部可编码 channel，但浏览器仅获得按领域的 typed API，不暴露通用 invoke。
伪 sender 不能伪装成本地可信主窗口；不能仅为通过原 handler 的窗口检查而放宽身份判断。
需要远端支持的 handler 单独改为能力检查，其他接口明确拒绝。

`scope=read` 的首版建议不显示完整模式入口；已有连接降权后立即撤销操作能力并清理资源。
即使未来开放只读浏览，也必须由 Main 拒绝全部写入，不能只灰掉按钮。

### 4.2 凭据与浏览器执行隔离

- 复用本地 `settingsSecrets.project/restoreSettings`，不引入上游另一套密钥哨兵。
  `SETTINGS_READ`、事件、错误、缓存、资源和日志均不得包含 provider/MCP 凭证明文。
- 不透明凭据引用仍是有权限的句柄，不能视为脱敏后就可以任意使用；远端不得调用凭据测试、
  改端点、导入配置等接口绕过绑定。MVP 不开放 `enso-settings` 整份写回。
- 上游 Web shim 直接访问 `window.parent.__ensoRemote`，资源由同源 `/desk/` Service Worker 提供。
  **localStorage 键前缀不能隔离同源脚本读取配对凭据**；
  `allow-scripts + allow-same-origin` 的同源 iframe 也不构成安全隔离。
- P0 必须确定信任模型：明确接受受信任宿主构建代码运行于 PWA origin，或先验证独立 origin +
  MessageChannel 的隔离方案。建议优先验证后者：配对 key 仅由父壳持有，不新增配对。
  origin、Service Worker、模块资源路由及消息来源校验需原型证明，**不能当作已解决**。
  如涉及新增域名/部署资源，必须单独确认。未解决前不发布可执行完整模式。

### 4.3 多界面写入与执行权

- 参考 `persisted-store-second-window.md` 的真实故障：不能让第二份 sessions/sidePanel store
  用陈旧全量快照覆盖主窗口。会话变更由 Main 带序号补丁/每来源基线账本合并。
- `activeId`、布局、展开状态按 renderer 隔离；远端 side-panel 不写桌面的持久化键。
  本地 A/远端 B 并行运行、创建/归档/重命名和切换后，两边会话与主窗口选中态必须正确。
- leader 只负责仍在 renderer 的后台编排，不等于安全授权。桌面优先，角色切换需单调代际或等价
  fencing，不能仅依赖 UI 布尔值；队列泵、目标续跑、标题摘要、自动归档和停滞检测不得双执行。
- 历史仍来自 Main/worker 权威投影；远端 store 不是正文权威，不得自行修复磁盘历史。

### 4.4 资产与同配对切换

- 资产仅从固定构建产物的清单按相对标识读取；路径、realpath、普通文件、MIME、大小均校验。
  上游 `assets.ts` 的 `HTML_ENTRIES` 仅控制 preload 注入，**并未拒绝其他 HTML**，需要主动收紧。
  MVP 仅所需入口可执行，`design.html`、`taskboard.html`、`plugin-view.html` 等默认拒绝。
- 缓存及资源按 pair + build + renderer 角色/必要权限分区；SW 不可在找不到目标 pair 时随便选
  另一个壳转发。退出/撤销不得留下可越权读取的正文快照。
- 同一配对只允许一个 guest。精简/完整模式切换应先关闭当前连接再导航，复用同一凭据；
  跨标签明确接管，被替换页保留缓存并停链，不自动抢连，不要求重新配对或清存储。

## 5. 分阶段实施与验收

| 阶段 | 交付 | 阶段门槛及回滚 |
| --- | --- | --- |
| P0 设计/安全原型 | 模式入口设计稿；MVP 能力表；origin 信任模型；单 guest 切换；模块降级表 | 用户确认设计与能力取舍；安全疑点未决不开始开放入口 |
| P1 协议与纯函数 | 严格帧解析、分片、gzip、流控/预算、delta/缓存/补丁 | 每项 RED→GREEN；无生产接线、无用户可见行为变化；独立提交可回退 |
| P2 Main 宿主（默认关） | registry、远端身份/鉴权、typed handler 路由、资产、代际清理、能力声明 | 未认证/未知通道/越权均拒绝且不执行；精简 PWA/桌面节点协议回归通过 |
| P3 renderer 隔离（仍默认关） | per-renderer 状态、Main 补丁合并、leader/fencing、副作用去重、原生能力降级 | 双 renderer 真实并行验证、不覆写选中项/历史、不双派活；PC 视觉无改动 |
| P4 浏览器桥与独立壳 | web-preload、独立路由/SW、模式切换、资源下载及连接恢复 | 仅隔离环境启用；两种模式正常使用；旧宿主隐藏入口/可回退，不白屏 |
| P5 故障/兼容验收 | 混合版本、断线/丢包/重复/大资源/缓存/多标签及权限测试报告 | 全量门禁、真实回环联调；实体手机/Windows/公网 NAT 未测须单列，不冒充通过 |
| P6 经授权后灰度 | 桌面 CI 发版及 Web 静态资源的独立部署、回滚演练 | 开关默认关，先小范围开启；可关闭入口/host 能力后回退，既有配对和精简聊天保留 |

P3 必须先于 P4 的用户可运行入口，不能先开放第二个主界面再补持久化隔离。
所有阶段保持小批独立提交；不把其他上游新功能或当前 Android 修改混入。

三项原始稳定性目标随所属层首次接线带入，而非部署后再补：

1. `71c991eb`：换链/回前台补 remote-ack，丢失 rpc-ready 或末帧时有界重新 hello；
   区分重连与正在恢复 renderer，停止后清理 watchdog。重复请求不得重复执行。
2. `62d98219`：完整模式显式声明身份后再抑制手机目录/模型/外观/Bot/会话事件副本；
   精简 PWA 和桌面节点继续收到原来的投影。缺失身份字段仍为旧语义。
3. `fa62127f`：只读基线条目扩为 64，同时保留字节预算；基线丢失回全量而非坏增量。
   超大解压输入、分片并发/总量、未决请求和流控队列都须有独立硬上限。

## 6. 测试与真实验收清单

- 纯函数：坏类型/未知帧、编码/解码、分片缺口/乱序/重复、压缩炸弹、ack 窗口、预算淘汰、
  40 次历史读取后设置基线仍可增量；超预算时仍遵守全量/拒绝契约。
- Main：RPC 未分类、过期配对、未认证、scope/归属变化、伪 sender、旧 socket 回包均不得执行；
  同 invoke ID 同代际重投只执行一次，冲突参数不能复用 ID；跨代际结果不伪报成功。
- 不明写入不得靠重新加密盲目重发。仅在明确的去重账本/业务投递 ID 契约下恢复，结果未知需可见。
- 凭据：设置读/推送/错误/缓存无明文；引用不能跨实体、端点、配对或权限滥用；恶意路径不读盘。
- 双 renderer：并发增删会话、迟到补丁、重载后写回、activeId/布局隔离、leader 切换中不双执行。
- 浏览器：首载、下载中断、SW 更新/旧缓存、空文档 Observer、前后台、离线、丢 ready/末帧、
  有序帧中途/最后一帧丢失、relay/直连切换、多标签 replaced；回到精简模式不丢草稿和配对。
- 隔离联调只用临时 userData/Chrome profile/项目/配对及回环 relay，核对 Main 权威历史、
  worker 请求数和 settings 持久化，不以一张截图或 mock 调用宣称验收。
- 根门禁 `pnpm typecheck && pnpm lint && pnpm test`；另跑手机包 typecheck/build、web-preload
  构建和桌面构建。若改变模型自主工具链，补两个厂商真机验证。
- 生成验收证据表：用例、实际命令/环境、期望/实际、结果及未覆盖边界；清理临时服务与数据。

## 7. 版本、部署与回滚矩阵

| 组合 | 必须表现 |
| --- | --- |
| 旧桌面 + 新 Web | 无完整模式能力时隐藏入口；直达链接说明不支持并可回精简模式 |
| 新桌面 + 旧 Web/Android/桌面节点 guest | 旧协议继续工作，不缺目录/事件，不强迫升级或重配对 |
| 新桌面 + 新 Web | 能力和协议版本匹配才开放；未知版本安全回退，不以 appVersion 字符串猜能力 |
| 新壳 + 旧 SW/旧资源 | 有界恢复/刷新提示；不要求清存储；不可混用其他构建的 preload 与入口 |
| 灰度回退 | 关闭开关/撤销远端 renderer；旧精简模式及已有配对不变，保留仍在用的哈希资源 |

当前线上 PWA 是 Caddy 静态站与 Go relay 分离；通常 Web 更新无需更换/重启 relay。
实施时仍需重新只读核验实际路由。优先明确 `desk.html` 或等价独立入口，避免 SPA fallback
把 `/desk` 错投到精简页。origin 隔离若引入新路由/域名另行评估，不能沿用“零配置变更”承诺。

按既有 Web 部署规范冻结源码、校验 SHA-256、保留回滚包和旧哈希资源、最后原子切入口。
桌面 Main/worker 的变更另走 CI 桌面发布；不把 Web 部署成功当作用户已安装新版桌面。
未获部署授权前仅完成隔离验证与交付，不访问线上配对或数据库内容。

## 8. 上游取舍与本轮证据

- 参考 `db9e8d57`、`567de720` 的基础协议/桥接设计，不整包 cherry-pick。
- 明确纳入上面的三项稳定性行为；其他后续修复（快照就绪、下载中断、通知定位、离开确认等）
  按层审查实际依赖，不能只按提交标题批量搬运。
- 不引入最新上游 `@platform`、插件/秘书/服务端/宿主更新等无关架构。
- 既有心跳连续两次超时及 4001 接管兼容已移植，不重复实现、不回退缓存与停链语义。

本轮主 Agent 已实际执行：根 typecheck、lint、手机 typecheck 通过；lint 仅有既存
`GitChangesView.tsx` 冗余 Fragment info。`heartbeat.test.ts`、`client.test.ts`、
`pairReplay.test.ts` 三文件共 105 项通过。没有新增实现，故这些仅是既有基线检查，
**不是完整模式验收**；未启动真实断线联调或部署。子代理只读调研，主 Agent 复核关键源码。
上述基线命令在规划开始时运行；交付时发现其他并行开发已产生 Agent、Mermaid、Antigravity
等文件改动，本轮未修改或纳入验收，也未动既有 Android 改动。后续实施须以最新工作区重新验收。

相关规范：
- [工程约定](../engineering-guidelines.md)
- [IPC 规范](../engineering-reference/main/ipc.md)
- [Pair 防重放](../engineering-reference/main/pair-replay.md)
- [第二窗口持久化覆盖陷阱](../engineering-reference/big-question/persisted-store-second-window.md)
- [Web 单独更新](../engineering-reference/guides/relay-web-deploy.md)
