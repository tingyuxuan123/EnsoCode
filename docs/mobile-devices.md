# 桌面端移动设备

在本机 Code 会话中点标题栏的**手机图标**，或在右侧面板点 **＋ → 移动设备**。从设备列表点**启动**，CodeKiln 在后台启动模拟器，等同一台设备就绪后自动切到应用内手机画面，不另开原生模拟器窗口。已经在外部运行的设备可以直接选中；CodeKiln 不会接管或关闭它原有的窗口。

## 准备设备

| 目标 | 怎么准备 | 面板能做什么 |
| --- | --- | --- |
| Android 模拟器 | 在 Android Studio 中安装 SDK Platform-Tools、Emulator 和系统镜像，并先创建 AVD | 列出关机的 AVD，启动、停止；运行后看屏、截图、点击、滑动、输入、Home、返回 |
| Android 真机 | 打开开发者选项和 USB 调试，连接后在手机上确认信任本机。`adb devices -l` 应显示 `device` 而不是 `unauthorized` | 与运行中的 AVD 相同，但没有电源操作。文字输入受系统 `adb input text` 支持的字符集限制 |
| iOS 模拟器（macOS） | 打开完整版 Xcode，完成首次设置并安装 iOS 模拟器运行时。`xcrun simctl list devices` 应列出模拟器 | 只用 Xcode 即可发现、启停模拟器和看屏；触控还需要下面的 Appium |
| iPhone（macOS） | 连接并信任 Mac，启用开发者模式，确保 `xcrun devicectl list devices` 可以看到手机 | 看屏与输入均需 Appium；不能从面板关闭真机，iOS 也没有系统级返回键 |

**iOS 输入**使用本机 Appium 的 XCUITest 驱动。请参照[驱动官方安装指南](https://appium.github.io/appium-xcuitest-driver/latest/installation/)配置驱动和 WebDriverAgent；真机还需完成签名与信任。把服务绑定在 `127.0.0.1:4723`（例如 `appium --address 127.0.0.1 --port 4723`），不要向局域网开放。CodeKiln 不安装 SDK、接受许可、代做签名或启动 Appium。

## 看屏和授权

1. 手机画面用满设备面板；上方 **＋** 可以切换设备并查看配置，底部提供当前设备支持的导航键。Android 还支持最近任务、电源和音量键。点击和拖动作用于实际画面；点键盘按钮可向设备当前获得焦点的输入框发送文字。
2. 上方可以保存截图，也可录制最多 60 秒的本地 WebM（仅设备画面，无声音）。画面仍由截图刷新，Android 目标约 2.5 帧/秒，iOS 约 1 帧/秒；录制同样受这个帧率限制。单纯打开面板或录制不会把截图发送给模型。
3. 要让当前本地会话的 AI 操作设备，先阅读截图去向说明，确认后主动授权，然后在聊天中提出操作。授权只对这一个会话和选中的设备有效，不授予任意命令、安装应用或真机电源控制。
4. 随时收回权限或关闭设备面板。已经发送给模型的图片不能撤回；请勿在敏感画面上授权。临时离开预览不等于关机，要停止模拟器请使用明确的停止操作。

如果本机默认 ADB 服务来自其他应用，且无法授权某台 Android 模拟器，CodeKiln 会尝试用 SDK 的 ADB 在独立的环回端口连接该模拟器。不会停止默认 ADB 服务、放宽设备认证或由独立服务连接 USB 真机。

重启后若提示「请选择本地根会话」，在左侧重新点选该本地会话，再授权。SSH 会话和子代理不能获得此设备权限。

这个面板独立使用 Android SDK、Xcode 命令行工具和本机 Appium 协议实现；不依赖 Kettu 或其界面组件。

开发时 `pnpm dev` 会先准备 `out/helpers`；执行 `pnpm build` 时则在 Vite 输出完成后通过
`postbuild` 自动准备同一目录，避免构建清理误删 helper。发布工作流会在各目标系统打包前重新
准备资源，macOS 的 arm64/x64 包会分别构建对应架构的两个 iOS helper。完整许可文本随 helper
目录一起分发。
