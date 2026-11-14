# 需求助手 0.2.2：冷计划会话的真实安装验收

## 现象与根因

用户在空白新对话、计划模式点击读取待办，报“当前会话状态不允许插件修改文件或调用 MCP”，同时列表误显示没有需求。

1. 读表依赖通用导航、输入和选区操作，命中 Plan 写权限；浏览器桥又要求 worker ready，新对话即使读取也无法授权。
2. 金山先经 `account.kdocs.cn` / `account.wps.cn` 自动 SSO，再回分享文档；Electron `loadURL` 可能在中间页返回，或以 `ERR_ABORTED` 拒绝。把该瞬间当最终文档会误拒；重放导航又会开更多页。
3. WPS 正常选区默认聚焦透明的 `#edit_proxy_runs`，不等于正在编辑。固定编辑层 `#editDivContainer` 的有效可见度应单独判断，不能用 activeElement 直接挡住正常读取。
4. 未登录时真正的 `.component-login-modal-pop .shadow` 会挡住地址框；需要用户本人登录，不能复制 Chrome 的 Cookie，也不能把登录阻挡当空待办。

## 修复边界

- 新增仅本机 UI 的 `read_range` 固定语义，地址限制 `A1:L201`，只操作地址框和捕获当次复制；Main 按权威项目/根会话版本授权，不启动 worker、不发模型消息。
- 通用写操作、模型、子代理和其它来源的原有写策略未放开。实际领取与回填仍逐次确认，本轮不宣称完整 Agent 交付链路已验证。
- SSO 阶段只观察本次固定 tab 的 URL，回到同一授权文档稳定后才输入；不把账户域加入浏览器控制白名单。导航被中断时 Host 返回本次固定 tab 标识，桥核对结果，不自动重开网页；账户回调完整 URL 不进入新错误投影。
- Host 在一个队列槽位内做就绪等待、原生地址框点击、输入前后焦点检查、范围复制和工作表复核；未确认的输入不重放。
- UI 区分未读取、读取中、失败和成功零条；改来源清空旧任务与旧确认，初次没填链接只显示准备提示。

## 实际安装验收

- 助手自行启动 `pnpm dev`，使用正式本地 ZIP 选择、暂存和提交链路升级；最终已启用 `0.2.2`，build `5a5a08b9cb97fba6`。
- 用户本人完成内置浏览器金山登录后，助手回到需求助手实际点击读取。未发过消息的原根会话保持计划模式，Renderer 消息数0、状态idle；读取成功显示“已连接”及1条负责人为谢的PWA图片需求，原空状态在UI显示待处理。
- 正式插件状态返回 `execution:null`、`preview:null`，没有领取、Agent投递或真实表回填；保留本次成功读取的浏览器标签，关闭本轮前面失败尝试产生的重复标签。
- 实测截图：`dist/plugins/requirements-v022-live.png`（含用户当前需求，未作为源码提交）。ZIP：`dist/plugins/需求助手-0.2.2.zip`，SHA256 `e1145c3fee6e1434c182cf86a51e1ac2999929befe34d239e1e175a4e353519a`。
- 最新 `pnpm typecheck && pnpm lint && pnpm test` 通过：Vitest 14,361通过、15跳过；Node插件专项57通过。lint只有既有GitChangesView冗余fragment的info，无新增错误。
- Electron fixture 另验证冷UI/Plan读取可用、通用写操作拒绝，并跑通隔离领取/交付；不是双模型真实业务验收。

经验更新在 [金山画布输入代理](../engineering-reference/big-question/wps-canvas-cell-input.md)，受限op契约见 [插件文档](../plugins.md)。

## 后续 0.2.3 界面减法

用户指出输入框右侧的需求助手入口多余，自己会从右侧面板打开。删除 `composer.right` 注册及对应组件/样式，仅保留结果工具卡；按TDD更新注册与幂等清理断言。已正式安装0.2.3并通过Main DOM与原生UI确认按钮消失，侧栏重新读取真实1条需求成功。类型、lint和全量回归再次通过，未发送模型消息或修改表格。
