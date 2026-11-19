import { IPC_CHANNELS } from '@shared/types';
import { type IpcMainEvent, ipcMain } from 'electron';
import { deviceHost } from '../services/deviceHost';
import {
  answerDeviceAccess,
  forgetDeviceAccess,
  listAllowedDeviceAccess,
  listDeviceAccess,
  revokeDeviceAccess,
} from '../services/deviceTools';
import { isMainWebContents } from '../windows/MainWindow';

// A device-host port gives direct access to device controls. Trust the workbench frame,
// not just its webContents: embedded pages can share the latter.
function isDeviceSender(event: Pick<IpcMainEvent, 'sender' | 'senderFrame'>): boolean {
  return (
    isMainWebContents(event.sender.id) &&
    !!event.senderFrame &&
    event.senderFrame === event.sender.mainFrame
  );
}

/** Renderer asks for its device-host port; the host starts on the first request. */
export function registerDeviceHostHandlers(): void {
  ipcMain.on('device-host:connect', (event: IpcMainEvent) => {
    if (isDeviceSender(event)) deviceHost.connect(event.sender);
  });
}

const validId = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= 256;

export function registerDeviceAccessHandlers(
  localSession: (id: string) => boolean,
  liveSession: (id: string) => boolean
): void {
  ipcMain.handle(IPC_CHANNELS.DEVICE_ACCESS_LIST, (event, id: unknown) =>
    isDeviceSender(event) && validId(id) && localSession(id) ? listDeviceAccess(id) : []
  );
  ipcMain.handle(
    IPC_CHANNELS.DEVICE_ACCESS_ANSWER,
    (event, id: unknown, entry: unknown, decision: unknown) => {
      if (
        isDeviceSender(event) &&
        validId(id) &&
        validId(entry) &&
        liveSession(id) &&
        (decision === 'session' || decision === 'always' || decision === 'deny')
      ) {
        answerDeviceAccess(id, entry, decision);
      }
    }
  );
  ipcMain.handle(IPC_CHANNELS.DEVICE_ACCESS_REVOKE, (event, id: unknown, device: unknown) => {
    if (isDeviceSender(event) && validId(id) && validId(device) && localSession(id))
      revokeDeviceAccess(id, device);
  });
  ipcMain.handle(IPC_CHANNELS.DEVICE_ACCESS_ALLOWED, (event) =>
    isDeviceSender(event) ? listAllowedDeviceAccess() : []
  );
  ipcMain.handle(IPC_CHANNELS.DEVICE_ACCESS_FORGET, (event, device: unknown) => {
    if (isDeviceSender(event) && validId(device)) forgetDeviceAccess(device);
  });
}
