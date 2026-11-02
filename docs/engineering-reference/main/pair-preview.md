# 配对 Web 网页预览

## 行为与所属层

这是 Main 的远端交互渲染能力，不是文件下载、公开 HTTP 隧道或 PWA 同源 HTML 展示。
Code 顶栏和 Bot 回复下方选择 Main 推导的 HTML / 本地开发服务候选；Web 只接收有界 JPEG，
发送有限的点击、滚动、文本和按键命令。HTML、React、Vue/Vite 复用同一预览入口。

- `packages/pair/src/protocol.ts`：`preview-*` 命令、能力声明、画面和输入类型。
- `src/main/ipc/pairPreview.ts`：会话 / Bot 所有权、project / worktree、权威投影和根身份。
- `src/main/services/pairPreview.ts`：候选推导、不透明 ID、配对归属、容量 / 并发 / 速率和销毁。
- `pairPreviewBrowser.ts`：专用无持久化分区、沙箱 offscreen 浏览器、截图和可信有限输入。
- `pairPreviewPolicy.ts`、`pairPreviewStatic.ts`：请求限制、静态 MIME / 目录边界与 Vite 兼容。
- `pairHost.ts`：既有密文传输、连接代际及加密前后授权守卫，不新增公网接口或通用 IPC。
- `packages/phone/src/WebPreview.tsx`、`previewPort.ts`：入口、画面、操作、断线与关闭回收。

## 安全边界

1. 助手生成的 HTML/JS **不得在保存配对 contentKey 的 PWA origin 上执行**。
   `sandbox="allow-scripts"` 的 opaque-origin iframe 实测不会被父页 Service Worker 接管，
   不能正确转发模块、动态 import 和 CSS；`allow-same-origin` 又会暴露配对存储。
   本能力选择电脑侧渲染，Web 中不插入这些 HTML/JS。
2. 每个预览独立内存 session，无 preload / Node / 持久化 Cookie，不复用 BrowserHost 浏览数据。
   先加载可信 `about:blank`，首次 `dom-ready` 后 attach debugger，安全初始化后再打开网页。
   固定启动脚本禁用 WebRTC/WebTransport；禁止权限、下载、文件选择、弹窗、子页面和 worker。
3. 网络只允许选中的数字回环地址及同端口 WS，或隔离 session 私有静态 origin。
   CSP、webRequest 和分区私有黑洞代理叠加，不能调用系统代理或暴露其他端口。
4. Wire 只收会话 / Bot 标识、不透明候选 ID、previewId 和有限输入，不收 URL、端口、路径或 CDP。
   开发服务 URL 从 Main 权威助手 / 工具正文提取，用户须显式点选；不扫描端口、不自动执行 npm。
   这是会话授权候选，不代表已验证服务进程属于该项目；不支持任意公网地址或 SSH。
5. 静态资源每次验证 realpath / inode / 根、普通文件、MIME 和大小；禁遍历、秘密文件和 symlink 逃逸。
   Vite `/@fs/` 默认禁止；仅项目内前端资源及项目依赖解析出的**精确** Vite `env.mjs` 可例外，
   不得按路径后缀或整个 node_modules 放行。Vue export-helper 使用精确虚拟模块例外。
6. 画面 data URL（含 base64）最多 700,000 字符，密文保持低于中继 1 MB；不是 JPEG 原始字节限制。
   输入绑定最新 frameId，手机坐标按**实际图像矩形**换算；导航后旧输入不能打到新页。
7. 同配对一个、全局最多两个（含创建中），每配对一个在途操作；关闭是取消，不排在截图后。
   断线、解绑、作用域 / 会话切换、Bot 停用、目录消失销毁浏览器；每次操作及加密前后重查权威。
   无目录事件的独立权威变更在操作时立即拒绝，最长 30 秒清理周期；闲置 10 分钟释放。

## 验证与边界

回归：`pairPreview*.test.ts`、`ipc/pairPreview.test.ts`、`pairHostMeta.test.ts`、
`pairPolicy.test.ts`、`pairScope.test.ts`、`phone/src/preview*.test.ts` 与 `client.test.ts`。

隔离 Electron + 临时 HTML/React/Vue Vite 项目真机验证：非空 800×600 JPEG、CSS / 动态 import、
点击计数、中文输入、刷新、hash 路由、Vite 重载、其他本地端口请求未到达 canary、
主文档和新建 iframe 的网络构造器均禁用，关闭后无残留窗口。
另验证 React/Vue `dist` 根资源、仅 IPv6 localhost 的开发服务与 HMR、滚动后像素确实包含
可见下半页（固定文档 clip(0,0) 不等于 viewport，截图不能带这个固定 clip）。
浏览器端另验证预览控件候选选择、图像缩放、点击、中文输入与关闭。
不能仅凭 mock CDP 调用通过就宣称真机完成。

当前不支持外部 CDN/API、跨端口资源、弹窗、上传、下载、嵌套页面、worker 和权限类网页功能。
依赖须本地或由所选开发服务同源提供；预览不是生产发布，也不提供公开分享链接。
