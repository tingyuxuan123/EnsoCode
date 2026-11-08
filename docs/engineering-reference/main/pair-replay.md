# Pair 帧防重放

## 行为与所属层

`packages/pair/src/replay.ts` 在既有 AES-GCM 帧之上维护连接质询和接收窗口。
桌面 host、桌面 guest 和 PWA 的直连/中继共用同一状态；一条消息只封装一次，再选择传输。
中继只转发密文，不获得密钥，也不负责业务去重。

## 安全边界

- 每个发送实例使用随机前缀和同步预留的单调计数；同一实例重连不能重置发送计数或接收去重记录。
  计数耗尽不能回绕；已处理或落在窗口外的帧丢弃，窗口内未处理的乱序帧仍可接收。
- 新版帧包含方向和质询回声。每一条可信业务帧都必须匹配当前质询，不能仅在首次握手时校验。
  明文在线通知只触发重新证明，不能把已确认新版的对端降成旧端；本端密文反射不能推进握手。
- 解密异步返回后再次检查连接代际；旧 socket、过期直连和跨重连的结果不能更新状态或触发业务。
- 未完成认证时仅允许有限的连接/目录同步命令；写入、审批、远程调用和文件/预览操作须等待认证。
  等待队列有容量和时间上限，断线、替换或失败必须明确收口，不能静默丢失写请求。
- 接收前缀最多保存 128 个，不使用会放行旧帧的 LRU 淘汰。容量耗尽时，仅在新版能力已经成功落盘后
  才允许用新发送前缀、新质询和强制新版模式重建，并通过正常断连/重连让两端重握手；否则关闭连接。
  中继重连而直连仍存活时，不丢弃直连的认证状态。连接代际变化造成的在途失败必须明确报告。
- 防重放不是恰好一次执行协议：断线前未获业务回执时，调用方仍须按业务规则判断结果未知，
  不得把重新加密的新请求当作同一帧的重放。

## 兼容性

帧版本保持 1，旧版公开加解密 API 不开放自定义 nonce。
guest 在看到新版 host 之前不添加扩展字段，避免旧 host 严格校验文件/预览命令时拒绝请求。
旧端连接为尽力兼容，**不具备完整防重放保障**；首次认识对端能力之前也存在兼容性协商边界。
一旦验证对端具备新版能力，该能力按配对保存，重载后仍要求新版证明，不因中继声称重连而降级。
此处“旧端”指没有 `replay` 扩展字段的既有版本。上游早期未包含方向字段的 `replay` 扩展不作为
可信新版协议接收，使用这种扩展的端点需要双端升级；不得通过删除能力标记来掩盖降级问题。

## 回归防线

- `packages/pair/src/replay.test.ts`：重复、乱序、窗口边界、反射、前缀切换、旧质询、重连和并发。
- `android/pair/src/test/kotlin/io/github/tingyuxuan123/eaves/pair/FrameReplayTest.kt`：Kotlin 对照同一组
  `packages/pair/vectors/replay.json`，并在 JVM 上验证并发收发与过期解密结果；
  `:pair:interopTest` 用临时 Go 中继和 TS fake host 运行 Kotlin guest。
- `src/main/services/pairReplay.test.ts`：宿主实际派发次数及跨连接代际拒绝。
- `packages/phone/src/client.test.ts`：握手期间排队、清理、替换后不抢连及混合版本。

联调仅使用临时配对、隔离 profile 和回环中继；同一密文重复投递后要核对 Main 权威历史，
不能只凭 UI 没有重复气泡宣称成功。浏览器 PWA 联调不等同于实体手机真机验收。

Kotlin `FrameReplay` 把 content key 绑定到实例；用状态锁同步预留计数并原子提交接收窗口，
JCE 在锁外运行，结束后重新检查 epoch 和 transport generation。调用方仍须在分发和发送前检查
连接代际，并同步落盘现代协议 pin；JVM 回环测试的 pin 回调只模拟持久化成功。

桌面 `pairHost.ts` 的目录/主机信息受发送指纹去重影响，认证前收到的首帧不一定会在 `snapshot` 后重发。
Android `DesktopLink` 有界暂存 host-info、catalog、projects、providers 四类只读 bootstrap 数据，匹配同一 socket、发送端 prefix **及 challenge** 的
可信回声后才提交；切换/断线清掉暂存。写操作仍须等认证。App 的 pin 由 Keystore 加密存储同步提交，
与 `:pair:interopTest` 的模拟 pin 不同；`scripts/android-pair-smoke.mjs` 另验 App 重启后的 pin 和真实 WebSocket。
Go 中继也可能先通知已入房的 host，再给 guest 排入 `host-online`，因此新 socket 最多暂存 8 个提前到达的密文，
到首次在线控制帧后才解密，并遵守同一认证和发布规则。

后台保活不能把 `presence.visible` 伪装成 true：Android 在用户主动开启并成功提升 `LinkService` 后才允许
`DesktopLink` 脱离可见界面继续收目录；真实 UI 变为不可见时发 `presence(false)`，拒绝所有后台业务写入。
已有订阅可继续收确认，后台重新认证只取目录，回前台再补正文；被替换、撤销或服务停止不自动抢连。
通知只消费 `catalogReady` 的已认证投影，等待目录/认证断点不等于空目录，不跨断点推断轮次结束。

Android 当前仅订阅一个会话：同步回包必须命中 socket 代际、sessionId 和最新 requestId；
实时正文连续性只按 pair cursor 判断，不能把 worker 的 `event.seq` 当作 pair seq。
同步超时重试晚于桌面 1.5 秒突发去重窗口，断线/切会话立即禁用旧请求。
审批和回答在连接 actor 再次验证当前会话、请求、只读、过期、reviewing/protected/selectionOnly，
并等待权威 resolved 事件；超时或投影替换只标结果未知，不乐观删除请求、不自动重发。
`prompt` / `steer` / `abort` 没有 Pair 投递 ID 或逐条回执，socket 接受帧并不表示桌面 worker 已收到。
Android 不改权威时间线：同一 epoch、晚于发出时的游标、且位于原尾窗之后的同文用户消息仅作为送达线索；
停止以权威运行状态收束，不以本地按钮点击收束。不把这些写入挂到重连队列。
Android 普通图片 prompt 使用原有 `{data,mimeType}` 标准 Base64 附件，不传内容 URI 或文件名。
预算检查针对实际 UTF-8 JSON、转义、防重放字段和 AEAD 固定开销，不仅仅统计图片文件大小；socket 发送前再检查密文长度。
图片送达仍无单独回执：在同一 epoch 的新权威用户消息中比较原文及有序图片 MIME/摘要，不把同文纯文本或不同图片当作确认。
新任务 `spawn` 只有调用方生成的 sessionId，没有正文和 spawn-result；不增造新协议。
Android 以当前认证代际目录出现该 UUID 为创建线索，选择并同步后，仅在新鲜空闲空基线下发一次首句。
目录确认前不发正文，断线/超时/同步失败/切走均取消自动投递，结果不明也不自行重试 spawn。
`projects` / `providers` 与目录一样可能在证明前只发送一次；它们也按发送端 prefix/challenge 暂存并按帧序号提交，
重连清掉配置的权威性。不保留或回传项目路径、服务商密钥；创建只传 ID、审批模式和标准思考档位。

Android 目录解析须兼容 `slimCatalogForPhone`：未订阅条目会省略 `projectName` 等 chat-only 字段。
不能因缺少项目名丢弃整条任务；保留 `projectId`，由已认证项目表补展示名，未知项目仅省略标签。
回归在 `DesktopProtocolTest` / `CompanionPresentationTest`，真实桌面链路由 `scripts/android-desktop-smoke.mjs` 验证。
该陷阱在 fake host 帧始终带 projectName 时不会暴露，须分别保留 fake-host 互通与真实 Main/worker 联调。

队列沿用 `enqueue` / `queue-update` / `queue-remove` / `queue-send-now` / `queue-interrupt-send`。
Android 只接受订阅后的当前会话完整目录作为队列权威；未订阅条目缺 `queued` 不是队列被清空，
完整条目省略 `queued` 才代表空队列。按 ID 观察新增、编辑和离队，不用 WebSocket 发送结果当作确认。
发送/打断后离队仅表示队列变化，不代表进入正文；正文仍由会话事件和回放确认。不跨连接自动重放队列写入。

目标同样只从订阅后的当前会话目录读取：完整且未归档的条目省略 `goal` 才代表没有目标，
错误类型、重复 ID 或精简条目不能证明清除。设定/继续可能立即发起模型轮次，与在途正文/队列写入互斥；
暂停/清除不等于停止当前轮。每次目标操作只发一次，观察同一代际/epoch 的后续目录是否匹配目标文本与预期状态。
这不是模型执行回执；目标过快结束或连接断开时可能只得到结果不明，不能自动重发。

上下文占用与用量（`context` / `usageTotals`）同样是目录投影而不是回执：窗口未知时只下发 `used`，
App 不得补窗口、速率或缓存率。`retry` / `compact` 没有请求 ID 或结果帧：手机只发一次，
等待同一 epoch 后续游标上的状态变化或 `compaction` 事件；失败后的重试也按同一规则收束。
`compaction` 的 `abandoned` 表示放弃排队，不等于压缩完成。

子代理与后台任务来自会话快照的 `subagents` / `backgroundTasks` 以及 `subagent-update`、`task-started`、
`task-output`、`task-ended`、`background-tasks-level` 事件；手机只保留有界摘要（ID、描述、状态、步数、当前动作、
输出尾部、结果文本上限），不下载子代理完整正文。`background-tasks-level` 是 REPLACE 语义，
而脏行只丢该行、不整表清空；非数组的 level 帧应触发重新同步而不是当作空表。
`task-stop` / `subagent-stop` 没有结果帧：只能观察之后帧里目标不再 running，超时与断线均为未确认，不能自动重发。

Bot 文字发送使用原有 `deliveryId`：App 在点击时生成 UUID，Mirror 原样发送并按 `bot-send-result` 对号结算；
不能拿同文消息或按钮点击清空草稿。失败/超时保留文字，成功确认也只清未改动的那份草稿。
`bot-stop` 无投递 ID，只有发送之后的 `bot-chat-state.current=null` 可作为“不再报告运行”的线索；
旧序号帧不能覆盖较新的运行态，停止也不表示队列已清空。`bot-event` 通知正文变化，打开群聊需合并刷新只读页；
该刷新可以重读，但绝不能顺带重发 send/stop。私聊历史来自会话订阅，不能把群时间线接口超时等同私聊为空。

`bot-thread-create` / `bot-thread-select` 是写入桌面当前话题，不是本地切页。只有 `bot-catalog.threads=true` 才提供入口。
`bot-chats` 的 `threads` 必须匹配根群 `parentId`，归档项不可选；结果按根群 ID + requestId 关联。
即使目录先到，也要等对应在途操作结算；回执不是目录，不能凭回执伪造新话题行。`epochSeq` 是新对话分段，不是线程标识。

## 隔离联调证据（2026-11-03）

使用临时 Electron host / guest、独立 Chrome profile、回环 Wrangler 中继和密文复制器，
未访问用户已有配对。未修复基线复制同一上行密文后，Main 历史出现两条 user，假模型收到两次请求；
最终版本相同操作只产生一条 user 和一次请求。伪造 `peer-joined` 后重发捕获密文也没有新增业务，
随后新请求正常完成。

新版 PWA → 旧桌面、旧 PWA → 新桌面、双新版以及桌面 guest → host 均能收发；
新版 PWA 重载和回环中继断网重连后仍可用，已确认的新版能力保留；同配对旧标签进入 replaced，
不自动抢连。额外仅用本机 ICE 候选建立真实 DataChannel，中继离线期间新请求仍完成且只执行一次。
配对凭据、浏览器 profile、中继数据、复制器及对照 worktree 在验收后清理；未验证实体手机或公网 NAT。
