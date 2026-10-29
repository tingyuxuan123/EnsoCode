import path from 'node:path';
import type {
  CompactReserveTokensReadResult,
  CompactReserveTokensResult,
} from '@shared/compactionSettings';
import { IPC_CHANNELS } from '@shared/types';
import { app, ipcMain } from 'electron';
import {
  readCompactReserveTokens,
  writeCompactReserveTokens,
} from '../services/piCompactionSettings';
import { isMainWebContents } from '../windows/MainWindow';
import { isSettingsWebContents } from '../windows/SettingsWindow';

/** 路径由 Main 推导，Renderer 只能传数值，不能访问用户的 ~/.pi 或任意配置文件。 */
const settingsPath = () => path.join(app.getPath('userData'), 'agent', 'pi-agent', 'settings.json');
const authorized = (senderId: number) =>
  isMainWebContents(senderId) || isSettingsWebContents(senderId);

export function registerCompactionHandlers(): void {
  ipcMain.handle(
    IPC_CHANNELS.COMPACTION_RESERVE_TOKENS_GET,
    async (event): Promise<CompactReserveTokensReadResult> =>
      authorized(event.sender.id)
        ? readCompactReserveTokens(settingsPath())
        : { ok: false, error: 'forbidden' }
  );
  ipcMain.handle(
    IPC_CHANNELS.COMPACTION_RESERVE_TOKENS_SET,
    async (event, value: unknown): Promise<CompactReserveTokensResult> =>
      authorized(event.sender.id)
        ? writeCompactReserveTokens(settingsPath(), value)
        : { ok: false, error: 'forbidden' }
  );
}
