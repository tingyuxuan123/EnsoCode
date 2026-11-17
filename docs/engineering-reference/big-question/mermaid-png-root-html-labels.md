# Mermaid PNG 导出总是降级 SVG：根级 htmlLabels 优先于 flowchart 配置

## 症状

预览和 SVG 导出正常，PNG 单测也绿；真实 Electron 点击「导出 PNG」却提示降级，并下载第二份 SVG，Image.decode 没有报错。

## 根因（2026-11-16 核验）

当前 Mermaid 11.16 使用根级 `htmlLabels` 的优先级高于 `flowchart.htmlLabels`。旧预览只设置 `flowchart: {htmlLabels: false}`，实际仍产生 `<foreignObject>` 标签。PNG 导出防护在调用 canvas 之前就检测到它并回退，因而没有 decode/canvas 异常。

## 修法与验收

PNG 重渲染时显式设置根级 `htmlLabels: false`；不改预览布局/缩放行为。SVG 仍序列化当前预览，补 XML 命名空间并采用 viewBox 自然尺寸；PNG 独立重排、2x 渲染，超出 canvas 上限或失败时明确回退 SVG。

`scripts/verify-mermaid-export.mjs` 在隔离 Electron 中挂载真实 React 组件，点击两个按钮，捕获其实际下载 Blob/data URL 并解码，断言第二份 MIME 必须为 `image/png` 而非“下载成功”即可。2026-11-16 浅色/深色均生成有效 PNG（1173×131）；SVG 587×70。Node 纯函数单测不能替代这一渲染验收。
