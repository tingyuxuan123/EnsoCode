// Messages between main and the device host: over `utilityProcess` messaging in the desktop app, or
// the IPC of `child_process.fork` when the host runs under Node.js.
//
// Only the device host's half of Kettu's `host-control.ts` is carried over here; the agent host and
// the terminal host have their own contracts in CodeKiln.

import type { DeviceCall, DeviceCallAnswer } from './device-agent';
import type { Platform } from './platform';
import type { PortDevice } from './remote/device';

/**
 * The program that runs a script as Node.js, for the shell probe and the agents that are scripts:
 * Electron's binary with ELECTRON_RUN_AS_NODE in the desktop app, Node.js itself under Node.js.
 */
export interface NodeRuntime {
  command: string;
  /** Variables the program needs to run as Node.js, over the environment it is given. */
  env: Record<string, string>;
}

export type MainToDeviceHost =
  | {
      type: 'device-host:init';
      platform: Platform;
      appVersion: string;
      nodeRuntime: NodeRuntime;
      /** The app's data folder, where agent-device keeps its state. */
      dataDir: string;
      /** The packaged app's resources, which hold the helpers; null in development. */
      resourcesPath: string | null;
      allowDevices: boolean;
      // Under Node.js, the local socket the host takes its ports on; the desktop app hands them over.
      socketPath?: string;
    }
  // The port travels in the transfer list; `device` names the paired device it serves, if any.
  | { type: 'device-host:connect'; windowId: number; device?: PortDevice }
  | { type: 'device-host:allow-devices'; allowed: boolean }
  | { type: 'device-host:sessions-ended'; sessionIds: string[] }
  /** An agent's device tool call, which the agent host sent its parent. */
  | { type: 'device-host:call'; callId: number; call: DeviceCall }
  /** The turn of a session whose agent used devices ended; null: every turn, as the host stopped. */
  | { type: 'device-host:turn-ended'; sessionId: string | null }
  | { type: 'device-host:shutdown' };

export type DeviceHostToMain =
  | { type: 'device-host:ready' }
  | { type: 'device-host:answer'; callId: number; answer: DeviceCallAnswer }
  /** The user handed a device back to the turn of `sessionId` after holding it for `durationMs`. */
  | { type: 'device-host:handed-back'; sessionId: string; durationMs: number }
  | { type: 'device-host:stopped' };
