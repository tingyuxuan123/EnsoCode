# koffi.view 在 Electron 里直接 fatal

## 症状

- Windows computer use：`win.ax()` / `getState()` 报 `AX_WORKER_EXITED`（软失败后显示 `AX worker-exited`），截图正常。
- 同一份 UIA 代码在 vitest（纯 Node）里全绿，`node` 下用 `worker_threads` 跑构建产物也能返回节点。
- 改用进程内 `worker_threads` 兜底会导致整个应用崩溃。

## 根因

`koffi.view(ptr, len)` 把外部 native 内存包成 `ArrayBuffer`。Electron 开启了 V8 内存沙箱，
不允许外部内存 backing store，N-API 失败后 koffi 抛错走到
`FATAL ERROR: Error::New napi_get_last_error_info`，进程以 134 退出。
纯 Node 没有这层沙箱，所以单测和 Node 探针都测不出来。

触发点是 UIA `BoundingRectangle`（`VT_R8 | VT_ARRAY`）的 SafeArray 读取：几乎每个节点都会走到。

## 修法

不要用 `koffi.view` 读外部内存；按值拷贝：

```ts
koffi.decode(ptr, koffi.array('double', 4, 'Array')) as number[];
```

同理，任何会生成“外部内存 ArrayBuffer / Buffer”的 koffi / N-API 用法在 Electron 进程里都不可用。

AX 必须留在 `utilityProcess` 隔离；不要为了“能用”回退到 Main 内的 `worker_threads`，
koffi 原生崩溃会带走整个应用。

## 回归防线

- `winUiaNative.test.ts` 只证明纯 Node 下可用，**不覆盖**此问题。
- 真机验证：用 Electron `utilityProcess.fork(out/main/axWorkerThread-*.js, [], { stdio: 'pipe' })`
  发 `{ op: 'snapshot' }`，确认有返回、stderr 无 FATAL、进程不退出。
- `guest.ts` 把 `AX_WORKER_EXITED` 当软失败，`getState` 仍返回截图。

## 相关代码

- `src/main/services/computer/winUiaNative.ts`（`getBounds`）
- `src/main/services/computer/axWorkerThread.ts`、`axWorkerClient.ts`
- `src/main/services/computer/guest.ts`（`ax` 的错误分支）
