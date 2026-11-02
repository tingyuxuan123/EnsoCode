import { randomUUID } from 'node:crypto';
import type {
  AgentCommand,
  AgentWorkerEvent,
  McpServerSpawnConfig,
  SessionIdentity,
} from '@shared/types/agent';
import type { McpToolInfo } from './gate';
import { pluginError } from './process';
export type PluginMcpCommand = Extract<AgentCommand, { type: `plugin-mcp-${string}` }>;
type Result = Extract<AgentWorkerEvent, { type: 'plugin-mcp-result' }>;
interface Pending {
  identity: SessionIdentity;
  resolve(v: unknown): void;
  reject(e: Error): void;
  cancel(): void;
}
export class PluginMcpRequests {
  private readonly pending = new Map<string, Pending>();
  constructor(
    private readonly post: (command: PluginMcpCommand) => boolean,
    private readonly timeoutMs = 120_000
  ) {}
  get pendingCount(): number {
    return this.pending.size;
  }
  list(
    input: { identity: SessionIdentity; servers: McpServerSpawnConfig[] },
    signal: AbortSignal
  ): Promise<McpToolInfo[]> {
    return this.request(
      input.identity,
      (requestId) => ({ type: 'plugin-mcp-list', requestId, ...input }),
      signal
    ) as Promise<McpToolInfo[]>;
  }
  call(
    input: {
      identity: SessionIdentity;
      servers: McpServerSpawnConfig[];
      server: string;
      tool: string;
      args: Record<string, unknown>;
    },
    signal: AbortSignal
  ): Promise<{ content: string; isError: boolean }> {
    return this.request(
      input.identity,
      (requestId) => ({ type: 'plugin-mcp-call', requestId, ...input }),
      signal
    ) as Promise<{ content: string; isError: boolean }>;
  }
  settle(
    event:
      | AgentWorkerEvent
      | Result
      | {
          type: string;
          requestId?: string;
          identity?: SessionIdentity;
          ok?: boolean;
          value?: unknown;
          error?: string;
        }
  ): boolean {
    if (event.type !== 'plugin-mcp-result' || !('requestId' in event) || !('identity' in event))
      return false;
    const p = this.pending.get(event.requestId!);
    if (
      !p ||
      !event.identity ||
      p.identity.sessionId !== event.identity.sessionId ||
      p.identity.generation !== event.identity.generation
    )
      return false;
    if ('ok' in event && event.ok) p.resolve('value' in event ? event.value : undefined);
    else
      p.reject(
        pluginError('MCP_ERROR', 'error' in event ? (event.error ?? 'MCP failed') : 'MCP failed')
      );
    return true;
  }
  failAll(message: string): void {
    for (const p of [...this.pending.values()]) {
      p.cancel();
      p.reject(pluginError('MCP_ERROR', message));
    }
  }
  private request(
    identity: SessionIdentity,
    build: (requestId: string) => PluginMcpCommand,
    signal: AbortSignal
  ): Promise<unknown> {
    if (signal.aborted) return Promise.reject(pluginError('ABORTED', '调用已取消'));
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      const cancel = () => {
        try {
          this.post({ type: 'plugin-mcp-cancel', requestId, identity });
        } catch {
          /* Worker gone. */
        }
      };
      const finish = (settle: () => void) => {
        if (!this.pending.delete(requestId)) return;
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        settle();
      };
      const abort = () => {
        cancel();
        finish(() => reject(pluginError('ABORTED', '调用已取消')));
      };
      const timer = setTimeout(() => {
        cancel();
        finish(() => reject(pluginError('TIMEOUT', 'MCP 调用超时')));
      }, this.timeoutMs);
      this.pending.set(requestId, {
        identity,
        cancel,
        resolve: (v) => finish(() => resolve(v)),
        reject: (e) => finish(() => reject(e)),
      });
      signal.addEventListener('abort', abort, { once: true });
      try {
        if (!this.post(build(requestId)))
          finish(() => reject(pluginError('UNSUPPORTED', 'Agent 进程不可用，无法调用 MCP')));
      } catch (e) {
        finish(() => reject(e));
      }
    });
  }
}
