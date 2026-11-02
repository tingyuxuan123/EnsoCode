# EnsoCode 中继

<p align="right"><a href="README.md">English</a></p>

手机伴侣 / 远程节点的配对与密文转发服务。中继**只转发密文**，不能解密聊天。

默认公共实例：`https://enso-relay.j3.do`（Cloudflare Worker）。也可以自建。

自建后，在桌面端 **设置 → 设备 → 中继地址** 填你的 URL。两端必须指向同一中继。

已部署为「Caddy 静态 PWA + 独立 Go relay」的站点可仅更新 Web，不替换中继二进制；
具体核验与回滚流程见 [Web 单独更新](../../docs/engineering-reference/guides/relay-web-deploy.md)。

| | Cloudflare Worker（推荐） | Go 单二进制 |
| --- | --- | --- |
| 适合 | 自定义域、全球边缘 | 自己的机器 / NAS / VPS |
| 依赖 | Node、Wrangler、CF 账号 | 无（一个文件） |
| 数据 | Durable Object（SQLite） | 旁边的 `relay.sqlite` |
| 手机 PWA | 与 Worker 同域静态资源 | 已内嵌，打开中继根地址即可 |

协议兼容，客户端不用改。更细的 Go 运行说明见 [`../relay-go/README.zh-CN.md`](../relay-go/README.zh-CN.md)。

---

## 方式一：Cloudflare Worker（推荐）

源码在本目录，生产域名 `enso-relay.j3.do`。

```bash
pnpm install
pnpm --filter @enso/relay release          # 生产
pnpm --filter @enso/relay release:dev      # 开发副本 enso-relay-dev.j3.do
```

需要 `CLOUDFLARE_API_TOKEN` 与 `CLOUDFLARE_ACCOUNT_ID`。自定义域写在 `wrangler.jsonc` 的 `routes`。

`pnpm --filter @enso/relay dev` 会先构建手机 PWA 再 `wrangler dev`。

推送到 `dev` 且改动 `packages/relay`、`packages/phone` 或 `packages/pair` 时，`.github/workflows/deploy-relay.yml` 会自动部署生产 Worker。

---

## 方式二：Go 单二进制

适合没有 Cloudflare 的机器。中继二进制随应用 [GitHub Release](https://github.com/J3n5en/EnsoCode/releases/latest) 一起发布：

- `enso-relay-linux-amd64`（x86_64）
- `enso-relay-linux-arm64`（aarch64）

```bash
chmod +x enso-relay-linux-amd64
./enso-relay-linux-amd64
```

无需配置。默认监听 `:8787`，SQLite 建在可执行文件旁边，PWA 已打进二进制。

把桌面中继地址设为：

- 同一台机器：`http://127.0.0.1:8787`
- 局域网：`http://<局域网IP>:8787`（启动日志会打印）
- 公网：必须 HTTPS，例如 `https://relay.example.com`

手机浏览器打开同一个地址即可扫码配对。

可选环境变量 / 参数：`--listen`、`--db`、`--tls-cert`、`--tls-key`（`RELAY_LISTEN` / `RELAY_DB` / `RELAY_TLS_CERT` / `RELAY_TLS_KEY`）。Release 构建默认会定期自更新，见 [`../relay-go/README.zh-CN.md`](../relay-go/README.zh-CN.md#自动更新)。

### 公网 HTTPS

公网手机端需要 HTTPS。局域网用 HTTP 即可。

**Caddy**（自动签证书，WebSocket 不用额外配置）：

```caddy
relay.example.com {
    reverse_proxy 127.0.0.1:8787
}
```

**Nginx**（WebSocket 升级 + 长超时，配对连接会一直开着）：

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 443 ssl http2;
    server_name relay.example.com;
    ssl_certificate     /etc/letsencrypt/live/relay.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/relay.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_read_timeout 7d;
        proxy_send_timeout 7d;
    }
}
```

**不反代** — 证书交给进程自己终止 TLS。证书自己准备（certbot、已有文件等），进程不会续期。

```bash
./enso-relay \
  --listen :443 \
  --tls-cert /etc/letsencrypt/live/relay.example.com/fullchain.pem \
  --tls-key  /etc/letsencrypt/live/relay.example.com/privkey.pem
```

监听 `:443` 需要 root 或 `cap_net_bind_service`。certbot 续期后重启进程（或写 deploy hook）。HTTP-01 仍要占用 80 端口；没有反代时用 DNS-01，或先 `certbot standalone` 签好再启动中继。

桌面中继地址填 `https://relay.example.com`。

---

## 从 Web 取回修改后的文件

需要同时更新桌面端和中继站点上的手机 PWA；仅配置中继地址不会自动同步电脑文件。
Cloudflare 部署会构建 PWA；Go 中继需更新包含新版 PWA 的二进制，源码构建前运行
`packages/relay-go/sync-frontend.sh`。更新后重新打开或刷新 Web 页面。

- **Code 会话**：点顶栏的「下载会话文件」图标，刷新文件列表。
- **Bot 私聊 / 群聊**：点回复下方产物卡片旁的「下载文件」。
- 选择文件点「取回」，完成后点「保存 文件名」，交给浏览器下载。

文件必须在该会话的本地工作区内，并被助手生成、修改或在回复里提及；未列出时可让助手
把结果保存到项目目录并写出文件名。暂不支持 SSH 工作区，单文件最多 50 MiB。
下载使用现有端到端加密连接（直连或中继），每块 384 KiB，不新增公开文件 URL，
也不把文件保存在中继服务器上。电脑必须保持 EnsoCode 运行并在线。

---

## 协议摘要

### 网页在线预览

需要同时更新桌面端和中继站点 PWA。
Code 会话点顶栏「网页预览」；Bot 私聊 / 群聊点回复下方「网页预览」。

- **HTML**：助手保存到项目目录，并在回复中写出文件名；根目录和 `dist/index.html` 也会作为候选。
- **React / Vue / Vite**：让助手启动开发服务，并回复 `http://localhost:端口/` 地址；刷新候选列表后点选「开发服务」。无需端口映射，不用在手机打开原始 localhost 链接。
- 可选择手机 / 桌面画布尺寸，点击画面、滑动滚动；先点网页输入框，再用下方文字框输入。
  支持刷新网页及可选「自动更新」。

页面在电脑侧隔离浏览器中渲染，画面通过现有端到端加密连接传回 Web；生成的 HTML/JS
不在保存配对凭据的聊天页面同源执行，不新增公开网页地址。

首版限制：电脑须在线；不自动安装依赖、运行构建或启动开发服务；不支持 SSH 项目、
外部 CDN / API / 其他本地端口、弹窗、文件上传、下载、嵌套页面和浏览器权限。
依赖资源须在项目内或由选中的开发服务同源提供。预览非视频级投屏；只读设备不能点击或输入。
每台已配对设备限一个预览，整台电脑最多两个。

### 中继接口

客户端只依赖这些接口（Go / CF 行为一致）：

- `POST /v1/pair/request` `{ publicKey }`
- `POST /v1/pair/claim` `{ publicKey, boxedKey, deviceName? }`
- `WS /v1/pair/:id?role=host|guest&token=`
- `DELETE /v1/pair/:id?token=`

文本 `ping` → `pong`（不转发给对端）。业务帧只转发、上限 1MB。无效 token 先升级 WebSocket 再以 `1008 revoked` 关闭。
