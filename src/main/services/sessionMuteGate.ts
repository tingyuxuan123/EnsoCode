import { isSessionMutedInStore, sessionMuteRoot } from '@shared/sessionMute';
import { readSettings } from '../ipc/settings';

/**
 * 本进程里比落盘更早的开关：renderer 切静音的瞬间就要生效，
 * 但 zustand persist 落盘是异步的，等 settings.json 会漏推。
 *
 * 键一律用权威根 id（见 sessionMuteRoot），不拿调用方传进来的
 * 子会话 id 里不可信的 `::` 前缀当父会话。重启后清空，回到 settings.json。
 */
const overrides = new Map<string, boolean>();

/** 上限只是兜底：本机主 UI 正常一屏会话远不到这个量；防的是任意 id 反复灌入。 */
const MAX_OVERRIDES = 1024;

export function setSessionMuteOverride(sessionId: string, muted: boolean): void {
  if (!sessionId) return;
  const root = sessionMuteRoot(readSettings(), sessionId);
  if (!root) return;
  overrides.set(root, muted);
  while (overrides.size > MAX_OVERRIDES) {
    const oldest = overrides.keys().next();
    if (oldest.done) break;
    overrides.delete(oldest.value);
  }
}

export function isSessionMuted(sessionId: string): boolean {
  if (!sessionId) return false;
  const settings = readSettings();
  const root = sessionMuteRoot(settings, sessionId);
  if (!root) return false;
  const persisted = isSessionMutedInStore(settings, sessionId);
  const override = overrides.get(root);
  if (override === undefined) return persisted;
  // 落盘值已经追上这条覆盖：覆盖使命结束，之后真正的持久化值说了算，
  // 避免多窗口 / 归档 / 外部改写被一条过期覆盖永久压住。
  if (override === persisted) {
    overrides.delete(root);
    return persisted;
  }
  return override;
}

/** 仅测试用：模拟进程重启。 */
export function resetSessionMuteOverrides(): void {
  overrides.clear();
}
