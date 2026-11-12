# 小满 — Android

Kotlin / Jetpack Compose 原生客户端。App 现可**配对单台电脑、创建纯文字任务、查看会话、处理审批和提问、发送文字或图片、排队、插话和停止、管理会话目标、查看任务看板、重试与压缩上下文**。

## 本批范围

- `:app`、`:mirror`、纯 JVM `:pair` 三模块与校验过 SHA-256 的 Gradle Wrapper。
- `EnsoTheme`：`ensocode-android.vetd/theme.css` 浅色 token、开发文档 §5.1 深色 token、字体层级、玻璃表面、状态色。
- 按现有 TSX 源稿落地新任务 `index`、抽屉 `home`、空态 `empty`、连接页 `pair`、会话 `session` 和提问 `ask`。
  保留真实 Android 系统状态栏和手势条，不画 iOS 状态栏。
- `eaves-logo.vetd` 的雨帘标志和运行中小尺寸静态帧。雨丝动画尚未接入。
- 可用的页面导航、系统返回、抽屉搜索与状态 / 项目筛选；纯展示规则的 JVM 单测、基础 Compose 导航测试。
- `.github/workflows/build-android.yml`：PR / main 的向量一致性、Go 中继联调、Android 单测、lint 和 debug 构建（未包含签名发布）。
- 生产入口可扫码、粘贴配对链接或从 `enso://pair` 深链预填，再由用户确认。凭据和防重放 pin
  由 Android Keystore 加密，存入不参与备份的文件；App 重启能恢复配对，支持解绑与失效记录清理。
- 前台 OkHttp WebSocket：认证后读取目录，支持心跳和断线退避；被替换不自动抢回。
- 单会话订阅与尾窗快照、增量游标续传、显式历史分页；Markdown 正文、用户气泡、工具/思考步骤折叠。
  审批/回答仅限已认证、已同步、非只读且未过期的当前请求；发送后保持待确认，不伪装成功。
  受保护审批不提供“本会话总是允许”，代审中不显示人工按钮，selectionOnly 不接受自由文本。
  到期倒计时依赖手机时间；时钟不同步可能提前禁用按钮，桌面仍负责最终校验。
- 已同步的可操作会话支持 `prompt` / 显式 `steer` / `abort`。普通发送不自动改成插话，插话也不等同于消息排队。
  现有协议没有投递回执；只有同一 epoch 的新用户消息与文字匹配时才清空未修改的草稿。不乐观插入消息，断线或超时不重发。
  不会在手机上唤醒未加载的历史会话；这种会话需先在桌面打开。草稿只保存在当前页面进程的内存中。
- 空闲的已有会话可通过系统照片选择器选择最多 4 张 JPEG / PNG。输入限制 24 MiB / 8000 万像素，校正 JPEG 方向，
  转成最长边不超过 1600 px 的 JPEG；不发 URI、原图元数据或文件名。图片原始编码体合计最多 700,000 字节，
  文字、JSON 转义、Base64、防重放信封及加密开销也计入中继 1 MiB 帧限制。待发图片有缩略图，可移除。
  支持不带文字发送。收到同一会话、同一 epoch 的新用户消息且文字和有序图片摘要均匹配才清掉已提交的附件；失败保留草稿，不自动重发。
- `queue` 原生面板：运行中可把文字交给桌面排队，当前轮结束后由桌面出队。可编辑文字、删除、立即发送/插话，或确认后打断当前轮并发送指定项。
  队列只来自当前会话的已认证目录；等待、超时和只读时不乐观添加、修改或删除，不自动重发。发送动作观察到条目离队，不冒充正文已送达。
  来自桌面的图片仅保留附件标记；不新增、下载或替换附件，不支持重排。
- 会话右上角菜单可设定目标；顶部目标条打开详情，支持改目标、暂停、继续及确认清除。
  `goal-set` / `goal-pause` / `goal-resume` / `goal-clear` 沿用现有协议；设定或继续可能立即启动模型轮次，沿用桌面审批设置。
  暂停和清除只停止自动推进，不中断当前轮。显示 `catalog.goal` 的实际状态、自动轮数和说明，不补造时间；桌面达成后可能直接移除目标。
  仅已认证、当前已同步的可写会话允许操作；只读可查看。每次等待后续权威目录，超时保留编辑草稿、不自动重发。
- 会话菜单显示桌面下发的上下文占用与用量（`context` / `usageTotals`）：窗口未知时只显示已用量，不编造窗口、速率或缓存命中率。
  菜单可「重试上一轮」（空闲或失败后从当前上下文续跑，运行中禁用）与「压缩上下文」（可填可选要求，运行中由桌面排队）。
  两者各只发送一次，等待同 epoch 的后续状态或 `compaction` 事件；超时、断线、切会话只标未确认，不自动重发，也不乐观修改时间线。
- 菜单还可「回退到某条消息」：只列出尾窗里真实的用户消息，按桌面语义用 `userIndexFromEnd` 选中，可选「同时恢复文件」。
  运行中或已有未确认写入时禁用。发送后等待同一会话的 `rewind-done`（不要求 epoch 相同，回退本身会改历史）；
  桌面回传的编辑框文字只在本地草稿为空时回填，图片只计数不还原。返回 `filesRestored=false` 时如实提示文件未恢复，不假装完整回退。
- 菜单「后台与协作」读取会话快照与事件里的 `subagents` / `backgroundTasks`（运行中、已完成、失败、步数、当前动作、输出尾部），
  运行中的条目可请求停止（`subagent-stop` / `task-stop`）。手机只发一次，等待后续权威帧里该条不再运行；
  超时或断线标未确认、不重发。该投影只保留有界摘要，不下载子代理完整正文；停止也不是“已终止”的执行回执。
- 菜单「产物与文件」用 `file-list` / `file-read` 浏览当前会话的工作区文件（只读，只读连接也可用）：
  列表来自宿主文件 ID，读取按 `PAIR_FILE_CHUNK_BYTES` 分块；手机不持有路径，不写工作区，不把整份文件落盘。
  文本要求合法 UTF-8（出现替换符或 NUL 即按二进制处理），PNG/JPEG/GIF/WebP 按签名识别为图片并解码；
  超时、断线或切会话即清空列表，不自动重试。图片仅预览，不提供下载/分享。
- 会话时间线里的图片附件按权威投影直接显示（最多 4 张缩略图，点开看大图）；Base64 不合法或解码失败的附件保留占位，
  不会渲染破图。校验与解码使用 `java.util.Base64`（API 26+），因此规则可在 JVM 单测覆盖。
- 会话时间线使用权威 `todo` 结果的结构化待办（旧结果仅回退解析可验证的完整清单），不把工具参数当成已执行状态。
  对齐旧手机网页的每轮工作摘要：思考、调用、通知和已替换的待办折成一行，保留可展开的细节和失败计数。
  展开的思考与工具步骤沿用 PC 端图标分类，读取、检索、终端和网页工具不再共用一个图标。
  回复、最新待办、工具返回图片和上下文压缩摘要仍各自可见；执行中不收走正在输出的正文。
- `members` 页面按设计分为收件箱、群聊、单聊，头像、叠放头像、运行点和相对时间来自真实目录；
  点开群聊按 `bot-chat-open` / `bot-timeline` 拉取全屏群时间线，支持 human/bot/system 与 delegation/progress 委派进度卡，
  可「加载更早」。`bot-event` 只触发打开群聊的合并只读刷新，关闭聊天后停止刷新；不重发业务写入。
  桌面关闭 Bot 模式时明确说明而不是显示空列表。私聊使用 `chat.sessions` 的权威 conversationId 订阅既有快照/增量/历史，
  可查看真实正文、执行记录、待办与图片；收件箱审批/提问打开对应成员会话，复用既有请求过期、只读和待确认门控。
- 尚无单聊时用 `bot-direct-open`（桌面声明 `directOpen=true`）按成员 ID 首次打开；既有单聊保持原 ID，不恢复归档单聊。
  右下「新群聊」选择 2–64 位成员、主持人与群名（最多 200 字），通过 `bot-group-create` 新建独立聊天工作区。
  等匹配回执与目录同时确认后才打开，不乐观新建；桌面按设备+requestId 提供进程内 10 分钟幂等，超时不会自动重发。
- 会话菜单「新对话」使用 `bot-new-session`：正在工作的群聊需二次确认，成功后靠权威目录/时间线刷新。
  失败系统行可 `bot-retry`；可忽略的收件箱行等待 `bot-inbox` 真正移除，不在手机自行删除。
- 回复的产物入口读取 `bot-artifacts`，图片用 `bot-artifact-image`；文本/Markdown 用 `file-list` / `file-read` 的 bot target，
  只把桌面签发的 opaque fileId 用作读取参数，rel 仅用于展示。分块只保存在内存，支持图片与 Markdown/文本预览；
  HTML 作为文本，不执行脚本；PDF、下载、分享仍未接入。只读可查看产物，断线或切聊天清空文件投影。
- 会话内可向成员发消息（`bot-send`，UI 生成 UUID deliveryId，按 `bot-send-result` 结算 ok/失败）与停止群聊当前轮（`bot-stop`，
  以晚于发送的 `bot-chat-state.current` 变空为观测，不承诺队列已清空）。发送前做 JS trim 与 32000 字符上限。
  草稿保留到匹配 deliveryId 的成功应答；关闭聊天再打开仍保留，确认不会擦掉后来编辑的文字，仅存在当前页面进程内存。
  15s/10s 超时只标未确认、不自动重发；只读连接与后台一律拒绝写入，过期 UI 动作不能跨可见性/认证代际执行。
  成员发图与语音输入尚未接入，入口不会伪装可用。
- 群聊「话题」入口只在桌面认证目录声明 `threads=true` 时出现，列出主话题和该根群下未归档的子线程。
  新建/切换使用原有 `bot-thread-create` / `bot-thread-select`，按根群 ID + requestId 匹配回执，
  并等待认证目录的实际选中项再打开正文；不修改本地权威目录，不自动重试。新线程可能复用桌面上现有空话题。
  只读可查看线程，不可切换或新建。切换会同步桌面当前话题，但不停止旧话题正在进行的轮次。
- 菜单「网页预览」用 `preview-list` / `preview-open` / `preview-frame` / `preview-refresh` / `preview-close`
  与 `preview-input` 串流电脑上的页面：打开时按受控视口（320–1280 × 240–1200）请求帧，点按与拖动按显示比例换算成页面坐标，
  按键条（Tab/Esc/回车/上下/退格）与文字输入也转发给页面。帧只接受 png/jpeg dataUrl 前缀；同一设备同时只有一个预览操作，
  超时置错、不自动重发；切会话或断线即清空。手机不执行页面脚本，也不缓存帧。
- `board` 原生看板按目录字段分组「等你处理／运行中／今天完成」：待审批/待回答优先，归档不出现，缺少时间的完成项不会被当作今天完成。
  看板只提供进入会话，不做内联允许/拒绝——目录没有请求 ID，内联操作需要桌面 B2 下发请求摘要。
- 配对页可显式开启后台提醒，Android 13+ 在点击时申请通知权限。`LinkService` 声明 `remoteMessaging`，
  只有成功进入前台服务后才给现有 DesktopLink 保活，不建立第二个连接。常驻通知可停止，UI 可关闭；不从后台静默启动。
  presence 与 UI 可见性分离：熄屏后仍收目录，但发 `visible=false`。后台禁止写入；新连接的正文重订阅等回到前台再做。
- `attention` / `done` / `link` 系统渠道分别提示待审批/回答及错误、轮次结束、连接状态。只根据已认证完整目录生成提醒，
  前台不弹、离开前台补仍待处理的请求，权限关闭/解绑/失效会结束服务。同一任务覆盖通知，完成通知可分组。
  本批仅点开任务，不含允许/拒绝/内联回复；通知正文不放代码和工具参数，锁屏公共版本只显示通用提示。
  服务为 `START_NOT_STICKY`，强停、进程被杀或电脑授权被替换后不会自动抢连；重开 App 后需再次主动开启。
- `new-config` 原生底部面板读取桌面真实的本地项目、服务商和模型；过滤 SSH/归档项目，重复 ID 依桌面首项定义。
  预设列表未下发，因此预设控件禁用，省略 presetId，由桌面决定。默认全程审批，可选标准思考档位或不指定（由桌面决定）；不伪造模型能力或“上次使用”。
  已选项目/模型被移除时不静默换目标；保留描述，要求重新选择。
- 创建只发一次 ID 型 `spawn`，由 Main 反查 cwd。现有协议没有 spawn-result：只有认证目录出现此次 UUID 才进入新会话，
  同一连接的新鲜空闲空快照到达后才最多发一次首句。配置失效、断线、超时、切会话或同步失败不自动重建/补发。
  结果不明时保留描述和 UUID（内存），先检查桌面；“已检查桌面，允许新建”仅解除限制，不会自动重发。

**协议进度**：纯 JVM `:pair` 已有 Base64URL、配对链接解析、NaCl 换钥、AES-256-GCM 帧、
防重放和严格会话同步校验；直接消费桌面端生成的共享向量。换钥固定使用 Maven Central 的
`org.purejava:tweetnacl-java:1.1.2`，验证低阶公钥、盒子长度和认证标签，不引入 JNI。
配对链接解析不等于授权连接：实际 claim 之前，连接层仍须校验中继 URL 和 32 字节公钥。
`FrameReplay` 为同一 content key 管理 nonce 和可信状态，不替代连接层的命令门控或密钥存储。

Kotlin JSON 兼容层在库解析前校验裸 token / 控制字符，并保留合法重复键的最后一个值；
为保护 Android 线程栈，拒绝超过 128 层的对象 / 数组嵌套（当前协议信封远低于此深度）。
这是接收端资源上限，不修改线上帧格式；拒绝应由后续连接层当作坏帧丢弃，不断开连接。
解析失败只抛通用错误，不附带可能包含解密明文的库异常。

**尚未实现**：预设选择、SSH/worktree 新建、新任务/插话/队列图片、拍照、队列重排、改动审查、多电脑管理、离线目录缓存、通知内直接操作/静默时段/成员提醒、
WebRTC / 分片 / 语音、成员发图/语音、Bot PDF/下载分享/成员配置编辑，以及正式签名发布。
Markdown 正文支持长按选择；围栏和缩进代码块右上角「复制」写入完整代码，即使超出屏宽也不会截断。
网页链接在用户点击后才交给 Android 打开，仅接受有主机名的 HTTP/HTTPS；不打开 `file:`、`intent:`、`enso:` 等协议，
也不加载远程图片。详细缺口和验证边界见 [实现与验收状态](IMPLEMENTATION_STATUS.md)。
已用 Android 模拟器的实际 App、Go 中继和 TS fake host 验证配对、目录、会话审批/回答、发送/插话/停止、配置创建、重启和解绑；
真实 Electron/Main/worker 的隔离本地联调由下述脚本覆盖；未对实体手机、真实厂商模型或线上中继完成验收。

### 设计与协议的已知差距

`frames/pair.tsx` 的局域网地址与六位验证码没有对应线上协议。真实入口保留原稿取景框、布局、输入胶囊和按钮，
手动项改为粘贴桌面二维码链接，扫码只预填，确认后走现有中继 claim。六位码只保留在 debug 设计对照入口。
生产版只接受 HTTPS；debug 仅为 `adb reverse` 测试额外允许字面量 `127.0.0.1` 的 HTTP。
claim 是一次性操作：仅在请求尚未开始发送的网络故障后重试一次；发送后的响应丢失会提示“结果不确定”，
不重复认领。此时需在电脑端检查旧授权并生成新的配对码。DELETE 解绑可安全重试。

设计源文件优先于旧截图（旧截图还留有 EnsoCode 字样与已被雨帘替换的旋转图标）。看板“还有 N 个”按实际等待 / 运行中任务计算，不复制示例中的硬编码数字。

## 构建与验证

- Android SDK Platform 36、Build Tools 36.0.0；最低 Android 8.0 / API 26。
- Gradle 9.3.1、AGP 9.1.1、Kotlin 2.4.21；JDK 17+（开发机的 JBR 25 可运行）。
- 设置 `JAVA_HOME`、`ANDROID_HOME`；也可以使用仅本机的 `local.properties` 配置 `sdk.dir`（不要提交）。

```sh
cd android
./gradlew :app:testDebugUnitTest
./gradlew check :app:assembleDebug :app:assembleDebugAndroidTest
./gradlew :app:connectedDebugAndroidTest  # 已启动模拟器 / 已连接真机
```

Windows 使用 `gradlew.bat`。根目录的 pnpm 检查不覆盖 Kotlin。

设备测试请在专用、未配对的模拟器上运行，并用 `ANDROID_SERIAL` 指定设备。`connectedDebugAndroidTest`
可能在测试后卸载目标 App，清除原有配对；只更新手动验收用的模拟器时，使用 `adb install -r`。

若默认 ADB server 是其它账户（例如 root）启动，模拟器可能持续 `unauthorized`，不要为测试重置用户的配对或杀掉其它工具的 server。
可用当前账户另开端口，例如 `adb -P 5038 start-server`，并在本次进程设置 `ADB_SERVER_SOCKET=tcp:127.0.0.1:5038`
与 `ANDROID_ADB_SERVER_PORT=5038`，保持 CLI 和 Gradle 都使用同一 server。验收完只停止本次创建的 server。

成员会话不在 Code 任务目录中；私聊/收件箱跳转只用已认证 `bot-chats.sessions` 或 `bot-inbox.conversationId`，
不能把 Code catalog 当所有合法会话的白名单，也不要从收件箱 key 字符串猜会话 ID。聊天 title 和成员职位可为空，不能因此丢弃整条目录。

仅在受限网络需要时，把代理设在**当前进程的 JVM 系统参数**，不要把个人代理写进仓库。

已在 1080×2400 / 420 dpi 的 API 37 模拟器验证导航、空态、搜索、配对和会话响应。
`SessionScreenTest` 覆盖审批、代审、受保护/只读/过期和选项回答；`PairCryptoDeviceTest` 使用 Android JCE 和共享向量验证 NaCl 与防重放；
向量只进入测试 APK。测试依赖显式使用
Espresso 3.7.0：Compose UI test 传递依赖的 3.5.0 会在 API 37 因反射已移除的
`InputManager.getInstance()` 而在断言前失败。它不是应用运行时依赖。

### 跨语言测试向量与 fake host

在仓库根目录（Node 22.22+）：

```sh
pnpm pair:vectors          # 用实际 TS 源码重新生成六份 fixture
pnpm pair:vectors:check    # 逐字节比对，不写文件
PAIR_FAKE_HOST_GO=1 node --test scripts/pair-fake-host.test.mjs
```

最后一条需要 Go 1.24.4+。PowerShell 用 `$env:PAIR_FAKE_HOST_GO='1'` 后再执行 Node 命令。
烟测自动在临时目录构建并启动 `relay-go`，走真实 HTTP claim / WebSocket，验证防重放握手、
目录、快照与增量、流式消息、审批、提问、完成、失败和解绑；不会访问现有桌面数据。
日常 `pnpm test` 不要求安装 Go，仍会执行向量校验和 fake host 的边界测试。

Kotlin guest 的回环联调用同一套 Go 中继和 TS fake host，在仓库根目录执行：

```sh
./android/gradlew -p android :pair:interopTest
```

Windows 用 `android\gradlew.bat -p android :pair:interopTest`。需要 JDK 17+、Node 22.22+、
已安装的 pnpm 依赖和 PATH 上的 Go 1.24.4+。这个任务强制运行，不接受缓存或跳过结果。
它使用临时 SQLite 和随机端口，验证 Kotlin 认领、加密 WebSocket、挑战回声、同步/审批/提问、
失败和撤销后旧凭据被拒绝；pin 回调只在测试内模拟成功，没有持久化用户数据。

实际 App 回环烟测（仅模拟器，拒绝覆盖现存配对）：

```sh
./android/gradlew -p android :app:assembleDebug :app:assembleDebugAndroidTest
node scripts/android-pair-smoke.mjs
# 另验会话审批/回答/发送/插话/队列/停止 → 选项目/模型/思考/审批 → 创建 → 收到首轮输出
EAVES_SESSION_SMOKE=1 node scripts/android-pair-smoke.mjs
# 熄屏后目录审批通知 → 系统通知点击准确会话 → 停止服务与解绑
EAVES_BACKGROUND_SMOKE=1 node scripts/android-pair-smoke.mjs
```

脚本使用 `ANDROID_HOME` 和 PATH 上的 Go，默认 `emulator-5554`（可用 `EAVES_TEST_EMULATOR` 覆盖）。
启动临时 Go 中继、建立临时 `adb reverse`、验证 App 链路后解绑并移除转发；截图输出在 `temp/eaves-pair-live/`。
日常 `connectedDebugAndroidTest` 不需要启动中继，回环用例由该脚本单独运行。
PowerShell 使用 `$env:EAVES_SESSION_SMOKE='1'` 后运行 Node 命令。
后台测试临时授予通知权限（结束后恢复），不会读取或覆盖已有配对；未验证实体手机锁屏 30 分钟、Doze 或厂商后台策略。

真实桌面联调（与 fake host 烟测不同，模型仍为本地确定性服务）：

```sh
./android/gradlew -p android :app:assembleDebug :app:assembleDebugAndroidTest
node scripts/android-desktop-smoke.mjs
# 浅色、空媒体库的 API 33+ 模拟器：打开系统 PhotoPicker，选择生成的唯一测试图，比较 worker 发送的 JPEG 摘要
EAVES_DESKTOP_IMAGE_SMOKE=1 node scripts/android-desktop-smoke.mjs
# 额外验证设定 → 暂停当前自动目标 → 继续 → 清除，以及两次实际 worker 请求
EAVES_DESKTOP_GOAL_SMOKE=1 node scripts/android-desktop-smoke.mjs
# 额外验证已启动会话的思考开关和深度、模型切换：目录确认，下一轮实际走新服务和模型
EAVES_DESKTOP_MODEL_SMOKE=1 node scripts/android-desktop-smoke.mjs
# 创建一次性成员与群聊：手机发送，验证群正文刷新和当前轮停止
EAVES_DESKTOP_BOT_SMOKE=1 node scripts/android-desktop-smoke.mjs
# Bot 烟测中再验证创建话题 → 空时间线 → 切回主话题
EAVES_DESKTOP_BOT_SMOKE=1 EAVES_DESKTOP_BOT_THREADS_SMOKE=1 node scripts/android-desktop-smoke.mjs
# 另验手机首次单聊 → 发送 → 再订阅同一历史，以及手机新建两人群（可与 threads 合用）
EAVES_DESKTOP_BOT_SMOKE=1 EAVES_DESKTOP_BOT_MEMBERS_SMOKE=1 node scripts/android-desktop-smoke.mjs
```

脚本启动当前源码的 Electron dev / Main / worker，使用临时 userData、临时项目、随机且非 9222 的 CDP 端口、
临时 Go 中继及本地 Anthropic 兼容模型服务。写入前核对 CDP browser PID 属于本次子进程树，拒绝覆盖 App 现有配对。
验证从手机选择非默认项目和模型，Main/worker 实际配置与 cwd、单次首句投递、进程重启恢复和解绑；
验证运行中入队、编辑，等待当前轮结束后用 Main 权威历史核对只发送一次编辑后的文字；
另以无副作用的 echo 命令确认“自动接受编辑”仍要求命令审批，并在手机拒绝，不授权任何实际破坏性操作。
证据只记录脱敏元数据，输出在 `temp/eaves-real-desktop/`；结束后清除临时配对、转发、profile 和子进程。
当前在 Windows + API 37 模拟器验证，不代表实体手机、线上中继或两家真实厂商模型的验收。
API 37 的系统 PhotoPicker 若不暴露确认按钮的可访问性节点，测试仅在识别到浅色按钮像素时补一次点击；
深色下该测试兜底不会触发，不属于生产图片选择器逻辑。

手动启动时，在 `packages/relay-go/` 执行 `go run . --listen 127.0.0.1:8787 --db <临时目录>/relay.sqlite --auto-update=false`，
然后在根目录执行 `pnpm pair:fake-host`。只接受回环中继，打印不含私钥、会话密钥或令牌的配对链接（TTY 也显示 QR）。
若需要浏览器 PWA，先按 [`relay-go` 文档](../packages/relay-go/README.md) 嵌入前端；直接 `go run` 的占位页不影响协议烟测。
`packages/pair/vectors/` 的密钥仅供测试，不能用于实际连接。

### 原稿对照入口（仅 debug）

安装 debug APK 后：

```sh
adb shell am start -n io.github.tingyuxuan123.eaves/.DesignPreviewActivity --es frame index
adb shell am start -n io.github.tingyuxuan123.eaves/.DesignPreviewActivity --es frame home
adb shell am start -n io.github.tingyuxuan123.eaves/.DesignPreviewActivity --es frame empty
adb shell am start -n io.github.tingyuxuan123.eaves/.DesignPreviewActivity --es frame pair
adb shell am start -n io.github.tingyuxuan123.eaves/.DesignPreviewActivity --es frame session
adb shell am start -n io.github.tingyuxuan123.eaves/.DesignPreviewActivity --es frame ask
adb shell am start -n io.github.tingyuxuan123.eaves/.DesignPreviewActivity --es frame members
adb shell am start -n io.github.tingyuxuan123.eaves/.DesignPreviewActivity --es frame group
adb shell am start -n io.github.tingyuxuan123.eaves/.DesignPreviewActivity --es frame bot
```

样例仅来自 `ensocode-android.vetd/components/data.ts`，源码和 Activity 都在 `src/debug/`，不会进入 release。debug 样例的发送按钮也不可用。系统切换深色模式可比较相同页面的深色分支。
`session` / `ask` 的文案与缩略图来自对应 TSX 和 assets，只用于设计对照；真实请求没有选项图片时不伪造缩略图。

发行版独立版本号见 `gradle.properties`；未配置签名和发版流程，不在本机生成对外 release。以后按 `android-v<version>` 交给 CI 发布。
