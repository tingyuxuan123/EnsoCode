# 图像生成与编辑

## 使用

1. 打开「设置 → 内置工具 → 图像生成」，在独立的「连接」区域填写 API 地址和 Key 并保存。
   地址包含版本段（例如 `https://api.openai.com/v1`），无需先添加聊天模型服务。
   Key 用系统钥匙串加密存入本机 `image-provider.json`，表单只显示是否已保存，不回显密钥。
2. 在「模型」区域手动添加模型 ID（可用逗号分隔多个），或从接口拉取后选择导入。
   第一个模型是默认模型，也可以分别选择文生图和图生图模型；不支持编辑的接口关闭「支持图生图」。
   「测试连接」和「拉取模型」都只查询 `/models`，不会发起收费图片请求。
3. 在本地 Code 聊天中提出生成图片的要求。成图会内联显示，点击放大，右键复制图片。
   图片右上角提供与 Open Vetta 一致的「编辑 / 复制 / 下载」半透明悬浮按钮：
   桌面悬停或键盘聚焦时显示，触屏常显。复制成功就地显示对勾 1.6 秒，复制的是图片字节而非路径；
   非 PNG 转成 PNG 后写剪贴板。下载保留原图格式与 UUID 文件名，不重新生成、不转码。
   「编辑图片」只向当前会话草稿插入图片 ID，补充修改要求后由用户发送；不自动收费改图。
4. 也可要求编辑工作区内的图片：`sourceImagePath` 接受工作区内相对/绝对路径。
   工作区外上传附件需要先由用户允许复制到项目，再把路径交给改图工具。

结果写到当前会话的权威工作目录（含 worktree）的 `.xiaoman/images/<UUID>.<ext>`，
不会覆盖旧图。历史预览从 JSONL 工具结果里的小引用重新构建，不依赖内存或大段 base64。
删除/移动文件后预览会提示不可用，不重新收费生成。

## 独立图片工作台

图标轨的「图片工作台」提供独立图片会话，Code 入口始终保留；不复用 Code 的项目侧栏，
也不创建聊天 worker。界面按 `image-studio.vetd` 的聊天式布局实现：示例只填草稿，
用户发送才发起收费请求；画图、模型、档位都打开同一参数弹窗，右上开关打开生图历史。
Main 落盘确认本次新消息后立即清空已提交的输入和参考图，不等待图片生成结束；预校验拒绝则保留草稿。
草稿和参考图按修改版本守卫，迟到确认与终态回包都不能清掉用户随后新写的内容。
模型只来自已配置的独立图片服务，不借用聊天凭证，也不编造示例历史、用量或模型。
模块独立只隔离会话与产物，不另造公共交互：左右分栏复用 Code 的 `ResizeHandle`、
限宽和拖至边界时侧栏自动收放；左侧共用宿主侧栏宽度，右侧单独记住历史宽度。
窄窗口只限制实际显示宽度，不覆盖用户偏好；关闭历史只恢复自动收起的侧栏。
图标轨顺序为 Code、图片工作台、设计、Bot、看板；Bot 模式下图片入口仍常驻，
点击图片入口退出 Bot 并进入原图片工作台，不丢弃 Bot 聊天或生图会话。
数量下拉可选 1–10 张；示例图里的「1 张」只表示示例选中值，不是数量上限。
一条提示词对应一批图片，Main 复用单图接口逐张请求并即时保存与展示；每张可能计费，
失败即停止整批，不自动重试或继续请求剩余图片。取消保留已出图并中断当前及后续请求。
旧单图记录仍可读取，缺少数量时按 1 张处理；批次历史计数、预览和改图均按实际成图计算。

- 工作目录由 Main 创建为 `userData/image-studio/<session UUID>/`；`session.json` 保存会话，
  成图仍在其 `.xiaoman/images/` 中。会话正文不写入全局设置或 localStorage。
- `imageStudio` typed IPC 仅主界面 top frame 可用；只收会话/图片 ID、提示词和选项。
  参考图只由原生选图框授权导入，复制为本会话 UUID；不能传任意路径，不能跨会话引用。
- 参数只覆盖本次调用，不修改服务默认值；全自动保留服务配置，显式比例/分辨率/质量
  优先于服务额外 JSON。历史仅记录真正发送的尺寸，缺省不推测；`auto` 与合法维度写读一致。
- running 与终态各在原子落盘后广播；同会话拒绝并发请求，取消真正 abort，失败不自动重试。
  重启遗留 running 修复为 cancelled。文件 ID 必须绑定请求目录，坏记录拒绝读取。
- 会话记录上限 1 MiB；running 写入时为终态预留空间，不能在付费成功后才发现记录写不下。
  原图/参考图上限 32 MiB；历史只读取长边不超过 480 的缩略图，打开预览再读原图。
  删除会话需确认并清理整个独立目录，在途会话拒绝删除。

实现位于 `shared/imageStudio.ts`、`main/services/imageGeneration/studio.ts`、
`main/ipc/imageStudio.ts` 与 `renderer/features/imageStudio/`；对应测试覆盖预校验、
隔离目录、坏配置、容量、迟到回包、参数优先级、取消及收费请求去重。
隔离 Electron + 本地模拟图片服务已核对浅/深主题、文生图、4K/16:9 multipart 改图与父图关联、
历史缩略图、取消上游连接和重载恢复；没有调用真实付费图片接口。

## 生成过程动效

独立图片工作台直接复用聊天的 `GeneratedImageSkeleton`，不以简化转圈替代。
多图批次保留已出图，仅给当前正在生成的一张展示动画；完成、失败、取消后移除。

生图和改图运行中展示 Open Vetta 同款流动色块占位卡：五个模糊色块错相漂移、
背景缓慢旋转，中间图标呼吸并显示「正在生成图片…」或「正在编辑图片…」。
按用户参考图固定采用 Vetta mono 浅色的黑/浅灰/蓝配色（不随小满强调色换成橙绿），
配原版白色 Solar 图标与「图像处理中」标签；桌面与手机 PWA 共用 `styles/shared.css`。
占位卡是完整产物行，不会被紧凑工具组压成单行摘要，也不依赖自动展开文件改动开关。

请求结束即移除占位卡；成功图片在实际 load 后淡入，失败、停止或缺图不保留无限动画。
系统开启「减少动态效果」时，漂移、旋转、呼吸、淡入全部停用，状态提示仍可见。
这只是运行状态反馈，不代表图片服务上报的真实进度；不新增轮询或收费请求，
不移植上游的图片版本轮播。

## 输出参数

- 跟随对话：透传 Agent 提供的尺寸，没提供时不发送 size；不传模式始终不发送 size。
- 1K / 2K / 4K：保持请求的宽高比，长边缩放到 1024 / 2048 / 3840，按 16 像素对齐。
  如 Agent 申请 1536x1024，2K 实际发送 2048x1360，与用户提供的 0.3.1 插件一致。
- 固定尺寸：使用设置的 WIDTHxHEIGHT。手动尺寸每边限制在 64–4096。
- 质量：原样发送 quality，可选 auto / low / medium / high / standard / hd 或不传。
- 额外 JSON：合并到请求体，可覆盖 size / quality，但不可覆盖 model / prompt / n / image / mask。
  非对象、超限及危险原型键拒绝保存。JSON 请求保留类型；multipart 的对象和数组序列化为 JSON。
- 表单给出 1536x1024 请求的实际参数预览；未保存的 JSON 预览会明确标注。

## 兼容旧配置

从 0.2.72 升级且未保存独立图片配置时，原来的聊天 provider 引用继续有效，历史图片不动。
首次保存独立配置后不再自动回退旧服务或旧 Key；缺 Key、模型被移除或图生图被关闭均失败关闭。
更换 API 地址会清掉旧 Key，另一窗口更新地址也会清空本窗口未保存的 Key 草稿。
新输入 Key 的 IPC 请求绑定预期端点，避免把旧凭证误存给新端点。

## 移植范围

参考 Open Vetta 的 `image-gen` 插件及 `openai-compatible-image-provider.ts` 请求协议。
复用小满的内置工具、审批、会话历史和图片查看器；连接、模型列表及加密凭证独立管理，不移植其
订阅云网关、通用 media jobs/registry 或插件运行时。独立图片工作台使用自己的 Main 会话与历史，
不把上述插件存储搬入宿主。Agent 生图工具仍只开放本地 Code 根会话；SSH、Bot、子代理不具备该工具。

### 图片与画布的工具分工

「画/生成一张海报、壁纸、插画」默认交付图片，用 `generate_image`；4K 16:9 对应
`3840x2160`。明确要求可编辑布局、排版、UI、幻灯片或 `.vetd` 源码时才走设计技能。
不能仅因「海报」一词或已打开画布就用 `vetd_create`、TSX/HTML/SVG 替代图片生成。
`promptCatalog` 每轮按实际 active tools 注入图片路由段，禁用/未配置时不宣称具有该能力；
工具说明和内置设计技能同步声明边界，不做关键词强制拦截，也不绕过计划/审批。
修改 worker 路由与技能后需重启 dev；已读过旧设计技能的会话建议另起新会话，配置无需重填。

## 分层和安全

- `shared/imageGeneration.ts`：有界参数归一/校验、脱敏设置引用和固定路径结果。
- `shared/imageProvider.ts`：独立连接配置、模型列表、尺寸策略和输出参数；
  `imageGeneration/providerStore.ts` 管理固定路径原子保存与安全加密，钥匙串不可用不降级明文。
- `main/services/imageGenerationConfig.ts`：调用时从 Main 权威设置取服务和凭证；
  `agentHost` 只向 worker 推两个可用性布尔值；Renderer 可读地址、模型和输出设置，不可读 Key。
- `agent/tools/imageGeneration.ts`：`generate_image` / `edit_image` 完整 schema，归一化在
  schema 前；沿用 command 审批和 Plan 写门；只允许直接调用，不能绕进 codemode。
- `main/services/imageGenerationBridge.ts`：generation/权限/工作根由 Main 复核，requestId
  去重，取消/结束/worker 退出中止请求，迟到结果不投递。
- `main/services/imageGeneration/service.ts`：JSON generations / multipart edits；每次一图，
  300 秒期限，**不自动重试**。提示词和参考图会发给用户选定服务，每次可能计费。
- 上游 JSON/图片/参考图均有大小上限；只接受 PNG/JPEG/WebP/GIF 魔数。上游错误遮密钥并截断。
  返回 URL 走公网图片下载器，拒私网、mapped IPv6、DNS rebinding 和恶意重定向，不携带 API Key。
- 参考图在真实根内解析，用无跟随的 fd、身份比对和有界读取；写文件在网络等待后重新
  检查真实目录，无异步间隙地排他打开、验证并写入。Node 未提供跨平台 openat；这不是
  防恶意本机进程持续替换整个目录树的 OS 沙箱。
- 图片模型选择与独立连接仅存本机，不随配置同步导出。旧 provider 凭证仍受 Main settingsSecrets 管理。
- 图片设置 IPC 只允许主界面/设置窗的本地入口 top frame；不接收任意文件路径。
  模型发现从 Main 读取固定连接，禁止 Renderer 指定请求目标，15 秒覆盖代理准备、GET 与响应体。

## 回归

`shared/imageGeneration.test.ts`、`shared/types/imageGenerationProtocol.test.ts`、
`main/services/imageGeneration{Config,Bridge}.test.ts`、`main/services/imageGeneration/service.test.ts`、
`agent/tools/imageGeneration.test.ts`、`renderer/stores/sessions/imageGeneration.test.ts`。
公网下载边界另由 `remoteImageGuard.test.ts`、`remoteImageFetch.test.ts` 覆盖。
独立配置由 `imageProvider.test.ts`、`imageGeneration/provider{Store,Api}.test.ts`、
`ipc/imageGeneration.test.ts`、设置表单与 hook 测试覆盖。
动效状态回归见 `renderer/components/chat/TimelineRow.image.test.tsx`、
`GeneratedImageCard.test.tsx` 及时间线测试。隔离 Electron 的模拟图像服务已验证
生图/改图占位、图片 load 后淡入、请求失败与手动停止无残留，以及 reduced-motion 全部停用。
工具栏由 `GeneratedImageCard.test.tsx`、`imageClipboard.test.ts`、`imageDownload.test.ts` 覆盖。
隔离 Electron 已核对按钮尺寸、悬停与聚焦显示、下载原文件字节一致和编辑只写草稿。
复制的 PNG 字节与对勾反馈在剪贴板写入边界替身下验证；未将窗口焦点受限的测试宣称为原生剪贴板实测。
图片路由由 `agent/imageGenerationRouting.test.ts` 和 `promptCatalog.session.test.ts` 覆盖，
后者验证真实 SDK 的最终请求含条件路由、禁用后消失且 persona 不抹掉边界。
针对临时会话「画一张 4K 16:9 海报」的误路由，用 DeepSeek V4.1 Flash、GPT-6.1 Sol
分别在隔离 scratch 会话中验证只调用 `generate_image(size=3840x2160)` 而非 `vetd_create`；
图像端仍是模拟服务，未请求用户的收费图片接口。

隔离 Electron + fake chat/image provider 已验证设置页、两类 HTTP 请求、JSONL 引用、
聊天预览、编辑草稿和重载恢复。0.2.72 发版前，在独立工作树的 Electron 中用真实
DeepSeek V4.1 Flash 和 GPT-6.1 Sol 分别从自然语言请求自主调用 `generate_image`、
`edit_image`，Main 历史确认成功引用及改图的 `parentId`。图像端仍用隔离模拟服务，
未验证具体付费图像供应商的响应或计费。

独立设置版本另在隔离 Electron 中验过连接测试、模型选择导入、密钥不回显、加密落盘、
2K/high/额外 JSON 预览；再次用上述两厂商模型分别生图和改图，模拟端实收 JSON 与
multipart 均包含 `size=2048x1360`、`quality=high`、`output_format=png`、`background=auto`。
