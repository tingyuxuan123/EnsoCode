# PWA 真实组件回归样例

运行 `pnpm --filter @enso/phone dev --host 127.0.0.1`，打开
`http://127.0.0.1:5174/test-ui/?screen=regression`。
该场景包含图片附件、长 provider/model、运行中的失败工具、后台命令，专门覆盖
2026-11-15 真机截图暴露的气泡嵌套、抬头重叠、页头弹层出屏及底部空白。
图片是合成测试数据，不包含用户截图或凭据。

浏览器/CDP 中的只读布局探针：

```js
await import('/test-ui/layout-probe.ts').then(m => m.measurePhoneLayout())
```

逐个使用 320×568、360×800、402×874、768×1024；同时检查深色
（`&theme=dark`）和 34px 安全区兜底（开发者工具设置
`document.documentElement.style.setProperty('--phone-safe-bottom', '34px')`）。
探针必须返回 `issues: []`；还要实际点开「后台命令」检查面板边界、X 关闭及系统返回。
不能把根字号/样式字符串测试或两条纯文本截图当作真实布局通过。

本目录只供 Vite dev，生产构建仍只有默认 index 入口，不输出 test-ui。
浏览器模拟不等于 Android WebAPK / iOS 安装态验收，系统导航栏需真机复核。

## 聊天页返回链路

打开 `/test-ui/?screen=navigation`，该场景使用生产的 `usePhoneScreenBack`、
`SessionDrawer`、`ChatScreen` 和设置面板，不使用第二套返回实现。

- 冷启动聊天 / 列表选中会话后，浏览器 Back 首先进入会话列表。
- 聊天设置打开时，Back 只关闭设置；再次 Back 才到列表。
- 工具栏打开的列表 Back 回聊天；下一次 Back 到根列表。
- Back 打开的根列表可正常离开；不要无限把它又返回到聊天。
- 显式返回按钮、Forward 与多次打开/关闭不能增长 history。

这些检查覆盖浏览器 History 路径，不等于 Android 边缘侧滑的真机验收。
