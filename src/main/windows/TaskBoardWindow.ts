import type { BrowserWindow } from 'electron';
import { createAppWindow } from './createAppWindow';

let taskBoardWindow: BrowserWindow | null = null;

/** 看板不取代工作区：独立单例窗口，几何状态与设置分开持久化。 */
export function openTaskBoardWindow(): BrowserWindow {
  if (taskBoardWindow && !taskBoardWindow.isDestroyed()) {
    if (taskBoardWindow.isMinimized()) taskBoardWindow.restore();
    taskBoardWindow.show();
    taskBoardWindow.focus();
    return taskBoardWindow;
  }
  const win = createAppWindow({
    entry: 'taskboard',
    width: 1320,
    height: 850,
    minWidth: 900,
    minHeight: 600,
    stateFile: 'taskboard-window-state.json',
  });
  // This renderer has task-write privileges. In-page navigation must never replace it
  // with an external document retaining the same webContents identity and preload.
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.webContents.on('will-redirect', (event) => event.preventDefault());
  taskBoardWindow = win;
  win.on('closed', () => {
    if (taskBoardWindow === win) taskBoardWindow = null;
  });
  return win;
}

export function isTaskBoardWebContents(webContentsId: number): boolean {
  return Boolean(
    taskBoardWindow &&
      !taskBoardWindow.isDestroyed() &&
      !taskBoardWindow.webContents.isDestroyed() &&
      taskBoardWindow.webContents.id === webContentsId
  );
}
