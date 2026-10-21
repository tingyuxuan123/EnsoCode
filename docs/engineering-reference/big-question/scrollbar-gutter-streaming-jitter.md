# 自定义 ::-webkit-scrollbar 定宽后，滚动条出现/消失会推着内容重新折行（会话执行中「抖动」）

## 症状

会话执行（流式 + 思考块 + 多个终端卡片同时输出）时，聊天区**上下抖 / 内容跟着晃**。
真机里能看到两处同时作妖：

- 外面大滚动条（聊天主列表 scroller）：出现/消失时整块文字跟着跳一下；
- 里面思考小滚条（推理块 `ReasoningBody`）：滚条出现时那段文字重排。

CDP 实测（隔离 userData + 慢速 fake provider）：一轮工具执行中推理块
`clientWidth` 从 860 → 849 突变，紧接着所有可见行整体下移 42px。把该容器改成
`scrollbar-gutter: stable` 后同一场景：宽度 0 次变化、下移只发生在开场首帧。

## 根因

`globals.css` 里给 `::-webkit-scrollbar` 定了 8px。**一旦自定义了滚动条样式，
Chromium 就不再使用 overlay 滚动条**，滚动条从内容上层挪到布局里吃掉 8px 宽度
（实测 `offsetWidth - clientWidth = 8`；推理块那一层量到 11px，因为它自己再嵌一层）。

会话执行时这些容器的内容高度一直在阈值附近反复越界：流式增高、思考块折起、
终端输出灌入。于是滚动条一会儿出现一会儿消失 → `clientWidth` 反复变 → 文字重新折行
→ 行数/行高变 → 外层贴底逻辑再跟一次。「宽度变 → 折行 → 高度变」是个闭环，
所以看起来不像滚动而是整块内容在抖。

## 修法

内容会持续变长的滚动容器统一挂 `.scroll-stable`（`scrollbar-gutter: stable`，
定义在 `globals.css` 滚动条样式旁），槽位常驻，宽度与滚动条是否出现无关：

- `MessageTimeline`：虚拟化（Virtuoso `className`）与非虚拟化两条 scroller；
- `TimelineRow`：`ReasoningBody`（思考小滚条）、工具输出 `pre`、`ToolContentScroller`；
- `TaskBar`：子 agent 详情与任务日志；`PlanBar`：计划预览。

另外推理块贴底改 `useLayoutEffect`：它是自己的小滚动区，等 paint 之后再写
`scrollTop` 会先画一帧旧位置，高频增量下这一帧滞后同样是「小滚条在抖」。

## 验收

- 隔离实例 + 慢速 fake provider（thinking + 两个并行 bash 长输出），CDP 每帧采样
  `scroller.clientWidth` 与各行 `getBoundingClientRect().top`：
  - 修前：一轮内出现 inner `clientWidth` 变化、可见行集体下移 40px+；
  - 修后：宽度 0 次变化，下移只在开场首帧。
- 短会话首条消息（内容刚好跨过一屏）时，主 scroller `clientWidth` 从第一帧起就恒定。

## 不做什么

- 不改滚动条配色/宽度，也不把聊天滚条改成常显 `overflow-y: scroll`（槽位已解决，
  常显只是滚条视觉上一直在，反而多占一屏观感）。
- 不动行内折叠动效与贴底循环，它们的抖动来源是高度动画而不是宽度。
