# Android 模拟器在运行，设备面板却一直等开机

## 症状

打开 AVD 到最后超时，列表同时出现「关机」的 AVD 名称和「未授权」的 `emulator-5554`。实际排查中 QEMU 已在运行，`adb devices -l` 返回 `unauthorized`，而 `adb -s emulator-5554 emu avd name` 仍能返回该 AVD 的名称。CodeKiln 的会话授权和 Android 的 ADB 授权是两件事。

## 根因

旧发现逻辑只能通过已授权的 Android shell 读取 AVD 名称，因而把运行中的未授权实例和已安装的 AVD 重复列出。旧启动逻辑只等任意新出现的 `device` serial；目标一直未授权便得等到总超时，另一个 AVD 同时启动时还可能取错 serial。关闭窗口中的设备标签也没有取消正在运行的启动操作，后者可能在关掉后重新占用设备。

## 修法

未授权或还没准备好的模拟器用本机 emulator console 识别 AVD；启动时按 AVD 名称匹配 serial。若目标持续未授权，提前提示从 Android Studio 冷启动并人工确认 USB 调试，不自动批准；失败或取消只停止本次启动的子进程，初次打开失败释放设备占用。

## 回归防线

测试覆盖未授权条目去重、并发启动时不认错 AVD、未授权和进程退出提前返回，以及失败或关闭标签后不留下设备占用。

## 相关代码

- [Android 设备发现](../../../src/device-host/discovery.ts)
- [Android 启动与发现回归测试](../../../src/device-host/android.test.ts)
- [设备主机占用回归测试](../../../src/device-host/host.test.ts)
