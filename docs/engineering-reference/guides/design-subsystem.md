# 内置设计子系统边界

Open Vetta 的业务代码保留在 `src/renderer/features/design/vetta/`，宿主兼容面在
`host/`，UI 由 `mounts/` 接入；不是原生扩展插件，不向其它插件开放通用宿主 API。
详细基准和必要替换见 `src/renderer/features/design/PORTING.md`。

## 权威与执行

- agent 只调用 `vetd_*` 代理，Main 校验会话 generation/身份、审批开关后转 Renderer handler。
  Main 托管根、文件、Vite、离屏截图和固定 history/syntax 脚本；不能下放任意 command。
- Renderer 使用 `{root:{kind,sessionId/projectId},rel}`，不回传任意绝对路径；Main 根据
  source authority/worktree 推导 realpath，再校验最近存在祖先与设计产物写白名单。
- controller 是窗口单例，但不能据窗口推断工具所属项目。每次取 controller 都按规范 cwd
  校验；create 等精确目标就绪，失败保留已创建路径。后台项目不能抢走前台画布。
- 文件预览/导入/历史解包绑定原会话和规范根，异步后复核 owner；不能按全局“最长匹配路径”
  改选权限。取消不返回成功，但已发出的文件/引擎 IPC 无回滚承诺。
- 交互预览“浏览器打开”不走通用 HTTPS 外链：宿主将本机 URL 映射成已登记 engineId +
  path/query/hash，Main 复核该引擎仍存活且属于 sender，再用权威端口拼回环 URL。
  其它 HTTP 服务、未知/失效引擎和能改变 origin 的路径一律拒绝，不放宽网络请求策略。
- 编辑画布外壳使用 `overflow: clip` 而非 `hidden`：平移只能来自 world transform。
  `hidden` 仍允许焦点/scrollIntoView/原生滚动改变 scrollLeft/scrollTop，把同层工具栏一起带走。
  真 Chromium 回归：隔离实例打开超出视口的画框后执行
  `ENSO_CDP_PORT=9333 node scripts/check-design-canvas-viewport.mjs`；happy-dom 无布局，不能代替该验证。

## 分享与预览

- `src/shared/design/archive.ts` 统一解码规则；Main 和 standalone runner 不只信 ZIP 声明
  大小。校验实际展开量、CRC、条目数、路径别名冲突与文件类型，导入前预验嵌套历史。
- 导出在保存前通过同一完整 importer 校验，不能生成自身拒绝导入的包。打包串行，失败也
  清理中间构建。拖入读取前先检查 File.size，不得先为超大文件分配 arrayBuffer。
- 分享包只读预览不能继承主窗口的脚本权限。使用 Main 临时 loopback URL、不可猜 token、
  独立 CSP，双层 sandbox allow-scripts 且无 same-origin；不暴露 preload、父 DOM 和外部网络。
  服务只有 HTML GET，无磁盘映射或通用 HTTP API；关闭和窗口销毁释放。
- 从只读包转为可执行本机设计前，明确提示源码/依赖安装风险并获得确认。ZIP 无 symlink
  不等于 Git 对象无 symlink；恢复前预检 Git tree，只允许普通源码文件与目录。

## UI 与项目

- 画廊只在本机 Code 模式/designEnabled 下可用；状态不持久，选择会话退出。header 独立
  订阅，不能让上游每次 render 发布的新 ReactNode 反向触发整个画廊重渲染。
- 项目创建仅收名称，Main 落在 Documents/EnsoCode/Designs；现有 source authority 登记。
  “隐藏”只影响设计画廊，可恢复，不删除目录/会话或撤销项目权限。坏来源单独跳过。
- 画廊只导航 root 会话；child 按父+tab 路由，不能直接设为根 activeId。
  离开画廊后的创建/导入回调不得抢回导航；已完成写入不伪称已取消。

## 回归与重建

- `src/main/services/design/`、`src/shared/design/archive.test.ts`、design Vitest project。
- 真机必须检查 CSP、iframe 实际内容、工具 Main 历史和磁盘产物；happy-dom 不执行浏览器
  CSP，不能替代。模型自主工具链至少两厂商验证。
- `node scripts/build-design-runner.mjs` 显式重建可读 standalone runner；复制 shared decoder
  为随包首选源码，测试保证一致。不要修改 minified artifact 或在应用启动时下载构建工具。
- 资源与 LGPL helper 的来源/重建见 `resources/design/UPSTREAM.md`、`THIRD_PARTY_NOTICES.md`。
  构建通过不是签名/公证/已安装的证明，发布仍走既有 CI。
