# 自建中继的 Web 单独更新

## 已核验的部署拓扑

2026-11-02 在用户授权的 `124.222.38.18` 核验：

- 本机 SSH 配置别名：`server18`。复用已有 SSH 配置，不复制私钥或在文档保存凭据。
- 站点：`https://relay.yfdl.site`，由 `caddy.service` 提供 HTTPS。
- PWA 静态根：`/var/www/enso-relay-pwa`。
- Caddy 对 `/v1/*`、`/healthz` 反代到 `127.0.0.1:8787`，其余请求走静态资源 / SPA 回退。
- `enso-relay.service` 运行 `/opt/enso-relay/enso-relay`。
- 配对数据库：`/var/lib/enso-relay/relay.sqlite`。
- Caddy 配置：`/etc/caddy/Caddyfile`，同时承载另一个站点，不整体覆盖。

这台机器已经把 PWA 与 Go 二进制的 embed 资源分离。**更新 Web 无需重新编译 / 替换
Go 中继，也无需重启 Caddy 或 relay**；不能把通用 Go embed 更新说明机械套用到此站点。
操作前仍须重新读取实际路由和 service 定义，避免未来拓扑变化后照搬。

## 单独更新的流程

1. 以只读 SSH 核对站点目录、反代路径、服务 PID、健康检查和磁盘空间。
   记录 Caddy 配置、relay 二进制的 SHA-256，以及数据库文件 inode；不读取 / 输出配对内容。
2. 从当前授权的 Web 源码创建隔离快照，避免并行开发在构建中途改变产物。
   运行手机包 typecheck、Web 协议 / 缓存 / UI 回归及 `@enso/phone build`。
3. 给产物明确的 Web 部署 ID；`web-version.json` 只含版本、源码摘要、构建时间和入口资源，
   不含任何凭据。生成全部产物 SHA-256 清单和上传包 SHA-256。
4. 上传到 `/opt/enso-relay-web-releases/<web-deployment-id>/`，目录只准管理员访问。
   校验归档成员、路径、文件类型和全部 SHA-256；备份旧静态根到该目录的
   `previous-web.tar.gz`，同时保存 `baseline.json`。
5. 保留旧 `/assets/*` 哈希资源，让尚未刷新的旧标签页继续加载其分包。
   新资源先落盘，每个文件以同目录临时文件 + 原子 rename 替换；**最后替换 `index.html`**。
   同名哈希资源如果字节不同必须停止，不静默覆盖。
6. 任一步失败，在现有站点内恢复非哈希文件，旧资源不删除；部署后保存
   `deployment-receipt.json`，核对服务 PID、配置 / 二进制摘要和数据库身份未变。
7. 从公网重新下载入口 JS/CSS、index、Service Worker、manifest 与版本文件，比对本地产物
   SHA-256；确认入口 `no-cache`、哈希资源 `immutable`、`/healthz` 返回 `ok:true`。
8. 用浏览器打开实际站点，核对部署 ID、已有配对的连接状态、无静态加载失败。
   不为了验收发送用户消息、修改设置、重新配对或解绑。

CentOS 旧版 systemd 不支持 `systemctl show --value`；使用 `-p MainPID` 后解析 `MainPID=`。
macOS 上传归档要排除 `._*` AppleDouble 和 `.DS_Store`，只上传构建产物。

## 与桌面端的版本边界

Web 更新不等于桌面更新。下载和网页预览由桌面 `host-info` 声明能力；旧桌面不声明时，
新版 Web 隐藏相应按钮，已有聊天 / 配对仍可继续使用。桌面升级、安装、重启另行操作。
让用户普通刷新 / 重新打开 PWA 即可，不要求清浏览器数据，否则可能丢失配对凭据和离线队列。
