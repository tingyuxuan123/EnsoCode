# 原生插件示例

仅用于你已审阅并完全信任的本地代码。`main.mjs` 是完整 Node；`ui.js` 与主界面同权。
宿主 API 权限不是操作系统沙箱。以下示例均不申请网络、宿主 MCP 或凭证访问，不自动安装依赖。

桌面主侧栏 → 扩展 → 添加扩展 → 从文件夹安装插件，选择以下单个目录，检查预览后确认。
没有主侧栏扩展入口的安装版本，使用设置 → 插件 → Enso plugins → Install from folder。
首次安装在你确认预览后默认启用，之后可随时停用；升级和重装保持原来的启用或停用状态。Claude Code 插件仍是独立区域。

| 目录 | 演示 |
| --- | --- |
| [`starter`](starter) | 最小 Node/界面入口；输入框右侧「插入问候」调用本插件方法并按草稿版本写入。含独立作者类型 |
| `word-stats` | 只统计工具收到的文本；本插件工具卡、`enso.example.wordstats:bars` 代码块；只读预设及附带 skill/指令/角色 |
| `snippets` | `#review` / `#tests` 补全、输入框右按钮、回复右侧操作；读草稿后带 generation/rev 写入 |
| `notes` | 侧栏 `+` → Local Notes；opaque-origin sandbox 页面经固定 MessagePort 调本插件，私有目录保存便签 |

### 待接入验证（不可安装）

[`kdocs-tasks/README.md`](kdocs-tasks/README.md) 是“金山文档需求助手”的申请与测试副本准备指南，目前仅有文档，没有插件清单或运行时代码。需要先确认企业服务商准入、官方授权和目标文件读写能力；不属于上述无需网络/凭证的可运行示例。

配置与完整 API 见 [开发文档](../../docs/plugins.md)。不要把真实 MCP、token 或开发机配置放进示例。
在仓库运行 `pnpm plugin:init ../my-plugin --id org.example.hello` 可生成一份独立模板，再运行 `pnpm plugin:validate ../my-plugin` 静态检查。校验不执行插件，也不代替桌面的预览确认；首次安装在你确认预览后启用。
若自行扩展示例调用宿主 MCP，需同时申请 `"mcp.call"` 并声明精确配对，例如 `"mcp": {"tools": ["demo/lookup"]}`；只有 server `demo` 的 `lookup` 获授权，其他 server 上的同名工具不在授权内。现有离线示例不申请该权限。
`word-stats` 的图表 skill 被预设引用，因此只在新会话选择 Local Writer 时加载；已经开始的会话不能更换预设。
停用/卸载会清理宿主挂点、补全和页面桥；插件必须在 `onLoad` 返回的清理函数里撤销自己创建的计时器与页面监听。
