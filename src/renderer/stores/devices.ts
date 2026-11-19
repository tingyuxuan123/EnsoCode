// The devices a session holds and how each one's stream is doing. The device host owns the
// devices themselves; this store only keeps what the pane shows and follows the host's events.

import type { DeviceEnvironment, DeviceInfo, DeviceOperator } from '@shared/device-host';
import { create } from 'zustand';
import { addToast } from '@/components/ui/toast';
import { deviceBridge } from '@/features/devices/bridge';
import { devicesText } from '@/features/devices/i18n';
import { errorMessage } from '@/features/devices/support';

interface DevicesStore {
  environment: DeviceEnvironment | null;
  /** Every device of this computer, as the device host last listed them. */
  devices: DeviceInfo[];
  loaded: boolean;
  error: string | null;
  /** The device each session's pane shows. */
  selected: Record<string, string>;
  /** A device the pane is opening, booting it first when it is off. */
  opening: Record<string, string>;
  /** How the stream of each device a pane shows is doing, as its screen last heard. */
  streams: Record<string, DeviceStream>;
  /** The device whose screen is being recorded, and since when. */
  recording: { deviceId: string; since: number } | null;
}

export interface DeviceStream {
  state: 'starting' | 'live' | 'stopped' | 'error';
  error: string | null;
  /** A picture was drawn, which stays under a stream that ended. */
  drawn: boolean;
}

export const useDevicesStore = create<DevicesStore>()(() => ({
  environment: null,
  devices: [],
  loaded: false,
  error: null,
  selected: {},
  opening: {},
  streams: {},
  recording: null,
}));

/** Why the host refused: its own words, or the pane's for a session that is full. */
function refusal(error: unknown): string {
  const data = (error as { data?: { limit?: unknown } } | null)?.data;
  return typeof data?.limit === 'number'
    ? devicesText('This session already has {{count}} devices open. Disconnect one first.', {
        count: data.limit,
      })
    : errorMessage(error);
}

/** Lists the devices and what this computer can run. */
export async function loadDevices(): Promise<void> {
  const api = deviceBridge();
  if (!api) {
    useDevicesStore.setState({ loaded: true, error: devicesText('The device host is not ready') });
    return;
  }
  try {
    const [environment, devices] = await Promise.all([
      api.request('devices.environment', {}),
      api.request('devices.list', {}),
    ]);
    useDevicesStore.setState({ environment, devices, loaded: true, error: null });
  } catch (error) {
    useDevicesStore.setState({ loaded: true, error: errorMessage(error) });
  }
}

/** The devices a session holds, in the order the host lists them. */
export function devicesOf(devices: DeviceInfo[], sessionId: string | null): DeviceInfo[] {
  return sessionId ? devices.filter((device) => device.sessionId === sessionId) : [];
}

export async function openDevice(sessionId: string, deviceId: string): Promise<void> {
  const api = deviceBridge();
  if (!api) return;
  useDevicesStore.setState((s) => ({
    opening: { ...s.opening, [sessionId]: deviceId },
    error: null,
  }));
  try {
    const info = await api.request('devices.open', { deviceId, sessionId });
    useDevicesStore.setState((s) => ({ selected: { ...s.selected, [sessionId]: info.id } }));
  } catch (error) {
    addToast({ type: 'error', title: refusal(error) });
  } finally {
    useDevicesStore.setState((s) => {
      const opening = { ...s.opening };
      delete opening[sessionId];
      return { opening };
    });
  }
}

export async function closeDevice(
  sessionId: string,
  deviceId: string,
  shutdown = false
): Promise<void> {
  const api = deviceBridge();
  if (!api) return;
  try {
    await api.request('devices.close', { deviceId, sessionId, shutdown });
  } catch (error) {
    addToast({ type: 'error', title: errorMessage(error) });
  }
}

/** Takes a device another session holds into this one. */
export async function moveDevice(sessionId: string, deviceId: string): Promise<void> {
  const api = deviceBridge();
  if (!api) return;
  try {
    const info = await api.request('devices.move', { deviceId, sessionId });
    useDevicesStore.setState((s) => ({ selected: { ...s.selected, [sessionId]: info.id } }));
  } catch (error) {
    addToast({ type: 'error', title: refusal(error) });
  }
}

/** Take over or hand back a device a turn uses. */
export function controlDevice(
  method: 'devices.takeOver' | 'devices.handBack',
  deviceId: string,
  sessionId: string
): void {
  const api = deviceBridge();
  if (!api) return;
  void api.request(method, { deviceId, sessionId }).catch((error: unknown) => {
    addToast({ type: 'error', title: errorMessage(error) });
  });
}

/** Shuts a simulator or emulator down; its tab stays, to start it again. */
export async function shutDownDevice(sessionId: string, deviceId: string): Promise<void> {
  const api = deviceBridge();
  if (!api) return;
  try {
    await api.request('devices.shutdown', { deviceId, sessionId });
  } catch (error) {
    addToast({ type: 'error', title: errorMessage(error) });
  }
}

export function setDeviceStream(deviceId: string, stream: DeviceStream | null): void {
  useDevicesStore.setState((s) => {
    const streams = { ...s.streams };
    if (stream) streams[deviceId] = stream;
    else delete streams[deviceId];
    return { streams };
  });
}

export function selectDevice(sessionId: string, deviceId: string): void {
  useDevicesStore.setState((s) => ({ selected: { ...s.selected, [sessionId]: deviceId } }));
}

/**
 * Follows the device list the host sends. An agent that opens a device selects it in its session
 * and asks `show` to put the pane in front of the user, so the tool's "it is shown beside the
 * conversation" is true.
 */
export function initDevices(show?: (sessionId: string) => void): () => void {
  const api = deviceBridge();
  if (!api) return () => undefined;
  const stopEvents = api.onEvent((event) => {
    if (event.type === 'devices.changed') {
      useDevicesStore.setState({ devices: event.devices, loaded: true });
    } else if (event.type === 'device.opened') {
      const { sessionId, deviceId } = event;
      useDevicesStore.setState((s) => ({ selected: { ...s.selected, [sessionId]: deviceId } }));
      void loadDevices();
      show?.(sessionId);
    }
  });
  const stopConnection = api.onConnection((state) => {
    if (state === 'connected' && useDevicesStore.getState().loaded) void loadDevices();
  });
  return () => {
    stopEvents();
    stopConnection();
  };
}

/**
 * The device a turn of the session uses: the one the user holds first, then the one the agent acts
 * on, then any; null when none is used.
 */
export function deviceInUse(
  devices: DeviceInfo[],
  sessionId: string
): (DeviceInfo & { operator: DeviceOperator }) | null {
  let found: (DeviceInfo & { operator: DeviceOperator }) | null = null;
  const rank = (operator: DeviceOperator): number =>
    operator.control.kind === 'you'
      ? 2
      : operator.control.kind === 'agent' && operator.control.acting
        ? 1
        : 0;
  for (const device of devices) {
    const operator = device.operator;
    if (!operator || device.sessionId !== sessionId) continue;
    if (!found || rank(operator) > rank(found.operator)) found = { ...device, operator };
  }
  return found;
}
