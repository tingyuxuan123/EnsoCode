import { ipcRenderer } from 'electron';
import type { ClientPort, PortTransport } from './port-client';

/** The IPC side of a host port: `<channel>:connect`, `<channel>:port` and `<channel>:reset`. */
export function hostTransport(channel: 'device-host'): PortTransport {
  return {
    requestPort: () => ipcRenderer.send(`${channel}:connect`),
    onPort: (listener) => {
      ipcRenderer.on(`${channel}:port`, (event) => {
        const [port] = event.ports as unknown as ClientPort[];
        if (port) listener(port);
      });
    },
    onReset: (listener) => {
      ipcRenderer.on(`${channel}:reset`, (_, event: { failed?: boolean } | undefined) => {
        listener({ failed: event?.failed === true });
      });
    },
  };
}
