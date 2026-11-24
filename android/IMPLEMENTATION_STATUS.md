# Android 实现与验收状态

本文件对照 `docs/plans/android-native-app.md`（本地计划）与 `ensocode-android.vetd/frames/`。
**通过现有测试不等于整款 App 已完成。** 不用版本号或模拟器截图推断未实现的功能。

## 已实现的范围

| 领域 | 当前可用范围 | 仍需补齐 |
| --- | --- | --- |
| 配对与连接 | Pair 链接、扫码、Keystore、重连/撤销/替换、单电脑 | 多电脑、离线目录、生产网络验收 |
| 会话 | 尾窗/历史、Markdown、思考/工具折叠、待办卡、后台通知与压缩摘要、审批/回答、文字/插话/停止、顶部切换模型和思考深度 | 更多会话配置和桌面专用卡片 |
| 图片 | 空闲已有会话发 JPEG/PNG，草稿缩略图，时间线附件及普通会话的桌面工具图片 | 新任务/队列/插话发图、拍照、公网 Markdown 图片、真实设备验收 |
| 新建与队列 | 真实项目/模型/思考/审批、顶部模型入口、创建后首句一次、文字队列 | 预设、SSH/worktree、新建图片、队列重排 |
| 目标 | 设定/修改/暂停/继续/清除，权威状态与轮次 | 外部模型自主推进验收 |
| 会话菜单 | 上下文/用量、重试、压缩、回退与恢复文件开关 | 回退需复核完整尾窗与稳定选择基线；带图草稿回填 |
| 子代理/后台 | 有界摘要、运行状态、停止请求 | coworker/Run/工作流完整过程与报告、全局看板汇总 |
| 看板 | 目录分组与进入会话 | 内联审批需 B2、真实完成语义（不能把失败等同成功） |
| 产物与预览 | 回复产物卡片、opaque 文件 ID、分块预览与完整下载（≤50 MiB）、系统打开文档及另存、公开网页与桌面预览分流 | 通用文档上传、预览完整手势与轮询、第三方文档应用真机验收 |
| 后台通知 | 用户开启的前台服务、本地通知、点开会话 | B2 内联操作、静默时段、实体机后台验收 |
| 设备与通知 | 抽屉齿轮进入：真实电脑名/连接阶段、桌面授予的可操作或只读、后台提醒开关与系统通知权限、单台已配对设备、重新连接与解绑确认 | 多电脑切换/重命名、静默时段、手机侧改权限（按设计不做） |
| 文字草稿 | Code 会话、新任务描述按配对身份+会话或新任务标识 加密保存在 `noBackupFilesDir`，切页与进程重启恢复；单条 32000 字、最多 24 条；仅权威确认且文字未被改写时清理 | 图片附件草稿、跨设备同步、未确认发送的重放（按设计不做） |

## 尚未实现的完整领域

- 改动审查：先核对并实现桌面 B1 权威通道，再做手机 diff 页面。
- 通知/看板直接审批：桌面 B2 的请求 ID、摘要、过期状态不可由手机猜测。
- 语音录入/识别（现有 Pair voice 协议，禁止仅接系统听写冒充桌面识别）。
- WebRTC 直连、Kotlin 分片/语音传输（现有共享向量只是契约，不是功能实现）。
- 多电脑管理、离线缓存、小部件/磁贴、更新与正式签名 CI（设置只做了设备与通知这一页，不是完整设置中心）。

## 验证口径

- JVM 与 Compose 设备测试覆盖**已实现切片**；按需中继/截图用例在常规设备测试中跳过，另行 opt-in。
- 本轮（原生第一批：设备与通知入口 + 文字草稿）在专用未配对模拟器 `CodeKiln_Members_Test`（API 37，1080×2400 / 420 dpi）实跑：
  `./gradlew check` 通过（app 107 项 JVM 单测、mirror 298 项）；`./gradlew :app:connectedDebugAndroidTest` 共 120 项、0 失败、17 项 opt-in 跳过。
  新增覆盖：`SettingsScreenTest` 6 项（真实电脑名、只读/可操作、提醒开关、通知权限入口、解绑二次确认、未配对态）、
  `TextDraftDeviceTest` 4 项（落盘无明文、换配对隔离、坏文件恢复、按配对清理）、`DraftRestoreScreenTest` 1 项（切页后回到同一会话仍见草稿）、
  `NavigationTest` 增加 1 项（抽屉齿轮进「设备与通知」、系统返回回到抽屉）。`NewTaskConfigTest` 已有 3 项按新草稿契约（`CodeKilnApp` 改为注入草稿宿主）改接线后复跑通过。
  根目录 `pnpm typecheck && pnpm lint && pnpm test` 同时通过。
- 草稿验收（第一批）：`DraftBookAcceptanceTest` 5 项、`DraftCleanupAcceptanceTest` 2 项、
  `mirror` 的 `TextDraftAcceptanceTest` 7 项、设备侧 `FirstBatchAcceptanceTest` 4 项与 `FirstBatchStorageAcceptanceTest` 2 项全部通过。
  修掉的真实缺陷：回执只比较文字，A→B→A 会被旧确认清掉（改为编辑代际：`DraftBook.text()` 钉住提交时的修订号，
  `SessionScreen` 按实例代际判断）；初始磁盘加载返回时可以复活已清空的草稿（改为记录本地已触碰 key 的墓碑）；
  落盘用 `writeUTF`，满额中文/emoji 直接 `UTFDataFormatException`，且编码按 key 排序丢掉了「最近编辑」顺序、截断会切坏代理对
  （改为 UTF-8 长度前缀 + 保持顺序 + 不切代理对，记录版本升到 2 且仍能读版本 1）；授权被替换时不清草稿、解绑路径先清草稿再清凭据
  导致 `onStop` 的 flush 把草稿写回（改为替换即清、凭据先清草稿最后清）。
  由于「编辑顺序」现在是落盘内容，`TextDraftRecordTest` 里「不同顺序写出同样字节」与「重启后按最近编辑淘汰」互相矛盾，
  该用例改为断言「同样内容 + 同样编辑顺序字节稳定，不同编辑顺序字节必须不同」，没有放宽其余断言。
  命令口径：`mirror` 是 Android library，没有 `:mirror:test`，单测任务为 `:mirror:testDebugUnitTest`。
- 新任务设置面板（`NewTaskConfigSheet`）：面板高度上限改为取窗口高度减去 134dp 预留（顶部设计留白 47 + 拖动条行 18 + 手势条 24 + sheet 展开余量 45），
  不再用 `BoxWithConstraints` 的 `maxHeight * .94f`；模型列表从 `LazyColumn(heightIn(240dp))` 改为普通 `Column`，面板只剩一层纵向滚动。
  新增 `NewTaskConfigSheetLayoutTest` 5 项（唯一纵向滚动节点、在模型列表上轻上滑标题随面板上移 ≥120dp、滚到底可见「助手代审」且落在可视区内、
  标题/关闭按钮不被裁掉且关闭有效、视口高度跨帧与滚动后不变、快速上滑也收敛）。专用模拟器 `CodeKiln_Members_Test`（API 37，1080×2400 / 420 dpi）实跑 5/5 通过；
  改动前同一套用例 4/4 失败：面板内 2 个纵向滚动节点（页面 `(0,264)-(1080,2337)`、模型列表 `(32,608)-(1048,1238)`），在模型列表上轻上滑标题 285px → 285px（位移 0）。
- 本轮未验证：实体手机、真实桌面配对下的「设备与通知」页与草稿实际恢复、线上中继；`START_NOT_STICKY` 等既有边界未改动。
  整跑中 `SessionMenuScreenTest` 的压缩用例曾偶发失败一次，单跑与随后两次整跑均通过，未改动该测试。
- 草稿本轮未验证：旧格式（记录版本 1）文件升级后的读取只有解码分支保证，没有用例也没有真实旧文件样本；实体手机与真实桌面配对未跑。
  APK `app/build/outputs/apk/debug/app-debug.apk`（40,307,065 字节，2026-11-15 13:28，`classes6.dex` 含 `DraftBook`）为本次改动后产物。
- `android-desktop-smoke.mjs` 使用真实 Electron/Main/worker，但模型是本地确定性 fixture，不是真实厂商。
- 后续切片需要扩展局部测试与完整回归；不得因上一个版本曾通过而宣称这次也通过。
- 用户本轮允许跳过需实体机的验收，最后统一测试；QR 相机、长锁屏/Doze/ROM、线上中继、真实模型/视觉与两厂商工具行为仍列为人工验收。

## 第三轮独立验收 P2 修复（本轮）

- P2-1 草稿「读即钉住」副作用（`DraftBook.kt`）：拆成显式 API。`text()` 退化为纯读，渲染输入框不再产生任何提交语义；
  真实发送才调用 `pin(key)`（返回要发送的文字并记录当前修订号），`confirm(key, text)` 必须同时匹配这次 pin 的修订和文字，
  没有任何 pin 的确认一律不清除，任何真实编辑都会作废 pin。依据：修订号必须由提交动作产生，读操作无从判断「这是不是一次发送」。
  RED：按旧语义（`text()` 内写 pin、`confirm` 无 pin 时回退到当前修订）跑 `DraftBookAcceptanceTest` 2 项失败
  （`reading the draft for display never authorises a confirmation`、A→B→A）；改回后 `DraftBookTest` + `DraftBookAcceptanceTest` 20 项全绿。
  既有断言未放宽：A→B→A 用例只把「取提交文字」的写法从 `text()` 换成 `pin()`，断言文字与存储结果一字未改。
- P2-2 离开页面期间到达的回执（`MainActivity.kt`）：pin 成了跨页面的提交凭据，`CodeKilnApp` 用「会话 ID + attempt id/phase」观察
  文本回执与队列 `Enqueue` 回执，观察到 `Observed` 就 `book.confirm(key, attempt.text)`。页面不在前台时 pin 仍然有效，
  所以已投递的草稿照样被清掉；而没 pin 过、或已被编辑取代（修订号变了）的同文草稿不会被误清。
  页面内原有的进屏基线（`openingTextReceipt`）与编辑代际判断保持不动，`FirstBatchAcceptanceTest` 3 项一条未改、仍通过。
  依据：`FirstBatchAcceptanceTest` 锁的是「旧回执不得误清」，与「离开页面后的真回执要清」不冲突，因此不需要改那些断言；
  两条用户利益（不重复发送 / 不吞未发送内容）由 pin 的修订匹配同时满足。
  `DraftBookAcceptanceTest` 从 5 项增到 9 项：读文本不授权确认、显式 pin 后可清、离开页面后到达的回执可清、
  pin 之后又改过的内容不被旧回执清掉（A→B→A 用例改为经 `pin()` 提交）。
- 收口命令（专用未配对模拟器 `CodeKiln_Members_Test`，API 37，1080×2400 / 420 dpi）：
  `./gradlew check` 通过（app 125 项 JVM 单测、mirror 298 项，均 0 失败 0 跳过；lint 通过）；
  `./gradlew :app:connectedDebugAndroidTest` 共 111 项、0 失败、17 项 opt-in 跳过（其中含本轮新增 1 项）；
  `./gradlew :app:assembleDebug` 通过。
- 产物：`app/build/outputs/apk/debug/app-debug.apk`，40,307,065 字节，2026-11-15 14:15:03，
  sha256 `b336f89573a712e8c66b01aa00578c27c057368573edee4e74fc586fc307b21e`（就是 14:15 整跑装到模拟器上的那个）。
- 仍未验证（未解决的环境阻塞）：本机没有 `go`（`go: command not found`），两个隔离 smoke 跑不了，
  因此 17 项 opt-in 里「配对回环、真桌面往返、通知权限真机拒绝」仍未独立验证；本轮只跑 gradle 与专用未配对模拟器，
  没有安装系统软件、没有占用实体机。另外仍未验证：实体手机和深色模式真机观感。
- 未正式发布、未提交/推送本轮大批工作区变更；侧载 APK 仅用本机测试证书，不能冒充正式签名。
