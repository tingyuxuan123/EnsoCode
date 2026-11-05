import { IPC_CHANNELS } from '@shared/types';
import { isBotId } from '@shared/types/bot';
import type { TaskBoardNavigation, TaskBoardWindowResult } from '@shared/types/taskBoard';
import { ipcMain } from 'electron';
import { sendToWindow } from '../windows/createAppWindow';
import { focusMainWindow, isMainWebContents } from '../windows/MainWindow';
import { isTaskBoardWebContents, openTaskBoardWindow } from '../windows/TaskBoardWindow';
import { getBotServices } from './bots';

const FORBIDDEN = { ok: false, error: 'forbidden' } as const;
const INVALID = { ok: false, error: 'invalid' } as const;

function parseNavigation(raw: unknown): TaskBoardNavigation | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (!('kind' in raw) || !('chatId' in raw) || !isBotId(raw.chatId)) return null;
  const keys = Object.keys(raw);
  if (raw.kind === 'group' && keys.every((key) => key === 'kind' || key === 'chatId'))
    return { kind: 'group', chatId: raw.chatId };
  if (
    raw.kind === 'task' &&
    'taskId' in raw &&
    isBotId(raw.taskId) &&
    keys.every((key) => key === 'kind' || key === 'chatId' || key === 'taskId')
  )
    return { kind: 'task', chatId: raw.chatId, taskId: raw.taskId };
  return null;
}

function resolveNavigation(
  services: NonNullable<ReturnType<typeof getBotServices>>,
  target: TaskBoardNavigation
): TaskBoardNavigation | null {
  const chat = services.chats.get(target.chatId);
  if (chat?.kind !== 'group') return null;
  const root = chat.parentId ? services.chats.get(chat.parentId) : chat;
  if (root?.kind !== 'group' || root.parentId) return null;
  if (target.kind === 'group') return { kind: 'group', chatId: root.id };
  return services.tasks.list(root.id).some((task) => task.id === target.taskId)
    ? { kind: 'task', chatId: root.id, taskId: target.taskId }
    : null;
}

export function registerTaskBoardHandlers(): void {
  let pending: TaskBoardNavigation | null = null;
  const safely = (action: () => void): TaskBoardWindowResult => {
    try {
      action();
      return { ok: true };
    } catch {
      return { ok: false, error: 'unavailable' };
    }
  };

  ipcMain.handle(IPC_CHANNELS.TASK_BOARD_OPEN, (event): TaskBoardWindowResult => {
    if (!isMainWebContents(event.sender.id)) return FORBIDDEN;
    return safely(() => openTaskBoardWindow());
  });
  ipcMain.handle(IPC_CHANNELS.TASK_BOARD_FOCUS_MAIN, (event): TaskBoardWindowResult => {
    if (!isTaskBoardWebContents(event.sender.id)) return FORBIDDEN;
    return safely(() => focusMainWindow());
  });
  ipcMain.handle(IPC_CHANNELS.TASK_BOARD_NAVIGATE, (event, raw: unknown): TaskBoardWindowResult => {
    if (!isTaskBoardWebContents(event.sender.id)) return FORBIDDEN;
    const input = parseNavigation(raw);
    if (!input) return INVALID;
    try {
      const services = getBotServices();
      if (!services) return { ok: false, error: 'disabled' };
      const target = resolveNavigation(services, input);
      if (!target) return INVALID;
      // Queue before focus: focusMainWindow may create a cold main workbench.
      pending = target;
      const win = focusMainWindow();
      sendToWindow(win, IPC_CHANNELS.TASK_BOARD_NAVIGATION);
      return { ok: true };
    } catch {
      // A failed navigation is not deferred: the user can explicitly retry it.
      pending = null;
      return { ok: false, error: 'unavailable' };
    }
  });
  ipcMain.handle(
    IPC_CHANNELS.TASK_BOARD_NAVIGATION_CONSUME,
    (event): TaskBoardNavigation | null => {
      if (!isMainWebContents(event.sender.id)) return null;
      const target = pending;
      pending = null;
      try {
        const services = target ? getBotServices() : null;
        return target && services ? resolveNavigation(services, target) : null;
      } catch {
        return null;
      }
    }
  );
}
