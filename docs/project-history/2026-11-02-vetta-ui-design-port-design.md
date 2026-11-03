# 移植 Open Vetta 设计功能（vetta-ui-design）设计稿

> 状态：已确认（2026-11-02），P1/P2 完成，P3 待实施。来源：`open-vetta-main/packages/plugins/presets/vetta-ui-design`（插件 0.7.6，Apache-2.0；内含 taste-skill，MIT）。
> 上游参考：ADR-0053/0054/0055/0066/0068/0069、`docs/desktop/design-gallery.md`。

## 1. 行为差距

| | 现在 | 目标 |
|---|---|---|
| 设计产出 | agent 只能写普通前端代码，用侧栏浏览器看单页 | agent 用 `vetd_*` 工具产出 `x.vetd/` 设计包（TSX 路由 = 画框），按设计方法论（方向发牌、质量检查、批注闭环）工作 |
| 查看 | 侧栏 BrowserView 一次只显示一个页面 | 无限画布同时摆多个画框，热更新；点选元素回传给 agent；批注、撤销重做、交互模式 |
| 管理 | 无 | 设计画廊（跨项目扫描根目录 `*.vetd/`）、`.vetdz` 分享包导入导出、设备样机 PNG/PDF、包内 git 历史 |

EnsoCode 原生插件（`docs/plugins.md`）缺少工作区视图挂点、长驻进程、离屏截图，工具单次 60 秒，侧栏只能放沙箱 iframe。因此**做成内置功能，不走原生插件**，也不为此扩展原生插件 API。

## 2. 总体结构

```text
Renderer  src/renderer/features/design/
  vetta/            ← 上游 src/ 原样移植（canvas/vetd/gallery/mockup/history/…，约 3.1 万行）
  host/             ← Vetta PluginContext 子集的适配层（@vetta-org/plugin-sdk 经 vite alias 指向这里）
  runtime.ts        ← 主窗口常驻的设计运行时：执行 vetd_* 工具 handler、hook、tool-gate
  mounts/           ← 把上游组件挂进 EnsoCode：画布面板、画廊视图、截图卡、文件树、预览
Preload   window.electronAPI.design.*（按领域 typed 出口）
Main      src/main/services/design/
  engine.ts         ← vite dev server 进程管理（端口、生命周期、日志尾巴）
  capture.ts        ← 离屏截图（隐藏窗口 + CDP Page.captureScreenshot）
  fs.ts             ← 设计文件读写，按项目/会话权威根校验边界
  storage.ts        ← userData/design-data 键值存储
  gallery.ts        ← 跨项目扫描根目录 *.vetd/
  runner.ts         ← history-runner / check-syntax 一次性 node 调用
  ipc/design.ts     ← handler，入参全部 unknown 收窄
Worker    src/agent/tools/design.ts ← vetd_* 工具代理（schema 本地声明，执行转发 Main → Renderer）
Resources resources/design/{engine, history-runner, skills/vetta-ui-design, vendor/taste-skill}
```

原则：**上游源码尽量不改**，差异集中在 `host/` 适配层和少数必须替换处（`cards/file-url.ts` 的 `vetta-file://`、`@vetta/ios` alias），便于以后同步上游。

## 3. 关键决定

### D1 工具执行位置：Renderer 设计运行时

上游工具（`src/tools.ts` 等）与画布强耦合：打开画布页签、共享画布 localStorage 快照做离屏截图、引擎轮询用 `window.setInterval`。搬到 Node 等于重写。

采用：worker 注册 `vetd_*` 代理工具 → `design-invoke`（仿 `browser-invoke`：校验 session generation、开关、重复 requestId、取消、超时）→ Main 路由到**持有该会话的窗口**（无则主窗口）的设计运行时执行 → 结果经 Main 回 worker。

- 设计运行时随主窗口挂载，不依赖画布是否可见。
- 窗口不存在、正在重载或运行时未就绪：返回结构化错误，不挂起。
- 超时按工具区分：`vetd_install`、批量 `vetd_screenshot`、`vetd_export` 放宽到 10 分钟，其余 2 分钟；取消信号透传到运行时。
- 备选（不采用）：工具搬进 Main/worker。更符合“worker 为权威”，但需要重写约 40% 上游代码，且画布状态要再造一份同步。

### D2 适配层而非改写

`host/` 实现上游实际用到的 API 子集（调研清单见附录 A），每个方法落到 `window.electronAPI.design.*`。SDK hooks（`useTranslation`、`useActivityTab`、`usePluginShortcutScope`）同样由适配层提供。

路径边界：上游 fs API 传绝对路径；适配层把路径拆成 `{rootId, relPath}`，`rootId` 来自 Main 下发的项目/会话权威根。Main 再按根推导绝对路径、拒绝 `..`、符号链接逃逸；写操作仅允许落在 `*.vetd/` 包内、`.vetdz` 导出位置和设计约定文件。`saveAs` 由 Main 弹原生对话框，用户所选路径只在 Main 内使用。

### D3 Node 运行时：用 Electron 自身

vite dev server、history-runner、check-syntax 都用 `process.execPath` + `ELECTRON_RUN_AS_NODE=1` 运行（打包产物已验证可用，见 `scripts/smoke-packaged-natives.cjs`），不依赖用户安装 Node。

- 引擎模板及其 `node_modules`（vite、Tailwind v4、React 19、react-router、Iconify 图标集，含 esbuild/rollup/oxide 平台二进制）由 CI 按平台 `npm ci` 预装，经 `extraResources` 随包，不进 asar。首次使用拷到 `userData/design/engine/<版本>/`（上游同款“内置 vendor 主路径”）。
- `vetd_install`（设计级 npm 依赖）需要 npm：v1 使用 `shellPath` 找到的系统 npm；找不到时返回结构化错误，提示安装 Node.js。

### D4 引擎进程管理（Main `design/engine.ts`）

参照上游 `command-spawner.ts`：每份打开的设计一个 vite；只监听 `127.0.0.1`，端口由 Main 先 `listen(0)` 探测再 `--strictPort` 传入；全局上限 8 个；保留 stdout/stderr 尾巴 64KB 用于诊断；停止时 TERM，3 秒后 KILL；切离设计、关窗口、退出应用时清理。Renderer 只拿到 `{engineId, port}`。P2 追加 `--import` 父进程看门狗（500ms 检测，父 PID 消失或 reparent 后杀引擎进程组）；启动时校验 `userData/design/engine-pids` 中的版本、物化根、nonce、精确 Vite 命令行和进程组，再清理旧 PID，不能只按 PID 杀进程。

### D5 画框承载：Renderer iframe

`browserHost` 同时只显示一个 guest，不能承载多画框。画布改用 iframe 指向 `http://127.0.0.1:<port>`：

- `index.html` CSP 增加 `frame-src 'self' http://127.0.0.1:*`，只新增回环（`'self'` 保留插件 shell 的原有权限），其它入口不变。
- iframe 与渲染层跨源，设计代码碰不到父页面 DOM 和 preload；桥消息只认 `vetd:true` 且 `event.origin` 等于该引擎端口。
- Main 对这些子 frame 的导航与重定向绑定首个已登记引擎源，不能跳到另一个端口；主 frame 与插件视图原策略不变。可信父页重置和继承发起者 origin 的 `about:blank` 允许；`data:` 在 Chromium 可能不触发导航守卫，由 CSP 阻止，失败页 URL 不代表目标代码已执行。`window.open` 沿用现有 deny + HTTP(S) 外链策略。
- iframe 是普通 DOM，弹窗、下拉可以正常盖在上面，不需要 overlayGuard 沉层。

### D6 离屏截图（Main `design/capture.ts`）

上游用 `capturePage`；EnsoCode 已知隐藏视图 `capturePage` 会报合成错误，改用隐藏窗口加 CDP `Page.captureScreenshot`，参考 `pairPreviewBrowser.ts`。最多复用 4 个窗口，视口不超过 4096，同一 key 串行执行。URL 必须属于已登记的引擎端口，否则拒绝。准备脚本和就绪表达式只在这些引擎页执行。

### D7 界面挂载

| 上游挂点 | EnsoCode 落点 |
|---|---|
| activity-tab → 画布 | 侧栏 Dockview 新面板 `design`，打开时进入 sidePanel `fullscreen` 铺满（对应上游 `width:"max"`） |
| workspace-view → 画廊 | App 主区新增一种视图，替换 ChatView 区域；AppRail 增加“设计”入口（待确认，见 §6） |
| global → 样机导出弹窗 | App 根部挂载，沿用项目 Dialog 分层 |
| file-preview → `.vetdz` 预览 | 文件预览按扩展名分发 |
| message card → 截图卡 | `vetd_screenshot` 工具卡渲染 |
| new-session-context → 风格库 | 新建会话页（WelcomeSuggestions 区域）；设计师以子 agent 类型接入，不新增聊天预设 |
| file-explorer | `fileIcons.ts` 给 `.vetd/` 目录加图标，`fileTreeMenu.tsx` 加“在设计画布中打开” |
| shortcuts | 画布内局部快捷键（C 批注、Mod-Z/Shift-Z/Y） |
| input-action | 上游实际未注册，不做 |

样式：上游 CSS 是 Tailwind v4 theme + utilities（无 preflight），用 `@scope([data-vetta-plugin-root=vetta-ui-design])` 包住。保留该 scope，portal 根补同名标记；在 scope 内把上游依赖的宿主变量（background/foreground/card/popover/border/muted/accent/primary/secondary …）映射到 EnsoCode `globals.css` 变量。

### D8 Agent 集成

- **技能**：`resources/design/skills/vetta-ui-design` 加进 `additionalSkillPaths`，由设置开关控制，默认开启。
- **设计师角色**：内置 `designer` 子 agent 类型，正文取上游 `agent/agents/designer.md`，仅改为向 parent 汇报；不做聊天 preset。只有 designer child 获得设计工具，继承自身审批和 parent Plan 门；关闭设计时同步隐藏角色。
- **tool-gate**：开关关闭则隐藏全部；否则画布 cwd 集合命中直接开放全部（上游 `getCanvasController` 快捷路径），未命中则按 worker 的 cwd 文件发现/create 缓存决定。Renderer 仅上报 `{sessionId, open}`，Main 用 `pluginProjectRoot` 推导并汇总 cwd，worker ready/重启重推；技能激活本身不是 gate 输入。
- **hooks**：UserPromptSubmit / Stop / SessionEnd（历史自动提交）从 worker 事件经 Main 转给设计运行时。
- **计划模式**：新工具不会自动被拒。`vetd_create/install/notes/direction/restore/export/assets/screenshot`（都会写文件）加入 `planMode.ts` DENIED_TOOLS；`vetd_status/sizes/history` 允许。写测试覆盖。
- **审批**：沿用内置工具审批链路。

### D9 网络

assets（图片搜索/下载）、design-systems 目录同步走 Main fetch，使用固定主机白名单（实现时从上游源码收集），响应大小设上限；Renderer 不获得通用 fetch。

## 4. 分期与验收

每期单独提交、单独可验收。

**P1 引擎与 agent 工具链**
资源打包与 CI 预装引擎；Main engine/capture/fs/storage/runner/ipc；preload；适配层；设计运行时；worker 代理工具 + design-invoke；技能与设计师预设；tool-gate、hooks、计划模式。
验收：在对话里让 agent 新建一份设计 → `x.vetd/` 落盘、vite 起来、`vetd_status` 返回引擎与画框状态；计划模式下写类工具被拒；无设计时只暴露 `vetd_create`/`vetd_sizes`；两家厂商模型（如 Claude 与 GPT）真机跑通。
（2026-11-02 调整：上游 `vetd_screenshot`/`vetd_export`/部分 `vetd_direction` 操作依赖画布控制器，P1 不挂画布，这些工具返回可重试错误，截图验收移到 P2。）

**P2 画布**
Dockview 设计面板 + 全屏；画框 iframe、热更新、选中回传（attach 到 composer）、批注层与派活、撤销重做、交互模式、设备壳、引擎恢复 UI。
验收：CDP 打开画布，改 tsx 后 100ms 级热更新；选中元素 → 提问徽标 → 批注 → 自动派活发出固定的“调用 vetd_notes”prompt，agent 调用 `vetd_notes` 后拿到批注的定位信息（`anchor.frameId`、`element.source/domPath`）与标注截图（上游 0.7.6 已不再把选中常驻挂到输入框，prompt 本身也不内嵌定位，按上游现行行为）；依赖画布控制器的工具（清单见 `src/renderer/features/design/PORTING.md`）逐项可用，`vetd_screenshot` 截图卡显示画框。

**P3 画廊、导出、历史、文件树**
画廊视图与入口；`.vetdz` 导入导出、`.vetdz` 预览；样机 PNG/PDF；历史抽屉（history-runner）；文件树图标与右键；旧格式迁移。
验收：画廊列出多个项目的设计并能跳回会话；导出后再导入内容一致；历史恢复正确。

**收尾**
`THIRD_PARTY_NOTICES.md` 补 Vetta（Apache-2.0）与 taste-skill（MIT）声明并保留上游 NOTICE；`docs/engineering-reference/` 记录设计子系统边界；`pnpm typecheck && pnpm lint && pnpm test`。

上游测试（约 150 个，vitest + happy-dom）随源码迁入；依赖 Vetta 宿主的测试改用适配层 fake。新增的 Main 路径校验、端口与进程管理、design-invoke 校验、计划模式门控按 Red-Green 先写测试。

## 5. 明确不做

- SSH/远端设计引擎与远端端口转发（上游 `ssh-transport` 相关分支）。
- 托管 npm/Node 运行时；无系统 npm 时 `vetd_install` 直接报错。
- 扩展原生插件 API，或把本功能做成可卸载插件。
- 输入栏按钮挂点（上游未注册）。
- 手机端、IM 入口对设计的支持。
- Windows/Linux 打包验收（发布流程只覆盖 Mac arm64；资源脚本按平台写，但不验收）。
- 上游自动同步机制；只记录移植基准版本，以后人工同步。

## 6. 已确认决定（2026-11-02）

1. 画廊入口：AppRail 增加“设计”图标。
2. 设计技能默认开启（全局可见，由 tool-gate 控制工具暴露），设置中可关闭。
3. 接受引擎 `node_modules` 预装带来的安装包体积增加（预计数十 MB，P1 实测后记录）。

## 7. 风险

- 工具执行依赖渲染层：窗口重载中途的工具调用会失败，需结构化错误加 agent 重试提示。
- 多窗口时会话归属判定需要实现时确认（参照 browser-invoke 的会话路由）。
- 上游代码风格与本项目 Biome/tsconfig 规则不一致；迁入目录可能需要局部 lint 例外，避免大规模格式化导致与上游难以同步。
- 设计代码由 agent 生成并在 iframe/vite 中执行：iframe 跨源隔离 + 导航拦截是安全边界；vite 进程本身是本机 Node，与 agent bash 同等信任。

## 8. P1 验收记录（2026-11-02，隔离 userData + fake provider，CDP 9333）

- worker → Main → Renderer 运行时 → Main fs：`vetd_create` 生成 `ledger-app.vetd/`（design.json、theme.css、direction.json、`.history`），Stop hook 自动提交一条历史。
- 新会话扫描 cwd 发现设计后 11 个 `vetd_*` 全部可见；无设计项目只暴露 `vetd_create`/`vetd_sizes`；模型强调用隐藏工具得到 `Tool vetd_status not found`。
- 计划模式下 `vetd_create` 被拒，未落盘。`vetd_status` 返回设计列表与引擎状态。
- 引擎经 Electron-as-Node 在 127.0.0.1 随机端口启动，物化到 userData/design/engine/<版本>；离屏截图返回渲染正确的画框（Tailwind 与 theme 生效，probe 读到标题，scaleFactor 2）。停止引擎 8ms 返回且页面存活；SIGTERM 退出时 will-quit 清理全部 vite 进程。
- 全量：typecheck、lint、vitest 1140 文件/11968 用例、node:test 49、`pnpm build` 通过。
- 两厂商真实模型（2026-11-03，隔离 userData，仅复制一个网关 provider）：
  - Anthropic `claude-opus-5-5`：自然语言需求下自行 Read 技能 → `vetd_create`（mobile，brief/screens/intent）→ `vetd_direction propose`；后者因 P1 无画布返回可重试错误，模型按提示停止并向用户说明，未循环重试。
  - OpenAI `gpt-6.1-sol`：Read 技能 → `vetd_create`（poster 1080×1440）→ 同一会话立即可用的 `vetd_status`（验证 create 后即时开放全部工具）。
  - 两个设计包均由 Stop hook 自动提交一条历史。
- 观察：`vetd_create` 结果沿用上游“已在画布打开”的语义，GPT 据此对用户说“已打开”；P2 挂画布后该说法成立，P1 期间为已知措辞偏差。

## 9. 遗留到 P2/P3

- [x] P2-Main：崩溃孤儿引擎双层清理完成（父进程 watchdog + 启动 PID/命令签名复核）。隔离 Electron 43 Main（CDP 9444）启动真实 Vite 并确认 HTTP 200，SIGKILL Main 后约 369ms 引擎退出；真实 ps 清理、PID 复用拒杀、坏记录与链接均有测试。Windows 启动清理 fail-closed 不发信号，尚未真机验收。
- design IPC 只信任主窗口：其它应用窗口的运行时登记失败，工具一律路由主窗口。
- [x] P2 会话隔离：与上游单活动页签不同，宿主只允许调用 cwd 与当前查看 cwd 相同（包括同项目 designer child）时选择/等待设计；其它项目后台的画布依赖调用返回可重试错误，请用户切回，不抢前台画布。status 的文件发现、sizes/history 等照常可用，后台 status 不暴露其它项目的 open。controller 记录 mounted cwd，工具每次读取均校验；create 返回前等精确新路径，已创建未打开时返回原路径并提示勿重复 create。单画布租约排队/打开等待各最多 60 秒，结束/超时/取消释放；不实现后台 headless canvas，已发 IPC 不可撤销。详见 `src/renderer/features/design/PORTING.md` 和 `runtime-canvas.test.ts`。
- 已发出的 fs/engine/script IPC 无取消字段，取消只停止等待，不撤销已发生的写入或进程动作。
- [x] P2-Main：「画布已打开」已通过 IPC → Main cwd 并集 → agentHost ready 重推 → supervisor → DesignPresence 接入门控。跨 sender 替换、销毁清理、SSH 忽略、worker 重启及关闭回退均有回归。依赖画布控制器的工具仍由 Renderer 验收，清单见 `src/renderer/features/design/PORTING.md`。
- [x] P2-Main：`vetd_*` 工具结果 `details.cards` 白名单投影为 `designCards`，实时与 JSONL 恢复共用投影；每消息最多 32 张，字段 ≤512 字符，payload 仅 JSON 普通对象且 ≤4KB。
- [x] P2 设计师角色：内置 `designer` 子 agent 已接入 typed child 与 coworker 路径；Main 验证精确 child 身份与工具证明，按 root/worktree 路由，结果回到 child，历史 hook 只由 parent 持有。设计开关同时影响可见角色、候选和 registry revision。

## 10. P2 集成验收记录（2026-11-03）

所有运行时验证使用独立 `/tmp` userData 与临时项目，未操作用户真实会话；隔离实例、
复制的 provider 配置、临时项目和对照 worktree 均已清理。

- CDP：画框成功渲染，修改 `Ledger v1` 为 `Ledger v2 HMR` 后原 iframe 不重建、内容热更新；
  画布明暗主题、全屏、输入框快捷键隔离与宿主弹窗层级通过。
- 工具：单帧 screenshot、status、direction deal/propose/choose、素材搜索、PNG images 导出通过；
  screenshot 卡实时与刷新后恢复通过。真机发现 CSP 缺少 `img-src blob:`，修复后缩略图成功加载。
- 批注：UI 落钉、输入批注、保存源码锚点（`frames/index.tsx:5`）并自动发出调用 `vetd_notes`
  的固定指令；冻结锚点读取通过。补验活体时发现新 iframe 的 bridge ready 早于 React
  frame 渲染，查询会命中空 div 或误判锚点过期；先以两个失败测试复现，再让查询等待
  rendered。真机复验返回 `h1`、正确文本、`frames/index.tsx:3` 且无 `anchorStale`，编号
  标注截图已读取确认；resolve 回复落盘且 pendingRemaining 为 0。
- 多画框：同一画布显示 index/second 两帧，`all:true` 与显式 `frames:["index","second"]`
  均返回两张快照及总览图；已目视确认两帧内容，重复检查能返回 stalledFrames。
- 引擎恢复：仅杀死已核验 PID/父进程/userData 的隔离 Vite，自动恢复后端口改变，status
  报 running，两帧仍在，单帧截图再次成功；不杀其它项目的 Vite。
- 真实 Anthropic `claude-opus-5-5`：自主读技能、创建番茄钟首页、提方向并修正对比度失败、
  安装字体、写 theme/frame、多次截图自检并修正数据矛盾，最终 notes 为空。
- 真实 OpenAI `gpt-6.1-sol`：parent 自行派出 designer，未直接调用设计工具；child 自主
  读技能、创建骑行竖版海报、安装字体、写源码并截图修正重叠。该次暴露跨会话画布问题，
  不能把 child 再 create 得到后缀包的绕过当作验收成功。
- 会话隔离修复：假 provider 对照已提交 `4a3ae51b` 和修复版本，以收到工具结果后的下一条
  独立模型响应验证（不是同一响应并列 toolCall）。旧版可见后续工具，但 create 返回时
  status 为 `open:null`；修复版 designer 创建后 status 指向 B、截图正确且只生成一个无后缀包，
  切回 A 的 status/截图仍正确。后台 B 不切走前台 A，status 不暴露 A，截图返回可重试错误。
  原始“B 读到 A”的具体挂载竞态未稳定重现，不伪称已定位它的唯一触发时序。
- P3 / 联合收尾仍需覆盖：画廊、分享包与样机 PNG/PDF、历史 UI/恢复和文件树。实际安装包
  体积、签名/公证和 LGPL 分发义务最终确认仍属 CI/发布验收，桌面构建通过不等于已安装或已发布。
- 最终集成检查：`pnpm typecheck`、`pnpm lint`（无错误，仅既有提示）、`pnpm test`
  （Vitest 1151 文件通过 / 2 跳过，12045 用例通过 / 10 跳过；node:test 49 通过）、
  `pnpm build`、`pnpm --filter @enso/phone typecheck` 与 `build` 全部成功。

## 附录 A：上游宿主依赖（调研结论）

- fs：readFile/writeFile/readDir/stat/delete/watchDirectory（回调只给目录路径字符串、宿主共用广播）、rename/createDirectory、listFilesRecursive（跳过隐藏项、上限万条）、readBinaryFile、saveAs。`move` 未实际使用。
- command：run（一次性、无 shell）；spawn（长驻，stop/status/onExit，`{{PORT}}` 替换）。
- capture：输入 URL、CSS 宽高、复用 key、准备脚本、就绪表达式、探针；输出 dataUrl、scaleFactor、probe；releaseOffscreen。
- storage：插件私有、跨项目持久化（方向历史、体系目录缓存）；位图缓存另用 IndexedDB，偏好另用 localStorage。
- network：Main 侧请求，绕 CORS，受 allowedHosts 限制。
- agent：registerTool / registerHook / registerSystemPromptProvider（tool-gate 注入 designer.md 视觉原则）。
- conversation：会话/工具/回合事件订阅（订阅即重放），createSession、sendPrompt。
- official：projects.list/create/archive、sessions.list/listRunningCwds/open、navigation.open、dialog.openFiles、shell.showItemInFolder。
- ui：各挂点注册，copyImage、previewImage、openExternal、notify、setWorkspaceViewHeader、setActivityPanelWidth、iconUrl。
- 工具：vetd_create / screenshot / status / sizes / install / notes / direction / assets / export / history / restore。
- 引擎桥消息（均带 `vetd:true`）：父→子 set-mode/show-frame/navigate/reload/clear-selection/capture/resolve-element/interaction-config/frame-radius；子→父 ready/rendered/selected/exit-inspect/captured/hmr-updated/frame-error/context-menu/navigated/wheel/space/element-resolved/storage/status-bar-kind。
- history-runner：isomorphic-git + fflate 单文件脚本，管理包内 `.history`，stdout 返回 JSON；需先构建。
