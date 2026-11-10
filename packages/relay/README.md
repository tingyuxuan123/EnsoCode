# 小满 relay

<p align="right"><a href="README.zh-CN.md">简体中文</a></p>

Pairing and ciphertext forwarding for the phone companion and remote nodes. The relay **forwards ciphertext only** and cannot read chats.

Public default: `https://enso-relay.j3.do` (Cloudflare Worker). You can self-host.

After self-hosting, set **Settings → Devices → Relay URL** on the desktop. Both ends must use the same relay.

| | Cloudflare Worker (recommended) | Go binary |
| --- | --- | --- |
| Best for | Custom domain, global edge | Your own machine / NAS / VPS |
| Dependencies | Node, Wrangler, CF account | None (one file) |
| Data | Durable Object (SQLite) | `relay.sqlite` next to the binary |
| Phone PWA | Static assets on the same Worker origin | Embedded; open the relay origin |

The protocol is compatible; clients do not need changes. Go runbook: [`../relay-go/README.md`](../relay-go/README.md).

---

## Option 1: Cloudflare Worker (recommended)

Source is this directory. Production host: `enso-relay.j3.do`.

```bash
pnpm install
pnpm --filter @enso/relay release          # production
pnpm --filter @enso/relay release:dev      # dev copy enso-relay-dev.j3.do
```

Needs `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. Custom domain is `routes` in `wrangler.jsonc`.

`pnpm --filter @enso/relay dev` builds the phone PWA then runs `wrangler dev`.

Pushes to `dev` that touch `packages/relay`, `packages/phone`, or `packages/pair` deploy the production Worker via `.github/workflows/deploy-relay.yml`.

---

## Option 2: Go binary

For a machine without Cloudflare. Binaries are attached to the upstream [GitHub Releases](https://github.com/J3n5en/EnsoCode/releases/latest):

- `enso-relay-linux-amd64` (x86_64)
- `enso-relay-linux-arm64` (aarch64)

```bash
chmod +x enso-relay-linux-amd64
./enso-relay-linux-amd64
```

No config. Listens on `:8787` by default, creates SQLite beside the executable, PWA is embedded.

Point the desktop relay URL at:

- Same machine: `http://127.0.0.1:8787`
- LAN: `http://<lan-ip>:8787` (printed at startup)
- Public internet: HTTPS, e.g. `https://relay.example.com`

Open the same URL in a phone browser to scan and pair.

Optional flags / env: `--listen`, `--db`, `--tls-cert`, `--tls-key` (`RELAY_LISTEN` / `RELAY_DB` / `RELAY_TLS_CERT` / `RELAY_TLS_KEY`). Release builds self-update on a timer; see [`../relay-go/README.md`](../relay-go/README.md#auto-update).

### Public HTTPS

Phones need HTTPS on the public internet. LAN HTTP is fine.

**Caddy** (auto certs, WebSocket works as-is):

```caddy
relay.example.com {
    reverse_proxy 127.0.0.1:8787
}
```

**Nginx** (WebSocket upgrade + long timeouts for the pairing socket):

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

**No reverse proxy** — terminate TLS on the binary. You bring the cert (certbot, existing files, etc.); the process does not renew it.

```bash
./enso-relay \
  --listen :443 \
  --tls-cert /etc/letsencrypt/live/relay.example.com/fullchain.pem \
  --tls-key  /etc/letsencrypt/live/relay.example.com/privkey.pem
```

Binding `:443` needs root or `cap_net_bind_service`. After certbot renew, restart the process (or use a deploy hook). HTTP-01 still needs port 80; without a proxy use DNS-01 or run certbot standalone once before starting the relay.

Desktop relay URL: `https://relay.example.com`.

---

## Protocol

Clients only need these endpoints (Go and CF match):

- `POST /v1/pair/request` `{ publicKey }`
- `POST /v1/pair/claim` `{ publicKey, boxedKey, deviceName? }`
- `WS /v1/pair/:id?role=host|guest&token=`
- `DELETE /v1/pair/:id?token=`

Text `ping` → `pong` (not forwarded). Business frames are forwarded only, 1MB max. Invalid tokens upgrade the WebSocket then close with `1008 revoked`.
