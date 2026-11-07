# Windows 后台 PowerShell 空跑却返回成功

## 症状

本机 `powershell` 工具带 `background:true` 时立即报 `exit 0`、没有输出，约定写入的文件也不存在。同一命令前台执行有输出、文件正常生成。仅断言任务完成状态会误以为执行成功。

## 根因

Windows 上以 `spawn(powershell.exe, [...args, command], { detached: true })` 启动系统 PowerShell，在实测环境中可静默退出，不执行 `-Command`。对照实验分别用 `stdin: pipe` 和 `ignore` 都复现；只改 `detached:false` 即恢复。

## 修法

Windows 后台任务不创建 detached 控制台，继续由现有 `taskkill /T /F` 清理进程树。POSIX 仍用 detached 创建进程组，以便向整组发送终止信号。不更改 Shell 配置选择或 SSH 语义。

## 回归防线

Windows 真进程测试同时检查 stdout/stderr、日志和写入副作用，另测试停止时根、子和孙进程均退出。升级 Node/Electron/命令工具时不能以退出码替代执行证据。

## 相关代码

- [`backgroundTasks.ts`](../../../src/agent/backgroundTasks.ts)
- [`backgroundTasks.test.ts`](../../../src/agent/backgroundTasks.test.ts)
