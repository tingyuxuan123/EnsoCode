# Collabra 原生插件

本次工作区移植以 `J3n5en/EnsoCode@c221f690`（0.3.5）为固定基线；安装版是否具备新 API 取决于实际发布版本。工程边界见 [移植记录](project-history/2026-11-13-plugin-port.md)。

原生插件是含 `enso-plugin.json` 的目录；安装会复制到应用私有数据目录，不继续引用源目录。
它与 Claude Code 插件互不替代：设置 → 插件里两类插件分区管理。
可审阅的离线例子见 [examples/plugins](../examples/plugins/README.md)。

## 适用范围：本仓库的原生插件 API

本文描述的是 **小满实际实现的原生插件 API，清单版本为 `schemaVersion: 1`**，不是 Open Vetta、VS Code 或 Claude Code 的插件 SDK。那些平台的插件不能只改文件名就按本文运行。

界面布局、主题和侧栏可以改变，但插件应通过 `enso.slots`、`enso.composer` 等宿主接口工作，不要依赖小满内部组件、DOM 选择器或内部 store。`ui.js` 虽然同权，直接访问这些内部实现也不属于稳定兼容约定。

安装版不一定包含当前工作区尚未发布的功能。如果没有主侧栏「扩展」入口，使用下面保留的「设置 → 插件」入口；是否存在入口不能代替实际 API 兼容验证。

### 从本地模板开始

在本仓库（Node.js 22+，已准备开发依赖）运行：

```bash
pnpm plugin:init ../my-plugin --id org.example.hello
pnpm plugin:validate ../my-plugin
pnpm plugin:testing ../my-plugin
pnpm plugin:pack ../my-plugin --out ../my-plugin.zip
```

`init` 生成清单、`main.mjs`、`ui.js` 和可选的类型检查文件。目标必须不存在或为空，上级目录须已存在，路径不能经过符号链接（例如 macOS 的 `/tmp` 可改用 `/private/tmp`）。
`validate` 对目录使用与安装预览相同的清单、版本与资源路径检查；输出警告，失败时返回非零退出码。它不执行或导入插件脚本，也不检查 JS 语法、导出和运行时注册；通过不代表插件受信任或能运行。

然后用 **扩展 → 添加扩展 → 从文件夹安装** 选择生成目录（也可用 **设置 → 插件 → Enso plugins**）。检查权限预览，确认「安装并启用」后插件即启用；之后可在插件详情里停用。回到本机 Code 会话，输入框右侧的「插入问候」会把文本写到草稿，不会发送给模型。两个命令都不会安装或启用插件。

`plugin:pack` 复用安装校验，不执行代码，产出固定顺序/时间戳的 ZIP 并输出 SHA-256；排除隐藏文件、`node_modules`、`test/`、ZIP 与测试桩，排除后仍须通过安装校验，不覆盖已有输出。
`plugin:testing` 写入零依赖 `enso-testing.mjs` 和 `test/main.test.mjs`（已有文件不覆盖）。在插件目录执行 `node --test`；`mountMain(activate,{config?,host?})` 返回 tool/command/fire/schedule/method 等调用方法与 `calls` 宿主调用记录。它不验证权限、Electron 或真实模型。

[`enso-plugin.d.ts`](../examples/plugins/starter/enso-plugin.d.ts) 是本 fork 的独立作者声明；模板用 JSDoc 引用本地副本，没有运行时 SDK。`PluginActivate` 对应 Node `activate`，`PluginOnLoad` 对应 `ui.js`，`PluginViewApi` 对应侧栏 HTML 的 `window.enso`。声明包括命令、事件、定时任务、会话和产物 API；工具可给清单静态条目注册处理器，也可在清单动态配额内注册。仓库类型入口为 [`types/enso-plugin.d.ts`](../types/enso-plugin.d.ts)。
如需在仓库外进行 JS 类型检查，从插件目录的上级开发目录提供 TypeScript 与 React 19 的 `@types/react`，然后执行 `tsc -p my-plugin/jsconfig.json`。不要把 `node_modules` 放进待安装目录；没有这些类型依赖也可静态校验和安装。

### 更多完整示例

本文后面的清单与 API 片段分别用于说明接口，**不是都能单独复制成一个完整插件**。入口脚本注册的工具、方法、补全必须与清单声明及权限匹配。

如需学习补全，可复制 [`examples/plugins/snippets`](../examples/plugins/snippets)，保留其中配套的三个文件：

```text
my-snippets/
├─ enso-plugin.json
├─ main.mjs
└─ ui.js
```

1. 先不改示例代码，从文件夹安装整个目录，并在权限预览后确认「安装并启用」。
2. 插件已启用，回到本机 Code 项目对话。
3. 点击输入框的「插入时间」，应当把日期写进草稿；输入 `#review` 并选择补全，应当写入审查提示词。这些动作不需要向模型发送消息。
4. 停用插件，按钮与补全应撤销。
5. 开发自己的版本时修改清单的 `id`、`name` 和实现；在插件详情启用「开发模式」，源码保存并停止改动约 400ms 后自动重装安装副本。扩大权限不会自动同意，须手动重新安装确认。开发开关只在内存保留，重启后关闭。

最近核验（2026-11-04）：当前二开工作区的隔离 Electron 开发实例已通过上述 `snippets` 安装、启用、按钮写入、Node 补全与停用清理流程；相关加载、草稿、挂点、子进程等专项测试 21 项通过。此记录不代表本文每个 API、Windows/macOS 的所有安装版本或模型自主调用工具均已完成真机验收。

## 先理解信任边界

- **`main.mjs` 是完整的 Node.js 子进程，不是操作系统沙箱**。代码本身可以访问 Node 能访问的资源。
- **`ui.js` 在主界面执行，与小满界面同权**，可以访问 DOM 和界面已有接口。只启用完全信任的代码。
- 清单的权限、文件范围和域名只约束 **小满提供的宿主 API**，不能约束插件自己导入 Node 模块或直接操作页面。
- 侧栏 HTML 与上述两者不同：它运行在 `sandbox="allow-scripts"` 的 opaque-origin iframe，不能访问普通 preload、父界面或外部资源。页面只持有调用本插件的固定 MessagePort。
- 不要在清单、脚本、MCP `env` 或示例里放真实凭证。配置项可标记为 `secret`，界面只显示已设置状态；插件自己的代码仍能通过配置 API 取得自己被授权的值。

## 安装、更新、停用

主侧栏 **扩展 → 添加扩展**：可从文件夹、ZIP 或 HTTPS 插件链接安装。
自己开发时直接选择包含 `enso-plugin.json` 的文件夹；改完源码后用相同插件 ID 再安装一次更新应用内副本。
原有 **设置 → 插件 → Enso plugins** 入口仍可用。
安装 URL 及所有重定向目标一律只允许 `https:`，不接受明文 HTTP（包括非 GitHub 地址）。
预览展示版本、权限、文件范围、网络域名、MCP 命令和警告；**点击 Install and enable 才会安装**。
首次安装在你确认后默认启用，之后可随时停用；预览和权限确认不会被跳过，未确认前不安装也不启用。升级、从来源重装和自动更新保持你原来的启用或停用意图，原来停用的不会因升级自动复活。授权的权限扩大仍然要单独批准。URL 下载不等于信任代码；私有仓库与需认证下载不支持。

相同 id 再安装视为更新。授权范围扩大时旧版本继续运行，新版本等待单独批准；拒绝则保留旧版。
手动更新需要安装预览确认。市场来源默认允许未扩权更新自动安装，可在扩展页关闭；插件正忙则延后，扩大权限仍进入待批准。GitHub/其他链接来源只检查并提示，不自动安装。配置页的空密钥输入表示保持旧值，Clear value 表示显式删除。
卸载会删除插件安装副本、私有数据及配置。停用/卸载立即撤销宿主挂点、补全、侧栏桥及旧渲染 API。
插件必须自行在卸载清理函数里撤销它直接创建的监听器、计时器等；宿主无法把任意同权代码变成沙箱。
登记表缺失视为首次安装；已存在但损坏/无法读取（包括单条记录无效或重复）时不覆盖原件，能安全读取的内容按内容哈希备份为 `.corrupt` 文件：相同内容只备份一次，最多保留最近 5 份。插件管理进入只读并在设置页显示错误及恢复提示，拒绝安装、启停、卸载及配置写入，需人工恢复后重启。

## 清单

```json
{
  "schemaVersion": 1,
  "id": "enso.example.demo",
  "name": "Local demo",
  "version": "1.0.0",
  "main": "main.mjs",
  "renderer": "ui.js",
  "permissions": ["ui.slot", "composer.draft"],
  "contributes": {
    "triggers": [{ "symbol": "#", "name": "snippet" }],
    "configuration": [{ "key": "token", "title": "Token", "secret": true }]
  }
}
```

`id` 为小写反向域名，最长 40 字符；`name` 最长 60，`version` 最长 40。
`schemaVersion` 固定为 1，清单最大 256KB。可选 `engines.enso` 只支持 `>=x.y.z`。
插件资源路径须为安装目录内相对路径，不能含 `..`、绝对路径或反斜杠。

| 字段 | 用途 |
| --- | --- |
| `main` | Node 入口，导出 `activate(enso)`；声明工具、补全、方法、命令、配置时需要 |
| `renderer` | 主界面模块，导出 `onLoad(enso)`；需要 `ui.slot` |
| `fs.read` / `fs.write` | 宿主文件 API 的项目相对目录范围；`.` 表示项目全部；需相应权限 |
| `net.domains` | `net.fetch` 允许的主机名，不含协议或路径；需 `net.fetch` |
| `mcp.tools` | 精确 `server/tool` 白名单，如 `["bce/enhance_prompt"]`；需 `mcp.call`；不接受裸工具名或通配符，同名工具在其他 server 上不会获授权 |
| `contributes.agentTools` | `{name, description, parameters, timeoutMs?, readOnly?}`；需 `agent.tool`；schema 必须完整声明 `type: "object"`、properties 及各参数类型 |
| `contributes.views` | `{id, title, entry}`；entry 为自包含 `.html`；需 `ui.view` |
| `contributes.triggers` | `{symbol: "#", name}`；需 `ui.slot`；`@` 与 `/` 属于宿主 |
| `contributes.skills` | 本插件 skill 目录列表 |
| `contributes.mcpServers` | `{name, command, args, env}` stdio 服务；需 `mcp.server`；支持 `${ENSO_PLUGIN_ROOT}` 占位符 |
| `contributes.presets` | `{id, name, skills, mcpServers, workflows?, agentTypes?, instruction?, systemPrompt?, systemPromptTail?, boostPrompt?, refusalRetryPrompt?, refusalRetry?, model?, thinkingLevel?, approvalMode?, disabledTools?}`，仅引用本插件资源；正文为 Markdown 相对路径；审批取更严档位 |
| `contributes.methods` | `{name, timeoutMs}`；renderer 方法超时 1000–120000ms，未声明默认 2000ms |
| `contributes.configuration` | `{key, title, type?, description?, secret?, default?, multiline?, options?, min?, max?, pathKind?}`，支持 string/number/boolean/enum/path；缺省 string，secret 仅 string；最多 20 项 |
| `contributes.commands` | `{id, title, key?}`，输入框 `/` 菜单与快捷键；用户可改键，内置快捷键优先 |
| `contributes.statusItems` | `{id, text, tooltip?, command?}`，输入框底栏状态项，最多 8 项，可动态更新 |
| `contributes.fileViewers` | `{id, title, entry, extensions, default?}`，按扩展名在文件侧栏沙箱查看文本；需 `ui.view` |
| `contributes.workflows` | `<id>.js` 相对路径；项目/设置/全局目录优先于插件，插件优先于内置 |
| `contributes.agentTypes` | 插件子代理类型，可由插件预设圈定；`modelMode: "agent_pick"` 时允许主代理选模型 |
| `contributes.themes` | `{id, name, path, css?}`；JSON 浅/深色调色板，可选 CSS 要单独同意样式能力 |
| `contributes.events` / `schedules` / `exports` | 事件观察或拦截、定时任务与插件间导出方法，见下文 |

工具的本地名为小写字母开头的字母/数字/下划线，不得含 `__`。
模型侧名称为 `plugin_<id 的点换成横线>__<本地名>`，总长不超过 64。
MCP 服务名由宿主增加插件命名空间。同类贡献 id/name 不能重复。
`mcp.tools` 中 server 是宿主实际 MCP 服务名，插件调用宿主 MCP 时来自用户配置中已启用的服务，并非仅限插件自声明的服务。按最后一个 `/` 分隔 server 与 tool：server 为非空、无控制字符、长度不超过 128 的字符串，保留中文、空格及 `/`；tool 仅允许 1–64 个 ASCII 字母、数字、`_`、`.`、`-`，精确匹配两部分，不做 trim 或大小写转换。插件贡献的服务使用 `plugin-<插件 id 的点换成横线>-<本地服务名>`。

### 预设、工作流和子代理

插件预设以 `plugin:<插件 id>:<预设 id>` 寻址。可直接选用，也可在自建预设中通过 `pluginPresetId` 叠加：保留用户预设的指令、技能和 MCP，再加载插件贡献；真尾按用户在前、插件在后拼接。停用叠加插件后退回用户预设；直接选用已停用插件预设会明确失败。

技能、MCP、workflow 和子代理类型若被插件某个预设点名，只在该预设（或叠加它的用户预设）生效；未被点名的条目才对所有本机会话生效。模型与 thinking 可由预设指定，权限模式不得比用户当前设置更宽。`disabledTools` 与用户禁用列表合并，不能用热更新解除会话已经固定的禁用项。

`workflows` 文件名就是预设 ID，必须是合法的 `<id>.js`；同 ID 优先级为项目 → 设置目录 → 全局目录 → 插件 → 内置。文件按 Main 校验后的显式允许列表交给 worker，不扫描插件目录里的其他脚本。

本机原生插件不下发到 SSH、Bot/成员、归档或结束的会话。跨会话 API 的目标同样由 Main 权威目录复查，不能仅用 ID 形状或任意路径绕过。

### 事件、会话自动化与常驻

清单声明后使用 `events.on(name, handler)`；`contributes.events` 区分 observe 与 intercept。事件包括会话开始/结束、回合开始/结束、压缩、工具调用/结果、用户输入、上下文占用、会话状态和模型切换。

- `before_agent_start` 拦截结果只允许 `{append}` 追加当轮系统提示词，不允许取消本轮；总追加文本上限 16K 字符。
- `model_select` 只通知模型标识与切换来源，不发送凭证。
- `session_status` 由 Main 汇总（error > waiting > running > idle），worker 不能伪造同名宿主事件。
- 子会话带明确 `ctx.agent` 来源；不允许插件向子会话注入回合或改写子会话输入/结果，工具拦截预算独立受限。
- 观察事件、拦截、调度有时限与连续失败熔断；不要把它们当成必然送达的任务队列。

`session.list/status/focus/focusSubagent/openChildRun/create` 只使用会话标识；跨项目列表需 `session.readAll`，切换/创建遵守对应授权与真实用户操作。创建时 `presetId` 只能引用本插件预设。
`session.inject({text,images?,sessionId?,deliverAs?,triggerTurn?})` 与 `session.abort(sessionId?)` 需要 `agent.inject`；注入最多 4 张支持格式图片。跨会话注入必须由用户额外同意；空闲会话可由真实窗口启动后接收，不能把 UI 乐观显示当执行成功。

声明 `resident` / `process.background` 后可常驻；定时任务用 `schedules.register(id,handler)`。常驻进程可按授权更新状态项、侧栏事件，不能因此取得草稿或文件写入会话上下文。停用、更新和退出会取消调用并收敛进程树；更新等旧进程退出后才启动新版本。

### 状态项、侧栏事件和文件查看器

`ui.status.update(id,{text?,tooltip?,tone?,visible?})` 更新本插件声明的底栏状态项，可关联本插件命令；状态只在内存保留。
`ui.view.open(viewId?)` 打开/聚焦已声明侧栏，`ui.view.emit(name,data?)` 向本插件已打开页面推送事件；常驻和定时任务也可发送。需 `ui.view`，每条数据最多 256KB，与状态更新共享每秒 20 次限流；没打开的页面不缓存事件。

HTML 中 `enso.on(name,listener)` / `onTheme(listener)` 返回取消函数，`enso.storage.get/set/remove` 同步读写页面快照，写入异步持久化。文件查看器同样运行在沙箱，额外有 `enso.file:{rel,text,onChange,update}`；读取的是当前文件编辑区（含未保存内容），`enso.file.update(text)` 只修改这个编辑区，不直接写盘，不能访问任意磁盘文件。插件脚本开始执行时桥已就绪，不需要等待额外 ready 事件。

### 主题

主题 JSON 的 `light` / `dark` 均需 canvas/surface/sunken/border/borderStrong/text/textMuted/textSubtle/accent 调色板，可附安全 CSS token、固定素材槽与背景图。相对素材 URL 只在本插件包内解析，任意本机路径不会暴露给页面。附加 CSS 属于额外样式能力，扩大时要重新授权。
用户显式选择插件主题才覆盖当前主题；停用、卸载或加载失败时恢复原有 Collabra 配色，不改写薄荷白、cloud-light 等既有主题设置。
选中主题的调色板与附加 CSS 会应用到主窗口、设置、协作看板和独立设计窗口；固定素材槽与背景图依赖主窗口的 `data-enso` 挂点，只在主窗口出现，不会铺到设置或看板。

## Node 入口

```js
export function activate(enso) {
  enso.tools.register('count', async (args, ctx) => {
    return { content: String([...args.text].length) };
  });
}
```

| API | 说明 |
| --- | --- |
| `enso.pluginId` / `enso.dataDir` | 插件 id 与私有持久化目录；不要依赖常驻内存 |
| `tools.register(name, handler)` | handler(args, ctx) 返回字符串或 `{content, details?}`；单次 60 秒、结果 1MB；沿宿主工具审批 |
| `triggers.register(name, {candidates, pick})` | 补全来源，见下 |
| `renderer.handle(method, handler)` | 供本插件 ui.js / HTML 调用 |
| `fs.readText(path)` / `fs.writeText(path, text)` | 项目相对路径，宿主 API 检查范围、符号链接及会话状态；单文件 5MB |
| `net.fetch(url, init?)` | 域名白名单 http(s)，禁止内嵌凭证；响应 5MB，重定向逐次验证；返回 `{status, headers, body}` |
| `ui.notify(title, body?)` | 系统通知，需 `ui.notify` |
| `config.get()` | 本插件配置对象；可在 activate 内使用，不发送给 renderer |
| `composer.readDraft()` / `insertText()` / `replaceDraft()` | 当前调用所属窗口的草稿；需 `composer.draft`，见下 |
| `mcp.tools()` / `mcp.call(server, tool, args)` | 仅暴露白名单工具；沿当前会话、worker generation、取消与审批边界，不能绕过 Plan/当前会话限制 |

`ctx` 包含 `sessionId`（可能为 null）、`projectRoot`、`invocationId`、`signal`、`agent`（主会话为 null；子会话带来源）和 `progress(text)`。工具可用 `artifacts.write({name,text|base64,mime?})` 写入插件产物，模型工具结果和界面只传产物标识，不暴露任意路径。
宿主 API 每次回到 Main 校验；调用超时/取消后权限上下文失效。子进程不继承完整宿主环境。
插件同权代码不受这些宿主 API 约束，切勿把上表作为资源隔离承诺。

## 主界面 ui.js 与挂点

```js
export function onLoad(enso) {
  const h = enso.React.createElement;
  const remove = enso.slots.register({
    slot: 'composer.right',
    component: () => h('button', {
      type: 'button',
      onClick: async () => {
        const snapshot = await enso.composer.readDraft();
        await enso.composer.insertText({ text: 'literal text', expect: snapshot });
      }
    }, 'Insert')
  });
  return () => remove();
}
```

仅从已启用插件的本地安装资源加载模块，不把插件 URL 当脚本执行。
`enso.React` 是宿主 React，支持 hooks。`slots.register` 返回取消函数；onLoad 可返回总清理函数。
`enso.dispatch('plugin.call', {method, args})` 只能路由到本插件 renderer.handle。
模块应自包含（不使用相对 import），样式使用 CSS 变量，不依赖插件未参与编译的 Tailwind 类。

| slot | 额外注册字段 | props |
| --- | --- | --- |
| `composer.left` / `composer.right` | 无 | `{position, sessionId, draft, busy, presetId?}` |
| `message.action` | `position: "left"` 或 `"right"` | `{position, text, messageIndex?, sessionId?}` |
| `tool.card` | 本插件已声明的 `toolName` | `{toolName, output, state}` |
| `block` | 本地 `language` | `{language, source}` |
| `thinking.body` | 无 | `{text, streaming, itemKey}`，替换思考正文；失败回落文字 |
| `message.leaf` | 无 | `{source, final, messageIndex, sessionId, Markdown}`，在回复正文叶子后追加内容 |

不支持 composer.activity/dock 等未接入挂点。渲染模块提供 `theme` 和 `onTheme(listener)`，挂载时读当前值，后续变化订阅回调。
工具卡只能命中本插件的工具，不能替换内置工具或其他插件工具。
代码块语言必须写为 `<pluginId>:<language>`，例如 `enso.example.wordstats:bars`，不占用通用 `mermaid` 等语言。
停用后的代码块回退普通代码显示。
插件组件渲染抛错时，只回退该挂点；代码块仍显示原始代码，宿主输入框、工具结果和其它挂点不受影响。
流式代码结束或工具状态变化时可重试失败挂点。这是 React 渲染兜底，不隔离同权插件脚本的其它副作用。

## 草稿：版本锁与字面量

`readDraft()` 返回 `{text, hasReferences, generation, rev}`。
**所有写入都必须传 `expect: {generation, rev}`**，包括 insertText；不要在异步操作完成后重新读最新版本再无条件覆盖。
会话切换、Composer 重新登记、跨窗口、用户编辑（包括撤销回旧文本）都会让旧快照失效。

```js
const snapshot = await enso.composer.readDraft();
const enhanced = await computeText(snapshot.text);
await enso.composer.replaceDraft({ text: enhanced, expect: snapshot });
```

每次写入最多 32KB UTF-8。正在运行/审批锁定/IME 组字或含图片、文件/会话引用、接收人、slash chip 时拒绝写入。
写入是字面量文本，开头 `/` 不会自动激活命令选择或提交。
侧栏视图 iframe 的 Node 草稿调用必须同时满足：父 Renderer 收到调用时 `navigator.userActivation.isActive === true`，且 `document.activeElement` 正是该 iframe。这样主输入框的激活不能被未聚焦插件视图的定时器蹭用。手势由父 Renderer 判定并通过 IPC 上报，Main 缺省按 false 处理；iframe 自报标记不可信。激活具有 Chromium 的短暂有效窗口，焦点判定不是逐次点击证明。
手势权限仅在该调用内有效，最长 30 秒；模型工具和仅查询补全没有草稿权限，不能凭方法名或 iframe 自报标记获得授权。
草稿手势校验只约束侧栏视图 iframe；`ui.js` 通过 blob import 在 Renderer 主 realm 运行，与主界面同权限，属于受信代码，不能由此手势校验约束。它直接走本窗口桥，仍执行上述版本锁和编辑状态检查。

`#` 补全约 120ms 防抖，最多合计 50 条。候选 `{id, label, detail?}`，label 64 字符、detail 120；重复/坏项丢弃。
`pick(item)` 返回字符串或 `{text}`，最多 32KB UTF-8；异步返回期间用户继续输入或切会话则丢弃，不覆盖新输入。

## 侧栏 HTML

在侧栏 `+` 菜单打开插件声明的页面。HTML 必须自包含：内联 CSS/脚本，图片仅 data/blob。
普通 preload、外网 fetch/脚本/iframe/表单导航不可用。父窗口 source、一次性 nonce 和 MessagePort 握手不匹配的消息被丢弃。
Main 同时拦截插件子 frame 导航，仅允许本地 `plugin-view.html` 自身页面（可变 fragment），禁止跳转外部网页、其他本地文件、data/about 页面；不依赖 Chromium 未实现的 CSP `navigate-to`。

```html
<button id="read" type="button">Read</button>
<script>
  document.getElementById('read').onclick = async () => {
    const value = await window.enso.call('read');
    console.log(value);
  };
</script>
```

`window.enso.call(method, args)` 仅调用本插件 renderer.handle；`enso.theme` 为打开时 light/dark，
`<html data-theme>` 同步该值，不实时跟随主题。停用/卸载/关闭页面会销毁端口和旧页面。

## 预设与边界

已启用插件的预设在聊天预设选择器和设置页只读显示，id 为 `plugin:<pluginId>:<presetId>`。
附带 skills/MCP 只能引用本插件已声明项。被预设引用的资源只随选中该预设的新会话加载；其他全局插件资源随启用状态合并。
指令与角色正文由 Main 从安装目录读取；插件停用、删除或预设失效后需重新选择可用预设。
清单会直接拒绝未接入的 `systemPromptTail`、`boostPrompt`、`refusalRetry`、`refusalRetryPrompt` 字段（即便为 false），不会读取后静默忽略。没有 server CLI 安装入口。
`session.read` / `session.messages()` 当前不可用，请勿依赖。声明 commands 尚无桌面菜单入口。

常见错误：`PLUGIN_DISABLED`、`DRAFT_CHANGED`、`DRAFT_HAS_REFERENCES`、`DRAFT_BUSY`、`NO_COMPOSER`、
`NO_SESSION`、`GESTURE_REQUIRED`、`PERMISSION_DENIED`、`NOT_DECLARED`、`TOO_LARGE`、`TIMEOUT`、`ABORTED`。
界面调用参数/结果各 64KB；每插件每秒最多 10 次，连续失败触发短暂熔断。请向用户展示错误，不重试覆盖草稿。
