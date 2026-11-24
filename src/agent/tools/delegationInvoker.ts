import { randomUUID } from 'node:crypto';
import type { AgentWorkerEvent } from '@shared/types/agent';

type DelegationEvent = Extract<AgentWorkerEvent, { type: 'delegation-invoke' }>;
export type DelegationOp = DelegationEvent['op'];
type DelegationRequest = Pick<DelegationEvent, 'identity' | 'requestId' | 'op' | 'params'>;

interface DelegationResult {
  requestId: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

interface Pending {
  resolve(result: unknown): void;
  reject(error: Error): void;
}

const DEFAULT_TIMEOUT_MS = 15_000;

/** Pending worker ↔ Main calls for Bot and group tools. */
export class DelegationInvoker {
  private readonly pending = new Map<string, Pending>();

  constructor(
    private readonly identity: DelegationRequest['identity'],
    private readonly emit: (request: DelegationRequest) => void,
    private readonly options: { timeoutMs?: number } = {}
  ) {}

  invoke(op: DelegationOp, params: unknown, signal?: AbortSignal): Promise<unknown> {
    if (signal?.aborted) return Promise.reject(new Error('Delegation action aborted'));
    const requestId = randomUUID();
    const { promise, resolve, reject } = Promise.withResolvers<unknown>();
    const timeoutMs = this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const timer = setTimeout(
      () => settle(new Error(`Delegation action ${op} timed out after ${timeoutMs}ms`)),
      timeoutMs
    );
    const onAbort = () => settle(new Error('Delegation action aborted'));
    const settle = (outcome: unknown) => {
      if (!this.pending.delete(requestId)) return;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (outcome instanceof Error) reject(outcome);
      else resolve(outcome);
    };
    this.pending.set(requestId, { resolve: settle, reject: settle });
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      this.emit({ identity: this.identity, requestId, op, params });
    } catch (error) {
      settle(error instanceof Error ? error : new Error(String(error)));
    }
    return promise;
  }

  resolve(result: DelegationResult): boolean {
    const entry = this.pending.get(result.requestId);
    if (!entry) return false;
    if (result.ok) entry.resolve(result.result);
    else entry.reject(new Error(result.error || 'Delegation action failed'));
    return true;
  }

  cancelAll(reason = 'Delegation action cancelled'): void {
    for (const entry of [...this.pending.values()]) entry.reject(new Error(reason));
  }

  get pendingCount(): number {
    return this.pending.size;
  }
}
