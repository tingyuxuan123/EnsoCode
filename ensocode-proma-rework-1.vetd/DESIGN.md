# EnsoCode UI 重构设计契约

## 范围与边界
- 最终范围是当前 EnsoCode 的全部功能 UI，不限于几个主页面；先交付独立可交互设计，不修改应用代码、IPC、store、worker 或真实用户配置。
- 首批场景只有对话工作台、新建任务、改动审查、外观设置、当前进度和后台 Agent，均不是全功能完成声明。
- 全量范围以 `components/coverage.ts` 为可搜索目录，逐项核对源码入口、核心动作、弹窗和状态；`frames/coverage.tsx` 显示实际覆盖情况。
- 示例会话、代码、文件改动、运行结果和费用均为设计演示，不代表真实仓库执行或检查结果。
- 相邻问题不处理：真实 Agent 调用、终端执行、模型接入、配置持久化、后端实现、发布。

## 当前参考（源码优先）
参考根目录：`/Users/yfdl/Downloads/Proma-main`，不是 README 中的旧截图。
- `apps/electron/src/renderer/styles/globals.css`：Inter Variable 字体栈，ocean-light 主题（189–229 行），modern 圆角 cap（1006–1013 行）。
- `apps/electron/src/renderer/components/app-shell/AppShell.tsx`：平铺分栏、细分隔线、左右宽度范围。
- `apps/electron/src/renderer/components/app-shell/LeftSidebar.tsx`：项目分组、会话树、新建与搜索、归档入口。
- `apps/electron/src/renderer/components/app-shell/ModeSwitcher.tsx`：紧凑分段模式切换。
- `apps/electron/src/renderer/components/app-shell/RightSidePanel.tsx`：文件与改动双视图。
- `apps/electron/src/renderer/components/chat/ChatInput.tsx`：独立浅色输入区、底部工具条。
- `apps/electron/src/renderer/components/settings/SettingsPanel.tsx`：左侧设置导航与右侧内容。
- 用户提供的最新截图：核对图标轨、项目树、会话标题与项目标记、右侧搜索和文件来源 tabs；不从截图代替读取源码。

## 固定视觉规则
- 用户参考优先于抽取的设计方向。保留 Proma 蓝灰色系与 Inter，不改成黑白账本风、绿色旧版或大型欢迎页。
- 背景 hsl(205 35% 94%)，内容 hsl(205 30% 97%)，文本 hsl(210 30% 15%)，强调 hsl(205 50% 50%)。
- 几何：6px 圆角为主，工作区无卡片式外框、无渐变、无静态阴影；分栏使用 1px 细线。
- 1440×900 桌面：图标轨 56px + 项目导航 264px + 主区 808px + 文件面板 312px = 1440px。较参考的左右最小 300px 做小幅压缩，以在 1440 宽度保留可读对话。
- 字体 12/13/14/15/18/24px，正文 15px，元信息不低于 11px。等宽仅用于代码与路径。
- 正式产品名称 EnsoCode，顶部可见；底部显示“设计预览”。

## 数据与交互
- 共享导航、文件数据、改动统计与审查示例定义单一来源。
- 共用外壳定义在布局路由；跨页使用 react-router Link。
- 可操作：项目折叠、会话跳转、导航搜索、新建任务填写与创建、文件/改动/终端切换、查看示例文件、模型选择、输入消息本地回显、协作页签、审批档位、检查点说明、审查标记、设置主题/密度/开关。
- 输入与配置变更仅存于设计预览，不触发网络或文件写入。

## 保留 EnsoCode 差异
多项目与会话、协作 Agent 页签、Git 分支/Worktree、子任务状态、审批模式、检查点、终端、文件树、改动列表、技能/MCP、远程节点入口。

## 全量覆盖与验收
- 项目/会话、对话输入、审批/计划/目标、后台任务、文件/Git/终端/浏览器/旁路/工作流、21 个设置类别及子功能、Bot/群组/团队/记忆/例程、远程节点、手机伴侣、首次引导/OAuth/更新/退出均纳入。
- 隐藏/实验功能同样设计，但保持原来的启用条件；不复制 Proma 中 EnsoCode 没有的功能。
- 一个功能只有在主要路径、编辑/确认、空/加载/失败/权限状态、跨页面交互和最新截图验收完成后才算完整。
- “只存在入口”“弹出说明”“只展示正常态”均只能记为部分覆盖。
- 桌面与手机采用同一设计语言但分开布局；手机稿另建移动设计文档，不把手机塞进桌面共享外壳。
- 首批外观页并不覆盖真实外观设置的全部选项；首批模型选择并不覆盖厂商/账号/推理级联；终端仅为只读示例。这些都待完整重设计。
