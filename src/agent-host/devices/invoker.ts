// The worker's pending device calls: one entry per tool call, settled by Main's answer.
//
// The worker only forwards what the model asked for. Main decides the session, the permission and
// the folder, and answers `device-tool-result`; a call that is aborted, times out or loses its
// session is settled locally and Main is told to stop it.

import { randomUUID } from 'node:crypto';
import { DEVICE_CALL_TIMEOUT_MS } from '@shared/device-agent';
import type { DeviceToolAnswer } from '@shared/device-tools';

export interface DeviceToolInvokeRequest {
  requestId: string;
  toolName: string;
  args: unknown;
}

export interface DeviceToolInvokeResult {
  requestId: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

interface Pending {
  resolve(value: DeviceToolAnswer): void;
  reject(error: Error): void;
  cancel(error: Error): void;
}

/**
 * worker ↔ Main 的设备工具挂起表（与 ComputerInvoker 同构）。请求经 `device-tool-invoke`
 * 上抛，结果经 `device-tool-result` 回落；abort / 超时 / 会话结束本地 fail-closed，
 * 并经 `device-tool-cancel` 让 Main 停掉仍在设备上跑的动作。
 */
export class DeviceToolInvoker {
  private readonly pending = new Map<string, Pending>();

  constructor(
    private readonly emit: (request: DeviceToolInvokeRequest) => void,
    private readonly options: {
      timeoutMs?: number;
      emitCancel?: (requestId: string) => void;
    } = {}
  ) {}

  /** 设备命令可能跨一次 app 首次构建，预算按 device host 的上限再留一点余量。 */
  invoke(toolName: string, args: unknown, signal?: AbortSignal): Promise<DeviceToolAnswer> {
    if (signal?.aborted) return Promise.reject(new Error('Device action aborted'));
    const requestId = randomUUID();
    const { promise, resolve, reject } = Promise.withResolvers<DeviceToolAnswer>();
    const timeoutMs = this.options.timeoutMs ?? DEVICE_CALL_TIMEOUT_MS + 10_000;
    const timer = setTimeout(
      () => settle(new Error(`Device tool ${toolName} timed out after ${timeoutMs}ms`), true),
      timeoutMs
    );
    const onAbort = () => settle(new Error('Device action aborted'), true);
    const settle = (outcome: DeviceToolAnswer | Error, cancelRemote = false) => {
      if (!this.pending.delete(requestId)) return;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (cancelRemote) {
        try {
          this.options.emitCancel?.(requestId);
        } catch {
          // Main 也会在会话结束 / worker 退出时清理该会话的挂起调用。
        }
      }
      if (outcome instanceof Error) reject(outcome);
      else resolve(outcome);
    };
    this.pending.set(requestId, {
      resolve: (value) => settle(value),
      reject: (error) => settle(error),
      cancel: (error) => settle(error, true),
    });
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      this.emit({ requestId, toolName, args });
    } catch (error) {
      settle(error instanceof Error ? error : new Error(String(error)));
    }
    return promise;
  }

  /** Main 回落；未知 requestId 返回 false（已超时 / 已取消）。 */
  resolve(result: DeviceToolInvokeResult): boolean {
    const entry = this.pending.get(result.requestId);
    if (!entry) return false;
    if (result.ok) {
      entry.resolve(asAnswer(result.result));
      return true;
    }
    entry.reject(new Error(result.error || 'Device action failed'));
    return true;
  }

  cancelAll(reason = 'Device action cancelled'): void {
    for (const entry of [...this.pending.values()]) entry.cancel(new Error(reason));
  }

  get pendingCount(): number {
    return this.pending.size;
  }
}

/** Main sends the payload (not a nested DeviceToolAnswer) on a successful IPC reply. */
function asAnswer(payload: unknown): DeviceToolAnswer {
  if (
    payload &&
    typeof payload === 'object' &&
    !Array.isArray(payload) &&
    'text' in payload &&
    typeof payload.text === 'string'
  ) {
    const image = 'image' in payload ? payload.image : undefined;
    if (image === undefined || typeof image === 'string') {
      return {
        result: {
          text: payload.text,
          ...(image !== undefined ? { image } : {}),
          ...('value' in payload ? { value: payload.value } : {}),
        },
      };
    }
  }
  return { error: { code: 'failed', message: 'The device host returned no result.' } };
}
