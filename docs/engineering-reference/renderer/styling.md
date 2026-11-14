# 样式规范

## Tailwind 4 + 语义令牌

`src/renderer/styles/globals.css` 用 `@theme` 把 CSS 变量映射成 Tailwind 工具类，
颜色值用 `oklch`。

**只用语义令牌，不写具体色值**：

```tsx
// 正确
className="bg-background text-muted-foreground border-border"
className="text-destructive"
// 错误：暗色模式和终端主题同步都会失效
className="bg-white text-gray-500 border-gray-200"
className="text-red-500"
```

可用语义色：`background` / `foreground` / `card` / `popover` / `primary` /
`secondary` / `muted` / `accent` / `destructive` / `success` / `warning` / `info` /
`border` / `input` / `ring`。品牌色是 `brand` / `brand-foreground`；常驻选择使用
`selection` / `selection-foreground` / `selection-border`。

### 颜色职责：主操作、悬停与选择不是同一件事

- `primary` 保留主题定义（上游深色是前景白），不是用户强调色的别名；普通主按钮、徽标、
  统计图和状态语义不要为了“统一主题色”全局换色。
- `brand` 是用户选择的强调色。短图标、页签下划线、开关/复选/单选的已开启状态、滑块填充用它，
  实色底必须配 `brand-foreground`。
- `accent` 只做中性 hover/瞬时键盘高亮。上游深色只有 6% alpha，不能拿来表示常驻当前页。
- 持久当前行、分段、筛选项统一 `bg-selection text-selection-foreground`，已有边框的选项可配
  `border-selection-border`。`shared.css` 由原始 `brand` 派生浅色 12% / 深色 18% 淡染，文字取原始
  `foreground`，边框取品牌色 45%；不经过壁纸 alpha 重映射。active 时不要让通用 `hover:bg-accent`
  覆盖它（把 hover 放到 inactive 分支，或 active 显式 `hover:bg-selection`）。
- 不按 `[aria-pressed=true]` 全局刷色：侧栏展开、工具开启、当前工作区是不同的状态；在所属组件
  显式选择样式。云白/薄荷的中性表面和状态色由主题文件管理，不能强行覆盖用户选择的强调色。

桌面/手机共用 `shared.css` 的 `@custom-variant dark (&:where(.dark, .dark *))`，让所有
`dark:` 工具类与 settings store 的 `html.dark` 一致，不能另跟随系统媒体查询。

例外：确实需要固定色相的状态提示（如测试成功的绿色）写
`text-emerald-600 dark:text-emerald-500`，两种模式都要给。

## cn() 合并类名

一律用 `src/renderer/lib/utils.ts` 的 `cn()`（clsx + tailwind-merge），
它能正确处理冲突类的覆盖：

```tsx
className={cn('text-sm font-medium', !enabled && 'text-muted-foreground line-through', className)}
```

不要手写模板字符串拼接 —— `` `text-sm ${cond ? 'text-lg' : ''}` `` 会两个类都留下。

## 字号是 14px，注意 rem

`:root` 的 `--font-size-base` 是 14px，**Tailwind 的 rem 类会按 14 换算**：
`h-11` = 2.75rem = 38.5px，不是 44px。

与主进程写死的像素值对齐时（如 `trafficLightPosition`），用固定像素类：

```tsx
<div className="h-[44px] pl-[84px]">   // 而不是 h-11 pl-20
```

设计稿的文字尺寸按默认 14px 根字号换算：13px 正文用
`text-[calc(13rem/14)]`，24px 行高用 `leading-[calc(24rem/14)]`。
不要用固定像素字号取消外观设置的字号缩放。随文字放大的控件，其高度、图标列、
开关轨道/拇指/位移也要同比例缩放，避免大字号裁切和重叠；窗口标题栏等原生几何除外。
回归见 `src/renderer/styles/typographyScale.test.ts`。

聊天排版由 `shared/chatTypography.ts` 集中定义正文、标题、表格、代码块与行内代码的字号/字重。
`--chat-*` 变量按原宿主基线等比应用，不能修改根字号；用户正文单独包文本，避免芯片、元信息或
嵌套 Markdown 二次放大。文件预览显式重置默认变量，聊天设置不影响它。偏好本机容错、导入严格校验，
回归：`chatTypography.test.ts`、`CodeBlock.test.tsx`、`TimelineRow.actions.test.tsx`。

## 设置页的数据布局

设置窗口包含固定侧栏，多列统计和排行按内容区的 `@container` 宽度切换，不能只按整个窗口的 `sm`/`md` 断点。长模型名、项目名不能参与表格的最小内容宽度计算：表格使用固定列布局、名称省略并保留完整提示；字号放大后确需更宽时，仅在表格内部滚动，不撑宽页面或覆盖相邻排行。至少验收 720px 窗口、默认 960px 窗口、长名称和大字号。回归见 `usage/RankingTable.test.tsx` 与 `usage/UsageCharts.test.tsx`（相对 `src/renderer/components/settings/`）。

## 主题系统

四种模式由 `theme` 字段驱动（`light` / `dark` / `system` / `sync-terminal`），
新安装默认 `light`（浅色云白），保留已保存的主题模式；实现在
`stores/settings/index.ts` 的 `applyAppTheme` 与 `applySettings`：

- 前三种：切换 `<html>` 的 `dark` 类。
- 桌面深色使用 fork 上游 `J3n5en/EnsoCode` 的默认 **Enso dark** 色值与派生公式
  （对齐 `4bc6eb9c` 的 `src/shared/theme/builtinThemes.ts` / `derive.ts`），集中在
  `styles/globals.css` 的 `.dark`：外壳/导航对应上游 canvas，内容对应 surface，默认紫色强调，
  显式强调色预设仍优先。不迁移上游布局或主题系统、不改上游基础色值；共享控件及业务选择项
  按上述颜色职责适配，不能只在 `project-sidebar` 作用域局部补色。
  色值回归见 `upstreamDark.test.ts`，主题驱动/选择契约见 `selection.test.ts`。
- `sync-terminal`：调 `applyTerminalThemeToApp()`，把 ghostty 终端主题的配色
  写进全局 CSS 变量，让整个界面跟随终端配色。
- 桌面浅色方案独立保存在 `lightPalette`，默认为 `cloud-light`（`shared/lightPalette.ts` 的 `DEFAULT_LIGHT_PALETTE`）；旧配置缺字段或非法值也回退云白，已有合法选择不变。三个浅色方案均支持已保存的强调色：不禁用设置按钮；`shared.css` 的 `html:not(.dark)[data-accent=...]` 比浅色方案默认 `brand` 更具体，包含 ocean，深色默认仍沿用上游。方案只在显式浅色或系统浅色时生效，不影响深色/终端同步。回归：`lightAccent.test.ts`、`AppearanceSettings.accent.test.tsx`。
  - 薄荷白全部样式在 `styles/mintLight.css`，只换肤不改尺寸：灰阶与绿色同色相，`--accent` 保持中性；发送/选择/聚焦跟随用户强调色，运行/完成仍用绿色状态语义；圆角 8 / 12 / 16（行与控件 / 浮层与气泡 / 输入框与对话框）。组件覆盖优先挂 `data-slot`、`data-model-picker`、`aria-pressed` 等稳定属性。
  - 该文件的组件规则不在 `@layer` 内，会压过 Tailwind 工具类（包括 `hover:`、`disabled:`），写覆盖时要显式处理这些状态。改浮层圆角要连 `::before` 一起改：命令面板的 `::before` 带底色，只改外框会在角上露出旧圆角。代码视图选中色用宿主 `diffs-container` 上的 `--diffs-selection-base`（文档侧声明压过 shadow `:host`），不要改 `--diffs-modified-*`，那会连带 diff 的修改色。
  - `cloud-light`（云白）配色参考 Open Vetta 的 **mono 浅色**（不是 Classic 靛蓝）：纸白工作区 `#faf9f9`、近白导航/卡片 `#f8f8f8`、纯白输入框/浮层、中性普通主操作、浅灰用户消息；发送/当前选中/聚焦跟随用户强调色，不给外壳或用户气泡染色。实现集中在 `styles/cloudLight.css`，保留现有布局与 10 / 14 / 18 圆角；回归见 `cloudLight.test.ts`。
  - 云白的 `--muted`（`#fafafa`）与 `--background`（`#faf9f9`）几乎同色，可见中性面是 `--secondary` / `--accent`。需要「中性浅色选中块或分段轨道」时用 `bg-secondary`（常驻选中仍优先 `bg-selection`），不要照搬上游的 `bg-muted`——胶囊和轨道会在云白下整体消失。标题栏 Code/Bot 分段与聊天页签按上游结构（淡轨道 + 独立内容色胶囊、圆角浅色胶囊页签），令牌走 fork 语义；回归见 `ModeSwitch.test.tsx`、`CoworkerTabs.test.tsx`。背景图模式下 `bg-background` 胶囊会被面板 alpha 重映射，探针要比 `var(--color-background)` 而不是 `var(--background)`。

设置 → 外观 的「主题」卡片网格是内置方案与插件主题的统一入口：三张内置浅色卡 + 已启用插件的
主题卡（按当前浅/深外观取插件自带 `light`/`dark` 调色板预览）。选内置卡写入 `lightPalette`
并清空 `pluginTheme`；选插件主题只写 `pluginTheme`，不改既有浅色方案；已选主题被停用或卸载时
保留一张不可选占位卡（覆盖规则见 `docs/plugins.md`）。内置卡预览色与浅色方案 CSS 同源，改配色
要同时改 `components/settings/appearanceThemes.ts` 的 `BUILTIN_THEME_PREVIEW`，漂移回归见
`appearanceThemes.test.ts` 与 `AppearanceThemeCards.test.tsx`。

插件调色板的 `sunken` 同时映射中性控件底色 `secondary` / hover 色 `accent`（不是品牌强调色），
对应文字取 `text`；导航 `--color-nav` 引用 `--color-shell`，覆盖内置浅色方案的固定导航色并保留
背景图 alpha。插件 `tokens.light/dark` 可显式覆盖这些默认映射；全部随插件样式标签一起撤销，
不改已保存的内置方案。不要让插件作者为宿主分段、页签或设置导航逐个写 CSS 补色。
回归见 `stores/pluginThemes.test.ts`。

跟随应用外观的入口（主窗口、设置、协作看板、独立设计窗口）都在自己的组件树里挂
`plugins/PluginThemeHost`：窗口之间不共享 `html` 主题类，漏挂的窗口会一直停在云白。宿主只加载
light/dark 调色板与插件 CSS，样式标签清空即恢复内置配色；插件素材槽与背景图规则只认主窗口的
`data-enso` 挂点，所以设置、看板、设计窗口不会跟着铺壁纸或装饰。会话活动属性
（`data-enso-session` / `data-enso-activity`，素材槽的 running/waiting/error 状态）依赖 sessions
store，只在主窗口由 `plugins/SessionActivityAttributes` 订阅，不能跟着主题宿主扩散到第二个入口。
回归见 `plugins/pluginThemeWindows.test.ts`，`designWindowBoundary.test.ts` 同时守住宿主不得把
sessions 依赖带进设计窗口。插件主题数据经 `extensionPlugins.list` / `asset` 读取，这两条只读
通道额外放行 Main 权威登记的看板/设计窗口，写与管理通道仍限主窗口与设置窗口（见
`main/windows.md`）。

**配色方案选择器只在 `sync-terminal` 模式下影响界面外观**。
在 `system`/`light`/`dark` 下改配色方案看不到界面变化，这是设计如此，不是 bug。

`html.dark` 只切换语义色变量，不会自动把 Chromium 原生控件（`<select>` 弹出层、滚动条）切到深色。
`:root` 必须设 `color-scheme: light`，`.dark` 必须设 `color-scheme: dark`，否则 Windows 上原生下拉仍是白底。
新下拉用 `components/ui/select`，不要再写裸 `<select>`。

终端主题数据在 `src/renderer/data/terminal-themes.json`（438 个），
由 `pnpm generate:themes` 生成，**不要手改**。

## 背景图透明化：新界面默认自动跟随，别绕过它

用户可开「背景图」（设置 → 外观）。实现不是透明窗口，而是
`hooks/useBackgroundImage.ts` 给 `<html>` 挂 `bg-image-enabled` 类并写入几个 alpha 变量，
`globals.css` 里用相对颜色把 **`--color-*` 令牌**（Tailwind 引用层）重映射成半透明：

上游深色的 `--accent`、`--border`、`--input` 自带 alpha，背景图透明化必须与原始
`alpha` 相乘，不能直接替换，否则淡 hover 与边框会变成大片亮灰/白线；不透明主题色行为不变。

| 变量 | 作用范围 | 来源 |
|------|---------|------|
| `--bg-panel-alpha` | 普通面板（`bg-background` / `bg-card` / `bg-muted` / `bg-sidebar`…） | 1 − 背景可见度 |
| `--bg-popover-alpha` | 弹出层（`bg-popover`），保底 0.92 | 派生 |
| `--bg-border-alpha` | 边框 | 面板 + 0.25 |
| `--bg-code-alpha` | 代码块 / diff / 终端 | 「代码块不透明度」滑块 |
| `--bg-composer-alpha` | 输入框 `[data-slot="composer"]` | 「输入框不透明度」滑块 |

**新页面只要用语义令牌类（`bg-background` 等）就自动跟随，什么都不用做。**
真正会绕过机制的是内联色值、固定色值或第三方组件自带的主题底色：

```tsx
// 错误：固定/内联色值不经过 --color-* 令牌重映射
className="bg-zinc-950"
style={{ backgroundColor: theme.background }}
```

深色填充按钮、停止图标或反色标签的文字使用 `text-inverse-foreground`，不要使用
`text-background`：后者也会经过背景 alpha 重映射，可见度 100% 时文字会完全透明。
inverse 令牌取原始 `--background`，仍跟随 light/dark/sync-terminal，但不随面板透明。
回归见 `src/renderer/styles/inverseForeground.test.ts`。

处理办法按情况选：

- **只是想要「稍暗一层」的层次感** → 优先换语义令牌（`bg-muted` / `bg-card`）。
  Tailwind 4 的 `/N`（如 `bg-muted/50`）用 `color-mix` 乘在重映射后的令牌上，仍会跟随透明度；
  但承载内容的大面板应慎用，避免父子多层半透明叠色后比周围更实。hover/选中等瞬态可正常使用。
- **承载内容的卡片叠在已半透明的面板上**（`bg-card` / `bg-muted` 卡片放在 `bg-background` 面板里）→
  两层 `--bg-panel-alpha` 叠成近乎不透明。给卡片挂 `data-slot`，加进 `globals.css` 的置透明列表
  （`tool-details`、`welcome-suggestion`、Bot 页 `bot-card` / `bot-notice`），背景图模式下只留边框；
  带 `hover:bg-*` 的可点卡片行用 `bot-card-button`（只在非 hover 态置透明）。常驻的选中高亮
  不要用实色 `bg-muted` 或弱 hover 色，统一用 `bg-selection`。
- **第三方组件自己刷底色**（终端、代码高亮、diff）→ 给宿主元素挂 `data-slot`，在
  `globals.css` 的 `html.bg-image-enabled` 区块加一条覆写：内部置透，宿主只刷**一层**。
  若要求与主体完全一致，底色和 alpha 都取 `var(--background)` + `var(--bg-panel-alpha)`；
  若产品明确要求保留独立色相（如聊天流代码块、侧栏终端），再用源色 + 对应独立 alpha。
  终端属于后者：xterm 的文字与 16 色都来自终端主题，底色必须也取自 `--terminal-bg`，
  否则「浅色界面 + 深色终端主题」会白字白底。半透明覆写还要叠 `.bg-image-media` 条件
  （`BackgroundLayer` 真的铺出壁纸时才加），否则开关开着但没选图时终端只剩一层灰。
  多层元素各刷一遍半透明会叠成不透明（diffs 踩过）。
- **新的独立区域确实需要自己的档位**（如输入框、代码块）→ 走 settings store 加字段完整流程
  （`state.md`），新增一个滑块 + 一个 `--bg-*-alpha` 变量，并在上表登记。不要私自派生
  「面板 alpha + 常数」的公式——低可见度下会封顶到 1，用户感知为功能失效。

改完在背景图开启状态下截图对比一次；`--bg-code-alpha` 默认 0.65，`useBackgroundImage`
只在主窗口 `App.tsx` 调用，设置窗口不挂背景。

主题或持久选中态变更后，在确认 PID/`ENSO_USER_DATA_DIR` 属于隔离 dev 的前提下运行：

```bash
ENSO_CDP_PORT=9333 node scripts/verify-theme-selection.mjs
```

该脚本拒绝默认 9222，通过真实 Chromium 与共享 React 控件校验系统/应用明暗交叉组合、
深浅终端同步与开关开启/关闭状态、
Code/画图/设计/Bot 真实点击切换、Bot 关闭后的 Code、青绿/紫色及背景图 85%/100% 可见度；
检查颜色而非只看 aria/class，结束卸载临时控件并还原隔离设置。完整矩阵见脚本。

## 尺寸惯例

设置页密集列表的常用值，保持一致：

| 场景 | 类 |
|------|-----|
| 列表行 | `px-3 py-2 rounded-md hover:bg-accent/50` |
| 紧凑子行（弹窗内） | `px-2 py-1.5 rounded-md` |
| 行内图标按钮 | `h-7 w-7`，图标 `h-3.5 w-3.5` |
| 徽章 | `text-[11px]` |
| 次要说明文字 | `text-muted-foreground text-xs` |
| 分组标题 | `font-medium text-sm` |

## 布局防溢出

弹性布局里，可伸缩的一侧要 `min-w-0`（否则 `truncate` 不生效），
固定的一侧要 `shrink-0`：

```tsx
<div className="flex items-center gap-2">
  <span className="shrink-0 font-medium">{name}</span>
  <span className="min-w-0 truncate text-xs">{longPath}</span>
</div>
```

窗口可拖拽区域用 `drag` / `no-drag`（见 `TitleBar.tsx` 与 dialog 的 `no-drag`），
交互元素必须在 `no-drag` 内，否则点不动。

## 尺寸收到 0 不用欠阻尼 spring

framer-motion 的 `height` / `width` 不做 clamp。欠阻尼 spring（如 `springStandard`）收到 0 时会冲到负值，
浏览器会丢弃非法的 `-Npx`，元素停在最后一个正值，等 spring 回稳后才卸载，看起来就是“最后卡住再突然收起”。
展开/收起统一用 `lib/motion.ts` 的 `heightVariants`（已内置无过冲 tween），调用处不要再传 spring `transition`。
宽度收起同理（如右侧面板 `sidePanelWidthTransition`：目标为 0 时用 `easeOutLayout`）。
