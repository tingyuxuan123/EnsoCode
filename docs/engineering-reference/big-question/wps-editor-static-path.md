# WPS 国际分享表白屏，内置浏览器看起来一直刷新

## 症状

- 用户报告同一分享链接 Chrome 可用，内置浏览器白屏、加载状态反复变化。
- 控制台显示 `global-static.wpscdn.com` 上的编辑器 JS/CSS 404。
- 同时可能出现聊天输入焦点丢失；不要把焦点、原生视图闪烁和网页导航循环混为一因。

## 根因

隔离 Electron 43 的新内存 session 能复现资源失败，URL 含重复路径：

```text
/docs/weboffice-static/weboffice-static/js/chunk/...
```

同一 CDN、同一资源移除重复的 `weboffice-static` 后，JS 和 CSS 均由 404 变为 200。
默认 Electron UA、去除 Electron 的 Chrome UA、中文和英文对照均失败，不能归因于中文
或仅凭 UA 猜测站点封锁 Electron。未证明用户 Chrome 为什么命中不同结果，不能把缓存
或登录状态差异写成已确认根因。

只修资源还不够验证隐藏窗口：0×0 / 无 focus emulation 会让编辑器停在初始化壳。
与 BrowserHost 相同地配置隐藏 viewport 和 focus emulation 后，编辑器和需求表头可读取。

## 修法

- `wpsStaticResourceRedirect` 只对 Main 认领的 tab、当前 `https://ap.wps.com` 页面触发。
- 只将 `https://global-static.wpscdn.com` 的重复前缀 JS/CSS 修正到同源规范路径。
- 不更改 UA、语言、Cookie、登录、API、文档主导航或其它站点，不把 403 改成成功。
- 与既有 file 请求门合并到同一个 `onBeforeRequest`，避免 Electron 的后注册监听覆盖
  工作区文件安全校验。未知归属的静态请求不重写，未知归属 file 请求继续拒绝。
- 焦点问题独立处理：Code 自动 reveal 后台登记面板；层级未变时不重挂原生 view。

## 回归防线

- `browserHost.security.test.ts` 先复现重复 JS/CSS 未修正，再验证精确重定向、正常路径不循环、
  其它页面/主导航/API/资源/未知 tab 不改写，以及原有 file 边界。
- 隔离真实 Electron 验证：12 秒只观察到一次主页面导航；26 个静态资源修正后不再返回 404，
  能读取“需求、优先级、状态、负责人、备注、测试情况”等表头；未输入或修改单元格。
- 尚未在用户安装版证明“持续刷新”已消失；该观察未复现主导航循环。真实登录态编辑、
  持续焦点与 IME、长时运行也不由这次读取验证覆盖。
- 网站修复自身资源后，正常路径不受规则影响；若部署路径变动，重新验证而非扩大通配范围。

## 相关代码

- [精确资源兼容规则](../../../src/shared/browser/wpsCompatibility.ts)
- [浏览器宿主与请求门](../../../src/main/services/browserHost.ts)
- [请求门回归](../../../src/main/services/browserHost.security.test.ts)
- [面板 reveal 与焦点](../../../src/renderer/lib/sidePanelDock.ts)
- [窗口规范](../main/windows.md)
