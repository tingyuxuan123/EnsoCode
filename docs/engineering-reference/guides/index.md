# 思考流程

动手前先想清楚，比写完再排查便宜得多。本目录收录跨层、复用、排障、发布、子系统与验收类指南。

| 指南 | 什么时候用 |
|------|-----------|
| [pre-implementation-checklist.md](pre-implementation-checklist.md) | 任何非平凡改动动手前 |
| [cross-layer-thinking-guide.md](cross-layer-thinking-guide.md) | 改动跨越主进程 / preload / 渲染层 |
| [code-reuse-thinking-guide.md](code-reuse-thinking-guide.md) | 准备新建文件或复制一段已有实现前 |
| [bug-root-cause-thinking-guide.md](bug-root-cause-thinking-guide.md) | 修完一个 bug 之后 |
| [design-subsystem.md](design-subsystem.md) | 改设计画布、设计窗口或预览服务 |
| [image-generation.md](image-generation.md) | 接入图片生成、远程图片抓取 |
| [plugin-market.md](plugin-market.md) | 改插件市场、签名、来源隔离或发布插件 |
| [relay-web-deploy.md](relay-web-deploy.md) | 部署或排查手机配对中继 / Web 入口 |
| [releasing.md](releasing.md) | 发版、打包、推送更新与安装验收 |
| [reproducible-review.md](reproducible-review.md) | 需要可复跑证据的代码审查和验收 |

## 本仓库的层

```
用户操作
  → 渲染层组件            src/renderer/components/
  → zustand store         src/renderer/stores/settings/
  → preload 出口          src/preload/index.ts
  → IPC handler           src/main/ipc/
  → service               src/main/services/
  → 文件系统 / 外部应用配置 / 网络
```

反向还有一条：主进程写入 settings 后广播 → 其它窗口 rehydrate → 副作用重放。

大多数难查的问题出在**层与层的交界**，而不是某一层内部。
