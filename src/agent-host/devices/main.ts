// Main authorizes device calls. A session grant outlives a turn, but an unfinished call or
// question never does. Re-check Main's live identity after waits, not just at IPC ingress.
import {
  CONTROL_WAIT_MS,
  ControlWait,
  type SurfaceControl,
  SurfaceControls,
} from '@shared/control';
import {
  DEVICE_ACCESS_WAIT_MS,
  DEVICE_CALL_TIMEOUT_MS,
  type DeviceAccessAnswer,
  type DeviceAccessDecision,
  type DeviceCall,
  type DeviceCallErrorCode,
} from '@shared/device-agent';
import {
  DeviceArgsError,
  type DeviceToolAnswer,
  type DeviceToolCallRequest,
  deviceRequestOf,
} from '@shared/device-tools';
import type { ApprovalMode } from '@shared/types/agent';
import type { DeviceAccessStore } from './access';

export type DeviceHostCall = DeviceCall;
export type DeviceHostAnswer =
  | { result: { text: string; image?: string; value?: unknown } }
  | { error: { code: string; message: string; data?: unknown } };

type Caller = { sessionId: string; generation: string };

export interface DeviceToolMainDeps {
  authority: DeviceSessionAuthority;
  call(call: DeviceHostCall, timeoutMs?: number, signal?: AbortSignal): Promise<DeviceHostAnswer>;
  store: DeviceAccessStore;
  /** Main owns the request id, deadline and card. An aborted question is no longer answerable. */
  ask(
    sessionId: string,
    deviceId: string,
    deviceName: string,
    signal: AbortSignal,
    generation: string,
    commit: (decision: DeviceAccessDecision) => void
  ): Promise<DeviceAccessAnswer>;
  toolEnabled(sessionId: string): boolean;
  log?(message: string): void;
}

export interface DeviceSessionAuthority {
  /** Null for a child, coworker, remote, bot or stale generation. */
  session(caller: Caller): DeviceSessionRecord | null;
}

export interface DeviceSessionRecord {
  sessionId: string;
  agentName: string;
  projectPath: string | null;
  approvalMode?: ApprovalMode;
}

export interface DeviceCallInput {
  caller: Caller;
  toolName: string;
  args: unknown;
  signal?: AbortSignal;
}

interface Question {
  controller: AbortController;
  answer: Promise<DeviceAccessAnswer>;
  waiters: number;
}

class Refused extends Error {
  constructor(
    readonly code: DeviceCallErrorCode | 'not_allowed',
    message: string
  ) {
    super(message);
  }
}

export class DeviceToolGateway {
  private readonly allowed = new Map<string, Set<string>>();
  private readonly asking = new Map<string, Question>();
  private readonly active = new Set<{
    sessionId: string;
    deviceId?: string;
    controller: AbortController;
  }>();
  private readonly controls = new SurfaceControls({ changed: () => {} });
  private readonly controlOwner = new Map<string, string>();

  constructor(private readonly deps: DeviceToolMainDeps) {}

  control(deviceId: string): SurfaceControl {
    return this.controls.state(deviceId);
  }

  takeOver(deviceId: string): boolean {
    return this.controls.takeOver(deviceId);
  }

  handBack(deviceId: string): boolean {
    return this.controls.handBack(deviceId);
  }

  private stop(sessionId: string, deviceId?: string): void {
    for (const call of this.active) {
      if (call.sessionId === sessionId && (deviceId === undefined || call.deviceId === deviceId))
        call.controller.abort();
    }
    for (const [id, owner] of this.controlOwner) {
      if (owner !== sessionId || (deviceId !== undefined && deviceId !== id)) continue;
      this.controls.turnEnded(id);
      this.controlOwner.delete(id);
    }
  }

  turnEnded(sessionId: string): void {
    this.stop(sessionId);
  }

  /** Only a session grant is revoked here; an always grant belongs to the persistent store. */
  revoke(sessionId: string, deviceId: string): void {
    this.allowed.get(sessionId)?.delete(deviceId);
    this.stop(sessionId, deviceId);
  }

  /** Session destroyed, NOT merely idle between turns. */
  release(sessionId: string): void {
    this.allowed.delete(sessionId);
    this.stop(sessionId);
  }

  private current(caller: Caller, signal: AbortSignal): DeviceSessionRecord {
    if (signal.aborted) throw new ControlWait('stopped');
    const session = this.deps.authority.session(caller);
    if (!session || session.sessionId !== caller.sessionId)
      throw new Refused('not_allowed', NOT_ROOT);
    if (!this.deps.toolEnabled(session.sessionId)) throw new Refused('not_allowed', DISABLED);
    return session;
  }

  private hasAccess(session: DeviceSessionRecord, deviceId: string): boolean {
    return (
      session.approvalMode === 'full' ||
      this.deps.store.has(deviceId) ||
      this.allowed.get(session.sessionId)?.has(deviceId) === true
    );
  }

  private authorized(caller: Caller, deviceId: string, signal: AbortSignal): DeviceSessionRecord {
    const session = this.current(caller, signal);
    if (!this.hasAccess(session, deviceId))
      throw new Refused('not_allowed', 'Device access was revoked.');
    return session;
  }

  async call({
    caller,
    toolName,
    args,
    signal: incoming,
  }: DeviceCallInput): Promise<DeviceToolAnswer> {
    const controller = new AbortController();
    const signal = incoming ? AbortSignal.any([incoming, controller.signal]) : controller.signal;
    const active = {
      sessionId: caller.sessionId,
      controller,
      deviceId: undefined as string | undefined,
    };
    this.active.add(active);
    try {
      const { sessionId } = this.current(caller, signal);
      const request = parseRequest(toolName, args);
      if (!request) throw new Refused('invalid_params', 'Unsupported device request.');
      if (request.kind === 'list') return await this.forward({ kind: 'list', sessionId }, signal);
      const { deviceId } = request;
      active.deviceId = deviceId;
      // Like Kettu, close only releases a lease this session holds (enforced by the host).
      if (request.kind === 'close') return await this.forward({ ...request, sessionId }, signal);
      await this.access(caller, deviceId, signal);
      const session = this.authorized(caller, deviceId, signal);
      if (request.kind === 'open') {
        return await this.forward({ ...request, sessionId, agentName: session.agentName }, signal);
      }
      // A second session may try a leased device. It cannot take ownership of the first
      // session's control waiter merely by attempting a call (the host enforces the lease).
      if (!this.controlOwner.has(deviceId)) this.controlOwner.set(deviceId, sessionId);
      const end = await this.controls.begin(deviceId, { deadline: Date.now() + CONTROL_WAIT_MS });
      try {
        const { agentName, projectPath } = this.authorized(caller, deviceId, signal);
        return await this.forward({ ...request, sessionId, agentName, projectPath }, signal);
      } finally {
        end();
      }
    } catch (error) {
      if (error instanceof ControlWait) return waitFailure(error);
      if (error instanceof Refused) return { error: { code: error.code, message: error.message } };
      return {
        error: { code: 'failed', message: error instanceof Error ? error.message : String(error) },
      };
    } finally {
      this.active.delete(active);
    }
  }

  private async access(caller: Caller, deviceId: string, signal: AbortSignal): Promise<void> {
    const { sessionId, generation } = caller;
    if (this.hasAccess(this.current(caller, signal), deviceId)) return;
    // Reserve even while listing. Different worker generations must never adopt one another's card.
    const key = JSON.stringify([sessionId, generation, deviceId]);
    let question = this.asking.get(key);
    if (!question) {
      const controller = new AbortController();
      question = {
        controller,
        answer: this.question(caller, deviceId, controller.signal),
        waiters: 0,
      };
      this.asking.set(key, question);
    }
    const shared = question;
    shared.waiters++;
    const cancelled = Promise.withResolvers<never>();
    const leave = () => {
      if (--shared.waiters !== 0) return;
      if (this.asking.get(key) === shared) this.asking.delete(key);
      if (signal.aborted) shared.controller.abort();
    };
    const onAbort = () => {
      leave(); // detach synchronously so a new call can't join a cancelled question
      cancelled.reject(new ControlWait('stopped'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
    try {
      const answer = await Promise.race([shared.answer, cancelled.promise]);
      this.current(caller, signal);
      if (answer !== 'always' && answer !== 'session') {
        throw new Refused(
          'not_allowed',
          answer === 'timeout'
            ? 'The user did not answer in time, so the device was not used.'
            : 'The user did not allow this session to use the device.'
        );
      }
    } finally {
      signal.removeEventListener('abort', onAbort);
      if (!signal.aborted) leave();
    }
  }

  private async question(
    caller: Caller,
    deviceId: string,
    signal: AbortSignal
  ): Promise<DeviceAccessAnswer> {
    const { sessionId, generation } = caller;
    const listed = await this.forward({ kind: 'list', sessionId }, signal);
    this.current(caller, signal);
    if ('error' in listed) throw new Refused(listed.error.code, listed.error.message);
    const info = listed.result.value;
    const devices =
      info && typeof info === 'object' && 'devices' in info && Array.isArray(info.devices)
        ? info.devices
        : [];
    const device = devices.find(
      (entry) => entry?.id === deviceId && typeof entry.name === 'string'
    );
    if (!device)
      throw new Refused('not_found', 'No such device on this host. Call device_list for the ids.');
    // Ledger commits in the same stack as accepting the card. Neither this promise's
    // continuation nor any of the joined tool calls is allowed to recreate the grant.
    let closed = false;
    let committed: DeviceAccessDecision | undefined;
    const commit = (decision: DeviceAccessDecision) => {
      this.current(caller, signal);
      if (closed || committed !== undefined)
        throw new Refused('not_allowed', 'This device request is no longer pending.');
      if (decision === 'always') this.deps.store.add(deviceId);
      else if (decision === 'session') {
        const set = this.allowed.get(sessionId) ?? new Set<string>();
        set.add(deviceId);
        this.allowed.set(sessionId, set);
      }
      committed = decision;
    };
    try {
      const answer = await this.deps.ask(
        sessionId,
        deviceId,
        device.name.slice(0, 512),
        signal,
        generation,
        commit
      );
      if ((answer === 'session' || answer === 'always') && answer !== committed) {
        throw new Refused('not_allowed', 'Device access was not committed.');
      }
      return answer;
    } finally {
      closed = true;
    }
  }

  private async forward(call: DeviceHostCall, signal: AbortSignal): Promise<DeviceToolAnswer> {
    if (signal.aborted) throw new ControlWait('stopped');
    const answer = await this.deps.call(call, DEVICE_CALL_TIMEOUT_MS + 5_000, signal);
    if ('error' in answer)
      return { error: { ...answer.error, code: deviceErrorCode(answer.error.code) } };
    return { result: answer.result };
  }
}

export function deviceToolCall(
  gateway: DeviceToolGateway,
  input: DeviceCallInput
): Promise<DeviceToolAnswer> {
  return gateway.call(input);
}

export { DEVICE_ACCESS_WAIT_MS };

const NOT_ROOT =
  'Mobile devices are only available to the current local conversation, not to subagents, coworkers, remote sessions or bots.';
const DISABLED = 'The Mobile devices tool is disabled for this conversation.';

const DEVICE_ERROR_CODES = new Set<string>([
  'invalid_params',
  'not_found',
  'busy',
  'not_open',
  'user_has_control',
  'stopped',
  'unavailable',
  'failed',
]);
function deviceErrorCode(code: string): DeviceCallErrorCode {
  return (DEVICE_ERROR_CODES.has(code) ? code : 'failed') as DeviceCallErrorCode;
}

function waitFailure(wait: ControlWait): DeviceToolAnswer {
  switch (wait.reason) {
    case 'held':
    case 'asking':
      return {
        error: {
          code: 'user_has_control',
          message: 'The user took over this device and still has it; call again to keep waiting.',
        },
      };
    case 'stopped':
      return { error: { code: 'stopped', message: 'The user stopped.' } };
    case 'gone':
      return {
        error: { code: 'not_open', message: 'The device was closed or moved to another session.' },
      };
  }
}

function parseRequest(toolName: string, args: unknown): DeviceToolCallRequest | null {
  if (typeof toolName !== 'string' || !toolName.startsWith('device_')) return null;
  try {
    return deviceRequestOf(toolName, args);
  } catch (error) {
    if (error instanceof DeviceArgsError) return null;
    throw error;
  }
}
