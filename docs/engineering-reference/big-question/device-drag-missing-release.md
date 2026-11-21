# 设备画面停在半屏，松开鼠标后仍跟着指针拖动

## 症状

CodeKiln 的 Pixel 10 Pro 模拟器面板横向拖动后一直停在过渡中间。松开鼠标再移回面板，不按键移动也会推动画面。它和动画掉帧、应用冷启动慢是不同的问题。

## 根因

复现时，用 `adb exec-out screencap -p` 取到的设备原始画面也停在半屏；`adb shell dumpsys input` 的 `TouchStatesByDisplay` 仍有 `touchingPointers=[Pointer(id=0, FINGER)]`，输入队列已经为空。这说明 Android 仍认为触点按下，不是面板只显示了旧帧。

原先画布只靠 `pointerup` / `pointercancel` 结束手势。旧代码漏掉结束事件后，只按 `pointerId` 处理移动，即使鼠标主键已经松开，仍会发送触控移动。实际触发时哪一层漏发了结束事件未被捕获；测试复现的是画布收到后续无按键移动时的处理缺口。

## 修法

画布在失去指针捕获、窗口失焦、卸载或收到不再按住主键的鼠标移动时，在最后有效位置发送抬手，并立即清空活跃指针。正常 `pointerup` 沿用实际抬起位置；随后到达的捕获丢失不会重复抬手。无需改视频参数或触控协议。

## 回归防线

测试实际从画布发出的 `devices.input` 序列：无按键移动不再变成拖动、丢失捕获时释放双指、窗口失焦立即释放、正常抬手不会重复发送。

## 相关代码

- [设备屏幕](../../../src/renderer/features/devices/device-screen.tsx)
- [设备屏幕回归测试](../../../src/renderer/features/devices/device-screen.test.tsx)
