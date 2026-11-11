# 图像生成与编辑

## 使用

1. 在「设置 → 模型中心」添加图像 API 所在服务，填写 API Key 和含版本段的 Base URL
   （例如 `https://api.openai.com/v1`）。聊天 OAuth 订阅不是图片 API 凭证。
2. 在「设置 → 内置工具 → 图像生成」分别选择文生图、图生图的服务并输入模型 ID，点击保存。
   模型不必先出现在聊天模型清单。未配置的操作不向模型提供工具，不自动改用其它服务。
3. 在本地 Code 聊天中提出生成图片的要求。成图会内联显示，点击放大，右键复制图片；
   「编辑图片」只向当前会话草稿插入图片 ID，补充修改要求后由用户发送。
4. 也可要求编辑工作区内的图片：`sourceImagePath` 接受工作区内相对/绝对路径。
   工作区外上传附件需要先由用户允许复制到项目，再把路径交给改图工具。

结果写到当前会话的权威工作目录（含 worktree）的 `.xiaoman/images/<UUID>.<ext>`，
不会覆盖旧图。历史预览从 JSONL 工具结果里的小引用重新构建，不依赖内存或大段 base64。
删除/移动文件后预览会提示不可用，不重新收费生成。

## 移植范围

参考 Open Vetta 的 `image-gen` 插件及 `openai-compatible-image-provider.ts` 请求协议。
复用小满的模型服务、密钥投影、内置工具、审批、会话历史和图片查看器；不移植其
订阅云网关、通用 media jobs/registry、独立生图历史 tab 或插件运行时。
当前只开放本地 Code 根会话；SSH、Bot、子代理不具备该工具。

## 分层和安全

- `shared/imageGeneration.ts`：有界参数归一/校验、脱敏设置引用和固定路径结果。
- `main/services/imageGenerationConfig.ts`：调用时从 Main 权威设置取服务和凭证；
  `agentHost` 只推两个可用性布尔值，密钥、端点和图片模型不下发 worker/Renderer。
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
- 图片模型选择仅存本机，不随配置同步导出。凭证继续使用既有 Main settingsSecrets。

## 回归

`shared/imageGeneration.test.ts`、`shared/types/imageGenerationProtocol.test.ts`、
`main/services/imageGeneration{Config,Bridge}.test.ts`、`main/services/imageGeneration/service.test.ts`、
`agent/tools/imageGeneration.test.ts`、`renderer/stores/sessions/imageGeneration.test.ts`。
公网下载边界另由 `remoteImageGuard.test.ts`、`remoteImageFetch.test.ts` 覆盖。

隔离 Electron + fake chat/image provider 已验证设置页、两类 HTTP 请求、JSONL 引用、
聊天预览、编辑草稿和重载恢复。0.2.72 发版前，在独立工作树的 Electron 中用真实
DeepSeek V4.1 Flash 和 GPT-6.1 Sol 分别从自然语言请求自主调用 `generate_image`、
`edit_image`，Main 历史确认成功引用及改图的 `parentId`。图像端仍用隔离模拟服务，
未验证具体付费图像供应商的响应或计费。
