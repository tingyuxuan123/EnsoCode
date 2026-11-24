import { IPC_CHANNELS } from '@shared/types';
import { ipcMain } from 'electron';
import {
  cancelChatModelDownload,
  deleteChatModel,
  listChatModels,
  setChatModelProgressSink,
  startChatModelDownload,
} from '../services/chatModels';
import { sendToAllWindows } from '../windows/createAppWindow';
import { isMainWebContents } from '../windows/MainWindow';
import { isSettingsWebContents } from '../windows/SettingsWindow';

function isTrustedWindow(id: number): boolean {
  return isMainWebContents(id) || isSettingsWebContents(id);
}

export function registerLocalModelHandlers(): void {
  setChatModelProgressSink((progress) =>
    sendToAllWindows(IPC_CHANNELS.LOCAL_MODELS_PROGRESS, progress)
  );
  ipcMain.handle(IPC_CHANNELS.LOCAL_MODELS_LIST, (event) =>
    isTrustedWindow(event.sender.id) ? listChatModels() : []
  );
  for (const [channel, action] of [
    [IPC_CHANNELS.LOCAL_MODELS_DOWNLOAD, startChatModelDownload],
    [IPC_CHANNELS.LOCAL_MODELS_CANCEL, cancelChatModelDownload],
    [IPC_CHANNELS.LOCAL_MODELS_DELETE, deleteChatModel],
  ] as const) {
    ipcMain.handle(channel, (event, id: unknown) =>
      isTrustedWindow(event.sender.id) && typeof id === 'string' && id.length > 0
        ? action(id)
        : false
    );
  }
}
