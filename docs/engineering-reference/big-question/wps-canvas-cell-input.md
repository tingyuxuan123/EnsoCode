# 金山表格的空输入代理不能当作单元格内容

## 症状

- 模拟表格和单元测试能通过，真实金山表格却读不到内容或无法回填。
- F2 后 `input.edit-proxy-runs.value` 仍是空串，尽管画布明显显示已有文字。
- 该输入代理 opacity 为0，不会出现在可见控件快照中，拿不到可点击ref。
- 选中 `A1:L201` 后地址框显示 `A1`，不能据此断言选区没生效。
- 地址框只用通用fill可能追加成 `H1H10`；校验前不能直接按回车。
- 新对话/计划模式点“读取待办”报“当前会话状态不允许插件修改文件或调用 MCP”。
- `box.focus()/select()` 后地址框值正确，但隐藏 Electron 的 Enter 没到地址框，复制仍是旧选区。

## 根因

真实表格的文字/选择状态由画布编辑器维护，DOM input只承接键盘输入，不是内容权威。
把普通HTML输入框当成真实WPS夹具，会让“读取.value、比较旧值、填入”的错误路径假绿。

读取范围需要导航和定位，但插件若借用通用输入 op，便会命中 Plan 写策略；原浏览器桥又要求已就绪 worker，导致空白新对话必失败。不能用“先发一句话”或把所有 UI 写入放开来掩盖这两个边界。另 DOM 焦点不等于 RenderWidget 键盘焦点，隐藏 Electron 必须用固定地址框的受验证中心点发原生点击，不调用窗口 focus 抢 OS 焦点。

真实 WPS 正常选区默认聚焦透明代理，需检查固定 `#editDivContainer` 自身及祖先的有效可见度，不能只看 activeElement。SSO 的中间账户页也不是最终导航结果：只观察固定 tab，等待回到同一授权文档；`ERR_ABORTED` 不代表网页没有打开，更不能自动重放导航。真正覆盖地址框的登录遮罩仍需用户本人处理。

## 修法

- 非编辑态通过页面正常复制流程读取选区，捕获本次 `DataTransfer.setData` 的纯文本。
  不读系统剪贴板、不调用网页私有HTTP/业务对象；钩子在同一队列槽位的finally收回。
- 复制自带的 `text/ksDocClipBoardInfo` 只投影零基范围及stable sheetId，fileId/linkId/HTML
  不透出。复制文本省略尾部空行/空列是正常行为，但范围必须与请求一致。
- 范围选取允许地址框回落到左上格；同时核对复制返回的完整范围，不能只宽松匹配地址框。
- 地址框输入走Home→Shift+End→Backspace→原生文字插入，回车前核对完整地址。
- 普通整表读取改用固定 `read_range`：Main 授权本机 UI 的权威会话版本；Host 只读等待就绪，验证地址框可见且未被提示遮挡，原生点击后全选；输入前后复核焦点、URL、取消及队列 guard，仅插入受限地址。复制后复查高亮工作表和范围。不对已发出的输入或 Enter 重试。
- 写格先复制旧值核对，再F2→Home→Shift+End→Backspace→原生文字插入→Enter，随后重新
  定位并复制读回。不要点击透明输入代理或比较其空value。
- 新的 `insert_text` 只向已聚焦、非密码/文件/hidden类型、非禁用/只读且非零尺寸的可编辑
  元素输入；允许opacity0，不自动focus或Enter。仍受会话、Plan、域名、队列和取消门约束。
- 表格发现自动识别需求/负责人/状态/备注，允许没有编号或测试列；没有编号时按正文与负责人
  生成身份并拒绝重复内容，正文变化即重新核对。空状态是待处理，不强迫团队加技术字段。

## 回归防线

- `test/plugins/kdocs-tasks/browser-sheet.test.mjs`：输入代理value恒空、范围名回落左上格、
  复制范围/工作表不匹配拒绝、跨文档拒绝、地址输入核对、原生输入而非点击ref。
- `test/plugins/kdocs-tasks/table.test.mjs`：真实表头、无编号、无测试列、空状态及TSV换行。
- `src/shared/browser/copySelection.test.ts` / `insertText.test.ts` 与对应BrowserHost测试：
  只捕获本次内容、限额、清理、敏感输入拒绝、opacity0支持、队列与取消。
- `wpsRange.test.ts`、`browserHost.wpsRange.test.ts`、`agent.test.ts`、`gate.test.ts`：冷 UI/Plan 只读可用、通用写仍拒绝、不可越界/跨文档/伪造来源、输入前焦点复查、只读等待和取消。Electron fixture 另验证 RenderWidget 原生焦点管线，不把 DOM-only 假绿当成功。
- 真实已登录浏览器读取了用户授权的表格；H10先确认空白，写入`test`后复制读回完全一致，
  随后清空并复制确认空白。既有需求行没有领取或回填。最后重载清除了临时诊断钩子。
- 匿名隔离窗口遭SSO/登录提示阻挡不是“表格无数据”，不能返回空待办，更不能复制用户Cookie
  到测试环境冒充登录验收。真实页读取/键盘验证不等于插件完整安装及双模型验收。
- 0.2.2 另在用户 dev 正式安装并实点验收：空白计划会话（消息0、idle）成功显示真实1条待办；用户本人登录，未执行领取/Agent投递/回填。详见 [验收记录](../../project-history/2026-11-14-requirements-helper-v022.md)。

## 相关代码

- [表格适配器](../../../examples/plugins/kdocs-tasks/lib/browser-sheet.mjs)
- [表头和TSV](../../../examples/plugins/kdocs-tasks/lib/table.mjs)
- [固定复制捕获](../../../src/shared/browser/copySelection.ts)
- [固定原生输入检查](../../../src/shared/browser/insertText.ts)
- [宿主浏览器桥](../../../src/main/services/pluginBrowserBridge.ts)
