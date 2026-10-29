---
name: enso-cdp
description: >
  Drive the EnsoCode dev Electron renderer via bounded, loopback-only CDP helpers.
  Use when verifying UI in the running app, sending a composer chat turn, reading
  conversation/timeline state, screenshots, CDP, 真机验证, remote-debugging-port,
  or after changing renderer/main/agent/preload. Use when the user runs /enso-cdp.
---

# EnsoCode CDP

Dev (`!app.isPackaged`) already opens **9222** in `src/main/index.ts`. Do not inject `TEMP-DEBUG`. Packaged builds stay closed.

## Scripts first

免依赖脚本在 `scripts/`（相对本 skill 目录），优先用它们，不要重写 connect 样板：

```bash
node scripts/cdp.mjs pages                          # 列出 page 目标
node scripts/cdp.mjs eval '(async()=>{...})()'      # 主窗口执行 JS（支持 await）
node scripts/cdp.mjs eval '...' --page settings.html # 设置窗口
node scripts/cdp.mjs shot /tmp/x.png                # 截图
node scripts/cdp.mjs keys ArrowDown Enter           # 受信任按键（真实输入管线）
node scripts/cdp.mjs type '@rev'                    # 受信任文本输入
node scripts/cdp.mjs drag '<fromJS>' '<toJS>'       # 受信任鼠标拖拽（from/to 为返回 {x,y} 的 JS）
node scripts/cdp.mjs ready 'textarea' --timeout 15000 # DOM/preload + 唯一可见非零框元素
node scripts/cdp.mjs click 'button[aria-label="Settings"]'
node scripts/cdp.mjs click '[data-session-id="ID"]' --button right
```

以上路径相对本 skill 目录；在仓库根运行需加 `.agents/skills/enso-cdp/` 前缀。Node ≥22，无额外依赖。
`--page`、`--timeout` 可放在位置参数前后；文本以 `--` 开头时用 `--` 分隔。
超时单位毫秒，范围 1–300000，默认 30000。HTTP、WS 握手、每条 RPC 和等待均有 deadline；断线/error 会拒绝所有 pending。只连 loopback，拒绝 HTTP redirect、非法端口、非 page、无匹配 `NO_PAGE` 或多匹配 `AMBIGUOUS_PAGE`，不猜第一个目标。
连接/RPC 超时只说明结果未知，**任何有副作用操作都不自动重试**。

合成事件（eval 里 dispatchEvent）`isTrusted=false` 且不过 IME/焦点管线；排查“真实键盘行为”用 `keys`/`type`。

`keys Enter` 只发 `rawKeyDown`/`keyUp`，不产生字符事件，**不会触发 `<form>` 的隐式提交**；验表单回车要手发 `Input.dispatchKeyEvent {type:'keyDown', text:'\r', key:'Enter', windowsVirtualKeyCode:13}`，或直接点提交按钮。

## 鼠标拖拽 / 点击（Input.dispatchMouseEvent）

**可见不等于聚焦**：`document.visibilityState === 'hidden'` 时 Chromium 可能静默丢弃鼠标按键事件；`visible` 但 `document.hasFocus() === false` 也不能宣称真实输入成功。
`click` 先等待唯一 CSS 元素可见/非零框/未禁用，再经真实 `Input.dispatchMouseEvent` 点击，点击后复查焦点。`drag/type/keys` 共享前后焦点检查。
脚本先尝试 `Page.bringToFront`；若仍未聚焦，macOS 仅通过 `/json/version` 的 **browser target** 调 `SystemInfo.getProcessInfo` 确认唯一 browser PID，再按 **unix id** 激活该实例。禁止按 Electron 进程名选第一个（可能误激活用户另一实例）。PID/权限/实际焦点不能可靠确认时返回 `MANUAL_FOCUS_REQUIRED`，请人工聚焦；不伪报成功，不自动重放点击/输入。

其它要点：
- dnd-kit 等 PointerSensor 库必须走真实指针管线；eval 里合成 PointerEvent/HTML5 drag 事件无效。
- 拖拽需要 press 后**分段** move（越过 activation 距离阈值），落点前悬停 ~150ms 让 droppable 识别。
- 拖到“拖动中才出现的落点”（如临时 drop bar）：先 press+小幅 move 激活拖拽，再 query 落点坐标继续 move。
- 验证断言别用 class 子串（如 `border-ring`）：Tailwind 的 `focus-within:border-ring` 会让 `className.includes()` 永真。

隔离验证环境（不碰真实 userData）：

```bash
node scripts/mk-env.mjs /tmp/enso-x 2      # 2 个 fake provider（凭证尾号可区分）
node <repo>/scripts/fake-provider-issue-27.mjs &   # 8899；支持 [[tool:name {json}]] 指令
ENSO_USER_DATA_DIR=/tmp/enso-x ENSO_CDP_PORT=9333 pnpm dev
ENSO_CDP_PORT=9333 node scripts/cdp.mjs pages
curl -s http://127.0.0.1:8899/__requests   # 每个请求实际带的凭证尾号
```

**隔离验证必须错开 CDP 端口**：用户自己的 dev 实例（真实 userData）常驻 9222，第二个实例绑不上端口也不报错，`cdp.mjs` 会静默连到用户实例，写操作直接落进真实数据。动手前先 `lsof -nP -iTCP:<port> -sTCP:LISTEN` 确认 PID 属于隔离实例（`ps -E -p <pid>` 能看到 `ENSO_USER_DATA_DIR`）。

常用 store 入口（eval 里）：`window.__stores.sessions.getState()` / `window.__stores.settings.getState()`；`window.electronAPI.*` 是 preload API。

## Session helpers（优先于手写 store/send）

隔离实例确认 PID 后，在仓库根执行：

```bash
export ENSO_CDP_PORT=9333
node .agents/skills/enso-cdp/scripts/cdp.mjs ready
node .agents/skills/enso-cdp/scripts/cdp.mjs session-new '<projectId>'
node .agents/skills/enso-cdp/scripts/cdp.mjs session-send '<sessionId>' '请检查当前项目' --provider-id pv-A --model-id fake-model-1
# send 返回 accepted:true、afterSeq；传给 wait 可明确本轮水位
node .agents/skills/enso-cdp/scripts/cdp.mjs session-wait '<sessionId>' --after-seq 12 --timeout 60000
node .agents/skills/enso-cdp/scripts/cdp.mjs session-read '<sessionId>'
```

- 新增写命令 `session-new/send` 默认**拒绝 9222**。确需用户默认实例时每次显式加 `--allow-default-profile`；该开关不代表用户已批准任何具体业务操作。旧 `eval/click/type/keys/drag` 仍可写，不能绕过隔离/授权约束。
- `session-new` 复用 store `newConversation(projectId)`（可能复用已有空会话）；不私造 ID、不直接 spawn。
- `session-send` 验证已启用、已认证的聊天 provider/model；不传选型时按会话→项目→组→全局默认寻找可用模型。目前仅支持物理 provider/model，虚拟模型明确拒绝，不猜 fallback。cwd 必须取会话 worktree.path 或真实项目 path，缺失则发送前拒绝；调用严格为 `send(text,{providerId,modelId,cwd},undefined,id)`，只传 ID，不传密钥。忙碌、压缩或已有队列时拒绝，不把本次测试塞进其他轮次。返回 `accepted:true` 仅表示 store 接受，**不表示模型成功完成**。失败返回 `accepted:false`；超时/断线时可能已经执行，禁止自动重试。
- `session-wait` 有限轮询：成功必须观测真实 running 和 `turn-completed` 且 seq 超过发送前水位，不把 spawn-ready、短暂 idle 或旧 generation 事件当完成。send 在 renderer 安装轻量状态观察器，不存正文/凭证；同 renderer 下未指定 `--after-seq` 时沿用最近一次 send 水位。无 send 记录则从调用时建立基线；已经完成的旧轮次不假装新完成。重载 renderer 会清掉观察记录，请重新核实状态，不能自动重发。
- 待工具/能力审批、用户回答或 plan review 时返回 `waiting` 与 `complete:false/success:false`（非零退出），请人工处理；不替用户批准。超时返回最后 seq/status 和 `timedOut:true`。failed 收束也不算 success。
- `session-read` **只读 Main 权威历史**：父会话 `readParentHistoryTail(id)`，child `readChildHistory(id)`；返回原始 typed IPC 结果及 `authority:main`。允许冷会话 renderer.messages=[]；不把 store 正文/DOM 当权威，不读任意磁盘路径。tail/partial 标记须保留，不能声称全历史。
- 不新增生产 IPC、不打开 packaged CDP。main/worker/preload 变更需重启 dev；renderer HMR 不保证观察记录保留。

## Connect（手写时才看）

1. `pnpm dev` is running.
2. `curl -s http://127.0.0.1:9222/json/version` — if this fails, restart dev (port is not HMR).
3. Pick **`type === "page"`**, not `json/list[0]` (a `browser` target may come first). Main window is `http://localhost:5173/index.html`.

```bash
curl -s http://127.0.0.1:9222/json/list \
  | python3 -c "import json,sys; d=json.load(sys.stdin); p=next(x for x in d if x.get('type')=='page'); print(p['webSocketDebuggerUrl'])"
```

Node ≥ 22 has global `WebSocket`. Enable CDP, then evaluate with monotonic ids:

```js
await send('Runtime.enable');
async function evalExpr(expression) {
  const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (res.result?.exceptionDetails) throw new Error(JSON.stringify(res.result.exceptionDetails));
  return res.result?.result?.value;
}
```

`send` must map replies by `id`. Renderer vite root is `src/renderer`: dynamic import `/stores/...`, never `/src/renderer/stores/...`.

## Read

- Live chat: `document.body.innerText` (tail `slice(-1200)` for the latest turn). Messages are **not** in localStorage.
- Metadata only: `localStorage['enso-conversations']` — `messages` is always `[]`.
- Composer: `document.querySelector('textarea')`.
- Diff widgets: read `el.shadowRoot`, not light DOM.
- Viewport: chat scroller is `[data-slot=scroll-area-viewport]`, not `window`.
- Screenshot: `Page.captureScreenshot` `{ format: 'png' }`.

## Send (composer，只有验证输入交互时)

常规发消息用 session helpers，不要手写不完整 SendTarget 或只传 provider/model 而遗漏 cwd。只有测试真实输入时走：

```bash
node scripts/cdp.mjs click 'textarea'
node scripts/cdp.mjs type 'YOUR_PROMPT'
node scripts/cdp.mjs keys Enter
```

React controlled textarea 直接赋 `.value` 不会更新 state；合成 KeyboardEvent 也不代表受信任输入。完成性用 `session-wait`，正文用 `session-read`，不要固定 sleep 后把无错误 DOM 当成功。

Failed assistant text stays in the transcript. Judge “no error” on **new timestamps** or the tail, not the whole `innerText`.

## After code changes

- Renderer: HMR.
- `src/main` / `src/agent` / `src/preload`: restart `pnpm dev` or CDP is still the old worker.

Do not leave test sessions, scratch scripts, or mutated `settings.json` / `userData` behind. Backup real user files before touching them; restore and checksum after.
