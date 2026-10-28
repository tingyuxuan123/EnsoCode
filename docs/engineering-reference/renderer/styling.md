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
`border` / `input` / `ring`，各自都有 `-foreground` 配对。

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

## 主题系统

三种模式由 `theme` 字段驱动（`light` / `dark` / `system` / `sync-terminal`），
实现在 `stores/settings/index.ts` 的 `applyAppTheme` 与 `applySettings`：

- 前三种：切换 `<html>` 的 `dark` 类。
- `sync-terminal`：调 `applyTerminalThemeToApp()`，把 ghostty 终端主题的配色
  写进全局 CSS 变量，让整个界面跟随终端配色。

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
  不要用实色 `bg-muted`，与 Code 侧栏一致用 `bg-brand/10 dark:bg-brand/15` 淡染。
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
