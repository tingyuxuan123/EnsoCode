import { randomUUID } from 'node:crypto';
import path from 'node:path';
import {
  DEVICE_ACCESS_WAIT_MS,
  type DeviceAccessAnswer,
  type DeviceAccessDecision,
  type DeviceAccessEntry,
} from '@shared/device-agent';
import { app } from 'electron';
import { DeviceAccessStore } from '../../agent-host/devices/access';
import {
  type DeviceHostAnswer,
  type DeviceSessionAuthority,
  DeviceToolGateway,
} from '../../agent-host/devices/main';
import { deviceHost } from './deviceHost';

// main/index sets userData after importing this module. Never read or migrate the default profile.
let store: DeviceAccessStore | undefined;
function accessStore(): DeviceAccessStore {
  store ??= new DeviceAccessStore(
    path.join(app.getPath('userData'), 'state', 'device-access.json')
  );
  return store;
}

interface MainBindings {
  authority: DeviceSessionAuthority['session'];
  toolEnabled(sessionId: string): boolean;
  changed(entry: DeviceAccessEntry): void;
}
let bindings: MainBindings = { authority: () => null, toolEnabled: () => false, changed: () => {} };
export function bindDeviceToolMain(deps: MainBindings): void {
  bindings = deps;
}

// The ledger is a window-reloadable projection, never a source of grants. Only pending questions
// retain their worker generation and gateway commit capability; settled cards retain neither.
const sessions = new Map<string, Map<string, DeviceAccessEntry>>();
const pending = new Map<
  string,
  {
    generation: string;
    commit: (decision: DeviceAccessDecision) => void;
    finish: (answer: DeviceAccessAnswer) => void;
  }
>();

function ask(
  sessionId: string,
  deviceId: string,
  deviceName: string,
  signal: AbortSignal,
  generation: string,
  commit: (decision: DeviceAccessDecision) => void
): Promise<DeviceAccessAnswer> {
  if (signal.aborted || bindings.authority({ sessionId, generation })?.sessionId !== sessionId)
    return Promise.resolve('timeout');
  const entries = sessions.get(sessionId) ?? new Map<string, DeviceAccessEntry>();
  sessions.set(sessionId, entries);
  const entry: DeviceAccessEntry = {
    kind: 'device_access',
    id: randomUUID(),
    sessionId,
    deviceId,
    deviceName,
    decision: null,
    expiresAt: Date.now() + DEVICE_ACCESS_WAIT_MS,
  };
  entries.set(entry.id, entry);
  return new Promise((resolve) => {
    const expire = () => finish('timeout');
    const timer = setTimeout(expire, DEVICE_ACCESS_WAIT_MS);
    const finish = (answer: DeviceAccessAnswer) => {
      if (!pending.delete(entry.id)) return;
      clearTimeout(timer);
      signal.removeEventListener('abort', expire);
      const settled = { ...entry, decision: answer };
      entries.set(entry.id, settled);
      resolve(answer);
      bindings.changed(settled);
    };
    pending.set(entry.id, { generation, commit, finish });
    signal.addEventListener('abort', expire, { once: true });
    bindings.changed(entry);
  });
}

export function listDeviceAccess(sessionId: string): DeviceAccessEntry[] {
  return Array.from(sessions.get(sessionId)?.values() ?? []);
}

export function answerDeviceAccess(
  sessionId: string,
  entryId: string,
  decision: DeviceAccessDecision
): void {
  const entry = sessions.get(sessionId)?.get(entryId);
  const question = pending.get(entryId);
  if (!entry || !question || entry.decision !== null) return;
  // The event loop can process a late IPC before the timer after machine sleep.
  if (
    Date.now() >= entry.expiresAt ||
    bindings.authority({ sessionId, generation: question.generation })?.sessionId !== sessionId ||
    !bindings.toolEnabled(sessionId)
  ) {
    question.finish('timeout');
    return;
  }
  try {
    question.commit(decision);
  } catch (error) {
    question.finish('deny');
    throw error;
  }
  question.finish(decision);
}

export function revokeDeviceAccess(sessionId: string, deviceId: string): void {
  deviceToolGateway.revoke(sessionId, deviceId);
  const entries = sessions.get(sessionId);
  if (!entries) return;
  for (const entry of entries.values()) {
    if (entry.deviceId !== deviceId || entry.decision !== 'session' || entry.revoked) continue;
    const revoked = { ...entry, revoked: true as const };
    entries.set(entry.id, revoked);
    bindings.changed(revoked);
  }
}

export function destroyDeviceAccessSession(sessionId: string): void {
  deviceToolGateway.release(sessionId);
  sessions.delete(sessionId);
}

export const listAllowedDeviceAccess = (): string[] => accessStore().list();
export const forgetDeviceAccess = (deviceId: string): void => accessStore().remove(deviceId);

export const deviceToolGateway = new DeviceToolGateway({
  authority: { session: (caller) => bindings.authority(caller) },
  get store() {
    return accessStore();
  },
  toolEnabled: (id) => bindings.toolEnabled(id),
  ask,
  async call(call, timeoutMs) {
    if (process.env.ENSO_DEVICE_DEBUG) console.log('[device-call]', JSON.stringify(call));
    const answer = (await deviceHost.call(call, timeoutMs)) as DeviceHostAnswer | undefined;
    if (process.env.ENSO_DEVICE_DEBUG) console.log('[device-answer]', JSON.stringify(answer));
    return answer ?? { error: { code: 'unavailable', message: 'The device host is not running' } };
  },
});
