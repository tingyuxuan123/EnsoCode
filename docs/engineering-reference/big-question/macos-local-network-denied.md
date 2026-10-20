# 局域网地址全被内核瞬时拒绝，系统设置里「本地网络」却是开着的

## 症状

- 内置浏览器打开 `http://192.168.0.39:18080/` 报 `ERR_ADDRESS_UNREACHABLE (-109)`；
  agent 子进程 `nc 192.168.0.x` 任意端口都在 1ms 内 `No route to host`。
- 同时公网正常：`nc 180.101.49.44 80`、`curl https://www.baidu.com` 都能连上并完成 TLS。
- 网关 `route -n get 192.168.0.39` 正常（`en0`, on-link, `LLINFO`），
  但 `arp -an` 输出完全为空（路由缓存里的 ARP 是有的，被策略挡住的是查询/连接本身）。
- 系统设置 → 隐私与安全性 → 本地网络里 EnsoCode 的开关**是开的**，重启/重授权都不生效。

极易误判成后端没起、Vite proxy 配错、FlClash 分流规则或网卡路由问题。实测这些都不是：
同一台机上的微信开发者工具（独立签名、独立 TCC 记录）直连同一个 LAN 地址是通的。

## 根因

macOS 15+ 把「本地网络」纳入 TCC，判定依据是**发起连接的进程身份**，而不是访问的 IP。
先排除「机器级」原因：把同样的探测放进 `launchctl`（不挂在 EnsoCode 进程树下面），
网关照样通——所以局域网本身、路由、系统代理都是好的，被拒的是这个 app 的进程树：

```bash
launchctl submit -l probe -- /bin/sh -c 'nc -z -G2 -w3 192.168.0.1 80; echo rc=$?' >/tmp/p.out
cat /tmp/p.out   # Connection to 192.168.0.1 port 80 [tcp/http] succeeded!  rc=0
```

本机有两层同时不满足：

1. 打包产物的 `Info.plist` 没有 `NSLocalNetworkUsageDescription`
   （`electron-builder.yml` 的 `mac.extendInfo` 只声明了麦克风和 Apple Events）。
   缺这条不会弹授权框，直接按拒绝处理。
2. 装出来的 app **根本没有 bundle 签名**（不是"签名不对"，是从来没签过）：
   本地 `pnpm build:mac:dir` 时 `security find-identity -v -p codesigning`
   → `0 valid identities found`，electron-builder 直接跳过签名，产物只是
   "改过 Info.plist 的 Electron.app 拷贝"。

   ```text
   codesign -dvvv /Applications/EnsoCode.app
     Identifier=Electron          ← 主可执行文件出厂 linker-signed 残留
     Signature=adhoc
     Info.plist=not bound         ← Info.plist 未参与签名
     Sealed Resources=none
   ls /Applications/EnsoCode.app/Contents/_CodeSignature      → No such file
   ls ".../Electron Framework.framework/Versions/A/_CodeSignature" → No such file
   ```

   资源没被封存、Info.plist 不绑定，TCC 里那条「本地网络已允许」（绑定的是某个历史
   cdhash/身份）就对不上正在运行的实体：开关亮着，连接仍然被内核拒。
   `codesign -dvv` 里 `Info.plist=not bound` / `Sealed Resources=none` 是这条根因最简洁的判据。

   （`log show ... CONTAINS "LocalNetwork"` 只能看到 `found bundle id Electron by PID` 与
   `found bundle id com.j3n5en.enso-code by UUID` 成对出现——身份"找得到"，但授权核对
   失败。别拿这两行当"身份没问题"的证据。）

## 修法

两处配置（本次都已落到 `electron-builder.yml`）：

1. `mac.extendInfo` 声明 `NSLocalNetworkUsageDescription`。
2. `mac.identity: '-'` —— **关键**。不显式给 identity 时，没有证书就静默跳过签名；
   给了 `'-'` 才会走 ad-hoc 重签，把 Info.plist 绑定、资源封存、
   `Identifier` 变成 `com.j3n5en.enso-code`。正式发布用真 Developer ID 覆盖
   （`CSC_IDENTITY_AUTO_DISCOVERY` / CI 证书），不影响发布包。

实测 `pnpm build:mac:dir` 前后对比：

```text
签名前                                签名后
Identifier=Electron                   Identifier=com.j3n5en.enso-code
Info.plist=not bound                  Info.plist entries=34
Sealed Resources=none                 Sealed Resources version=2 rules=13 files=426
Contents/_CodeSignature 不存在        Contents/_CodeSignature/CodeResources 149.3K
codesign --verify --strict 失败       valid on disk / satisfies its Designated Requirement
```

electron-builder 同时补上了 `com.apple.security.cs.disable-library-validation`
（hardenedRuntime + ad-hoc 的必需项），否则包会启动即崩。

- 装好后需要让 TCC 重新问一次：`tccutil reset All com.j3n5en.enso-code`，
  再正常双击启动；ad-hoc 包每次重建 cdhash 都变，授权不跨重建保留，
  所以「本地 ad-hoc 构建 → 手动授予 → 长期使用」不可靠，稳定得用真证书。
- 结论未变之前，agent 侧只走 `127.0.0.1` / `localhost`：需要跨网段的服务，
  由用户在自己的 Terminal 起（Terminal 早已在 TCC 里有授权），agent 的浏览器/命令只连本机端口。

## 回归防线

改完签名/Info.plist 后按三步取证，三者缺一说明没修好：

```bash
/usr/libexec/PlistBuddy -c "Print :NSLocalNetworkUsageDescription" \
  /Applications/EnsoCode.app/Contents/Info.plist      # 有值
codesign -dvvv /Applications/EnsoCode.app 2>&1 | grep -E "^Identifier|Sealed"     # com.j3n5en.enso-code + 封存非 0
codesign --verify --deep --strict /Applications/EnsoCode.app                    # 通过
nc -z -G2 -w3 192.168.0.1 80                        # 网关可达即策略已放行
```

注意 `Signature=adhoc` 不是失败信号：`identity: '-'` 产物本来就 adhoc。
真正要看的 `Info.plist entries` 有值、`Sealed Resources files` 非 0、
`codesign --verify --deep --strict` 通过。

## 相关代码

- `electron-builder.yml`（`mac.identity`、`mac.extendInfo`、`mac.entitlements`）
- `scripts/after-pack.mjs`（打包后处理，签名前的位置）
