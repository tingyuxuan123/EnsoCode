# 单画布移植到每会话 Dock 后，设计工具不能按窗口单例认归属

## 症状

真实模型中，A 画布已打开，切到空项目 B 后 designer 的 codemode 创建设计成功，
但后续 status 仍报 A 路径、截图找不到 B 的 frame；再次 create 产生 `-1` 才切过来。
DOM 同时只有一个画布，因此不能据此排除跨会话串状态。

隔离 userData + 假 provider 的主会话、designer 创建路径未稳定复现“B 仍指向 A”；
但连续 create/status 已观察到 create 声称 opened 而 status 的 open 为 null。
回归测试在修复前直接证明 B 请求可读到 A 的 singleton，create 也未等新 controller。
不要将单测或“没有同时挂多个 canvas”当作已证明原始竞态触发条件。

## 根因

上游每窗口只有一个活动画布，工具直接读模块级 controller，默认它就是调用者的工作区。
小满每会话一个 Dock，工具运行时又常驻窗口并承接 child/后台请求：窗口身份不等于
会话 cwd。create 仅发 cwd-scoped pending open，React 挂载、扫描、引擎启动均异步，
返回时没有验证 controller 是否已接管目标设计。前置检查也不足以覆盖 handler 中 await
后再次读取单例的情况。尚无证据证明原始真机是哪次挂载/路由竞态延长了旧 controller。

## 修法

- Main resolveRoot 的规范 cwd 用作调用身份；controller 记录 mounted cwd，工具每次
  读取 `getCanvasController(cwd)`，不能把嵌套项目仅按路径前缀当作父项目画布。
- 宿主串行画布依赖调用；同前台 cwd 才可选择/等待设计，create 等精确新路径就绪。
- 不同项目的后台请求不抢前台，返回可重试错误请用户切回；文件级 status/history 等
  仍可用，但不报告另一个项目的 open。
- Bot 委派独立根会话的 `bot.chatId` 为 `null`，不是 Code 会话的判断依据。Main 由该子会话的当前委派执行取所属话题，再按 topic + cwd 选择画布；Code 发起且无群聊归属的委派仍不捏造 `botChatId`。否则前台正是该群也会误报「画布正在查看另一个项目」，诱发手写 `.vetd` 目录或只交 PNG。
- 排队/打开等待各有 60 秒上限，取消/异常均释放租约。已创建但未打开的失败结果携带
  原路径并提示勿重复 create，避免用户/模型以创建后缀包“重试打开”。

## 回归防线

`runtime-canvas.test.ts` 覆盖旧 A controller 与前台 B 的交接、同 cwd 多设计精确等待、
后台拒绝且不切换、后台文件工具不等待、边界相似/嵌套路径、超时及取消后的租约释放。
`src/main/ipc/agent.test.ts` 另覆盖群委派的当前话题归属及 Code 委派的空归属。
真机必须另核对 Main 权威历史、status 的 open 路径和截图产物，不只看 DOM。

## 相关代码

- `src/renderer/features/design/host/canvas-target.ts`
- `src/renderer/features/design/runtime-dispatch.ts`
- `src/renderer/features/design/vetta/src/canvas/design-runtime.ts`
- `src/renderer/features/design/vetta/src/canvas/CanvasTab.tsx`
- `src/renderer/features/design/PORTING.md`
