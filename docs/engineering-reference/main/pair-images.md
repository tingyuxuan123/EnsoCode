# 配对会话图片（手机看 read / 生成图片）

## 行为差距

桌面会话里的图片预览依赖 **Electron 专有链路**：`read` 工具命中的图片、`generate_image` /
`edit_image` 产出的图片都由渲染层拼 `local-image://`（Main 注册的特权协议）直接读原文件。
手机 PWA 复用同一套渲染层组件，但浏览器不认这个 scheme：`<img>` 立刻 onError，
`ReadImagePreview` 退回文本详情，用户看到的就是「图片没了」。用户自己上传的附件不受影响——
它们以 `{type:'image', data, mimeType}` 内联在消息里，走的是 data URL。

## 归属层与链路

图片字节在电脑上，路径必须由 Main 按权威记录解析，所以这条能力属于配对传输层，不是渲染层：

- `packages/pair/src/protocol.ts`：上行 `session-image`（`sessionId` + 工作区相对路径），
  下行 `session-image-result`（`dataUrl` 或错误码），`host-info.images` 能力位。
- `src/shared/pair/imageRel.ts`：相对路径口径（拒绝对路径 / 盘符 / UNC / 反斜杠 / NUL / `..`）。
- `src/main/services/pairPolicy.ts`、`pairScope.ts`：白名单校验（未知字段、超长标识一律拒），
  并登记为**只读**命令，只读设备也能看图。
- `src/main/services/pairImages.ts`：权威根内解析、真实路径仍在根内、普通文件、图片扩展名白名单、
  字节上限、`O_NOFOLLOW` + 前后身份校验；端口在编码前重查权威根指纹，答复前由 `pairHost` 再查一次访问权。
- `src/main/ipc/pairImages.ts`：根来自 `codeFileContext`（项目 / 工作树 / 浏览器目录），
  编码用既有 `fitDataUrl`（≤700K 字符、长边 ≤2048），保证密文帧低于中继 1 MB。
- `packages/phone/src/sessionImagePort.ts`、`localImageRel.ts`、`chatHost.ts`：按会话去重请求、
  只缓存成功（失败可重试）、断线统一失败；绝对路径先在手机侧换成相对路径，目录外直接拒绝上衣。
- `src/renderer/components/chat/localImageSource.tsx`、`TimelineRow.tsx`、`GeneratedImageCard.tsx`：
  `ChatHost.readLocalImage` 存在时走远程读取，**加载中与失败都有可见状态**；不存在时保持桌面
  `local-image://` 行为不变。

## 明确不做

- Markdown 正文里的本地图片路径（桌面同样不解析，不是 PWA 回归）。
- Bot 成员会话：`codeFileContext` 对 bot 会话返回 null，仍是纯文本回退。
- 生成图片卡片的复制 / 下载 / 编辑动作：手机侧只在内存里有 data URL，不冒充桌面动作。

## 验证

- 单测：`src/main/services/pairImages.test.ts`（越界、symlink 逃逸、超大、非图片、权威根变化）、
  `pairPolicy.sessionImage.test.ts`、`packages/phone/src/sessionImagePort.test.ts`、
  `localImageRel.test.ts`、`chatHost.localImage.test.ts`、
  `src/renderer/components/chat/ReadImagePreview.remote.test.tsx`。
- 运行证据（真实中继 + 真实 pairHost + 真实 PWA，合成图片）：`temp/pair-image-evidence/out/`，
  深浅路径与失败态见 `report.md`。旧桌面不下发 `images`，手机保持纯文本回退。
