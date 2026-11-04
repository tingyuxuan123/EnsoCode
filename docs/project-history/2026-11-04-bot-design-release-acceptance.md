# Bot 设计交稿与读图：0.2.49 发布验收

## 源码与范围

- 功能基线：`46362a1f538c3d85fb5de5b862febe97f8752743`。
- 用户要求 Windows x64 正式版，并明确授权 CI 通过后直接公开为 Latest，接受本次未做
  Windows 实机安装验收；不把该授权外推为今后的默认验收规则。
- 在独立、干净的 worktree 检查和发布，不包含并行开发中的协作看板或聊天区未提交改动。

## 真实模型与隔离 Electron

2026-11-04，在 macOS 上运行功能基线的隔离 Electron；独立 userData、临时项目和 CDP
9392，经进程环境核对后操作，不修改真实用户数据。使用本机已配置的 loopback 模型网关，
没有使用假 provider 或伪造工具结果。

| 场景 | 真实模型 | 可观察结果 |
| --- | --- | --- |
| Bot 私聊 | OpenAI `auto/gpt-6.1-sol` | 自主创建 `direct-probe.vetd`；显示 640px 封面，真实点击交稿卡片重开画布；截图后 read 返回 image/jpeg，最终回复准确描述白字 DIRECT-PROBE 与海军蓝底色。 |
| Bot 群聊 | Anthropic `omc/claude-opus-5-5` | 前台创建 `group-probe.vetd`；显示封面、点击重开均成功；截图后 read 返回 image/jpeg，最终回复准确描述白字 GROUP-PROBE、深蓝背景及画框尺寸。 |

Main 权威会话历史和工具请求中的 chatId、sessionId、cwd 分别匹配对应私聊/群聊，
没有把一方的画布冒充另一方的交稿。群聊在后台时创建请求被拒绝，未写设计目录或抢切画布；
切到该群聊后创建成功。

OpenAI 首次两次直接截图调用同时传入 frame/frames/all:false，被互斥参数校验拒绝；
模型随后自主通过 codemode 调用单帧截图成功，再 read 图片。不能将最初两次拒绝记为成功。
Anthropic 直接截图调用成功。截图工具返回路径与卡片，真正的图片内容由随后的 read 返回。

## 已知边界

- 旧失败回复曾提及同名设计路径；文件后来创建后，重新查询旧条目也能识别该路径。
  当前条目按正文解析磁盘现状，不是交稿时刻的不可变快照；本次未改变该既有语义。
- 上述证据验证 Bot 创建、交稿、截图、读图和话题隔离，不代表 Windows 原生渲染、安装、
  旧设置/会话/项目保留或自动升级已通过实机验收。
- 发布前发现 Windows 原生根路径被设计 SDK 的 POSIX-only 校验拒绝。修复后，Main 仅在
  IPC 回包转换为 `C:/…`，仍用原生 realpath 和相对路径做文件授权。Windows CI 打包前
  以真实临时目录验证 Bot 交稿解析、SDK 根映射与 Main 路径回读；不代表安装后 GUI 验收。

脱敏历史、模型记录和截图核查来源：`/tmp/ensocode-46362-evidence.5xjYGZ/`；临时实例、
userData 和功能验收 worktree 已清理，证据不包含 API key。临时目录并非长期产物存储。
