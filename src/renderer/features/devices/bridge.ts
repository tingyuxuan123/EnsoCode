// The one place the devices pane reaches the device host. Main exposes the port-backed API as
// `window.electronAPI.devices`; a window without it (an older build, or a test) gets `null` and
// the pane says the device host is not ready instead of crashing.

import type {
  DeviceCaptureKind,
  DeviceEvent,
  DeviceMethod,
  DeviceParams,
  DeviceResult,
} from '@shared/device-host';
import type { PortConnectionState } from '@shared/port-rpc';

/** A session's agent opened a device, sent by Main to every window. */
export interface DeviceOpenedEvent {
  sessionId: string;
  deviceId: string;
}

/**
 * What the renderer needs of `DevicesApi`, plus the two channels only the desktop app has: the
 * event Main sends when an agent opens a device, and the capture the preload writes to Downloads.
 */
export interface DeviceBridge {
  request<M extends DeviceMethod>(method: M, params: DeviceParams<M>): Promise<DeviceResult<M>>;
  onEvent(listener: (event: DeviceEvent) => void): () => void;
  onConnection(listener: (state: PortConnectionState) => void): () => void;
  /** Absent in bridges built before Main sent it. */
  onOpened?(listener: (event: DeviceOpenedEvent) => void): () => void;
  /** The path a capture was written to, or null where the page never learns it. */
  saveCapture?(device: string, kind: DeviceCaptureKind, data: ArrayBuffer): Promise<string | null>;
}

let injected: DeviceBridge | null | undefined;

/** The bridge shape, checked by hand: the page is untrusted input and the preload is versioned. */
export function deviceBridgeApi(value: unknown): DeviceBridge | null {
  if (typeof value !== 'object' || value === null) return null;
  const api = value as Partial<DeviceBridge>;
  if (typeof api.request !== 'function') return null;
  if (typeof api.onEvent !== 'function') return null;
  if (typeof api.onConnection !== 'function') return null;
  if (api.onOpened !== undefined && typeof api.onOpened !== 'function') return null;
  if (api.saveCapture !== undefined && typeof api.saveCapture !== 'function') return null;
  return api as DeviceBridge;
}

/** The bridge a window was built with, or null where it exposes none. */
export function readDeviceBridge(): DeviceBridge | null {
  const api = (globalThis as { electronAPI?: { devices?: unknown } }).electronAPI;
  return deviceBridgeApi(api?.devices);
}

/** Tests and previews put a bridge in place; `null` stands for a window without one. */
export function setDeviceBridge(bridge: DeviceBridge | null | undefined): void {
  injected = bridge;
}

/** The bridge in use now: the injected one, else the preload's, else null. */
export function deviceBridge(): DeviceBridge | null {
  return injected === undefined ? readDeviceBridge() : injected;
}
