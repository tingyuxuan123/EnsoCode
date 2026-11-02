import { IPC_CHANNELS } from '@shared/types';
import { ipcMain } from 'electron';
import { computerHost } from '../services/computerHost';
import { isMainWebContents } from '../windows/MainWindow';
import { isSettingsWebContents } from '../windows/SettingsWindow';

const MAX_APP_KEY_CHARS = 8192;
function trusted(senderId: number): boolean {
  return isMainWebContents(senderId) || isSettingsWebContents(senderId);
}

export function registerComputerHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.COMPUTER_CAPABILITIES, async () => {
    try {
      return { ok: true as const, capabilities: await computerHost.capabilities() };
    } catch (error) {
      return {
        ok: false as const,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
  ipcMain.handle(IPC_CHANNELS.COMPUTER_OPEN_PERMISSIONS, (_event, kind: unknown) => {
    if (kind !== 'screen' && kind !== 'accessibility') {
      return { ok: false as const, error: 'Invalid permission kind' };
    }
    return computerHost.openPermissionSettings(kind);
  });
  ipcMain.handle(IPC_CHANNELS.COMPUTER_ALLOWED_APPS, (event) => {
    if (!trusted(event.sender.id)) return [];
    try {
      return computerHost.allowedApps();
    } catch {
      return [];
    }
  });
  ipcMain.handle(IPC_CHANNELS.COMPUTER_REVOKE_APP, (event, key: unknown) => {
    if (
      !trusted(event.sender.id) ||
      typeof key !== 'string' ||
      !key ||
      key.length > MAX_APP_KEY_CHARS
    )
      return { ok: false };
    try {
      return { ok: computerHost.revokeApp(key) };
    } catch {
      return { ok: false };
    }
  });
}
