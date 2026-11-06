import type { BrowserWindow } from 'electron';
import { createAppWindow } from './createAppWindow';

/** sessionId（根会话）→ 独立设计窗口。每个会话最多一个，可同时开多个会话。 */
const windows = new Map<string, BrowserWindow>();
const listeners = new Set<(sessions: string[]) => void>();
const CASCADE_PX = 28;

function notify(): void {
  const sessions = designWindowSessions();
  for (const listener of listeners) listener(sessions);
}

/** 已存在则聚焦；会话合法性由调用方（IPC）先按 Main 权威记录校验。 */
export function openDesignWindow(sessionId: string): BrowserWindow {
  const existing = windows.get(sessionId);
  if (existing && !existing.isDestroyed()) {
    if (existing.isMinimized()) existing.restore();
    existing.show();
    existing.focus();
    return existing;
  }
  const others = [...windows.values()].filter((win) => !win.isDestroyed()).length;
  const win = createAppWindow({
    entry: 'design',
    width: 1280,
    height: 860,
    minWidth: 720,
    minHeight: 520,
    stateFile: 'design-window-state.json',
  });
  if (others > 0) {
    const [x, y] = win.getPosition();
    win.setPosition(x + CASCADE_PX * others, y + CASCADE_PX * others);
  }
  // 该 renderer 持有设计服务权限：主 frame 不得被导航成别的文档而保留同一 webContents。
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.webContents.on('will-redirect', (event) => event.preventDefault());
  windows.set(sessionId, win);
  win.on('closed', () => {
    if (windows.get(sessionId) === win) windows.delete(sessionId);
    notify();
  });
  notify();
  return win;
}

/** 该 webContents 是否为独立设计窗口；是则返回它绑定的根会话。 */
export function designWindowSession(webContentsId: number): string | null {
  for (const [sessionId, win] of windows) {
    if (win.isDestroyed() || win.webContents.isDestroyed()) continue;
    if (win.webContents.id === webContentsId) return sessionId;
  }
  return null;
}

export function designWindowFor(sessionId: string): BrowserWindow | null {
  const win = windows.get(sessionId);
  return win && !win.isDestroyed() ? win : null;
}

export function designWindowSessions(): string[] {
  return [...windows.entries()]
    .filter(([, win]) => !win.isDestroyed())
    .map(([sessionId]) => sessionId)
    .sort();
}

export function onDesignWindowsChanged(listener: (sessions: string[]) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** 进托盘时一并关闭：主窗口销毁后设计窗口既收不到会话状态，也无法派活。 */
export function closeAllDesignWindows(): void {
  for (const win of [...windows.values()]) if (!win.isDestroyed()) win.close();
}
