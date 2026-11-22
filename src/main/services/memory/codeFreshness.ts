import { execFileSync } from 'node:child_process';

/**
 * 仓库最近一次提交时间。只看一个时间点，不看 diff：
 * 目的是回答“记忆比代码旧吗”，而不是猜代码改了什么。
 * 任何失败（不是 git 仓库、没有 git、超时）都返回 null，绝不阻塞会话启动。
 */
export function readLatestCommitIso(cwd: string, timeoutMs = 1500): string | null {
  const dir = cwd?.trim();
  if (!dir) return null;
  try {
    const out = execFileSync('git', ['-C', dir, 'log', '-1', '--format=%cI'], {
      encoding: 'utf8',
      timeout: timeoutMs,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return out || null;
  } catch {
    return null;
  }
}
