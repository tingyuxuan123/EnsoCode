import { randomUUID } from 'node:crypto';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { pluginArtifactsFromToolDetails } from '@shared/extensionPlugins/artifacts';
import type { PluginToolResult } from '@shared/extensionPlugins/protocol';
import type { PluginToolDescriptor } from '@shared/extensionPlugins/types';
import type { SessionIdentity } from '@shared/types/agent';
export interface PluginToolInvokeRequest {
  identity: SessionIdentity;
  requestId: string;
  toolName: string;
  fingerprint: string;
  args: Record<string, unknown>;
}
export interface PluginToolInvokeResult {
  requestId: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}
interface Pending {
  settle(value: unknown, cancel?: boolean): void;
  onUpdate?: (partial: { content: [{ type: 'text'; text: string }]; details: undefined }) => void;
}
export class PluginToolInvoker {
  private readonly pending = new Map<string, Pending>();
  constructor(
    private readonly identity: SessionIdentity,
    private readonly emit: (request: PluginToolInvokeRequest) => void,
    private readonly options: { timeoutMs?: number; emitCancel?: (requestId: string) => void } = {}
  ) {}
  invoke(
    toolName: string,
    args: unknown,
    signal?: AbortSignal,
    fingerprint = '',
    hooks?: { timeoutMs?: number; onUpdate?: Pending['onUpdate'] }
  ): Promise<unknown> {
    if (signal?.aborted) return Promise.reject(new Error('Plugin tool aborted'));
    if (!args || typeof args !== 'object' || Array.isArray(args))
      return Promise.reject(new Error('Plugin tool arguments must be an object'));
    const requestId = randomUUID();
    const { promise, resolve, reject } = Promise.withResolvers<unknown>();
    const settle = (value: unknown, cancel = false) => {
      if (!this.pending.delete(requestId)) return;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (cancel) {
        try {
          this.options.emitCancel?.(requestId);
        } catch {
          /* Worker teardown. */
        }
      }
      if (value instanceof Error) reject(value);
      else resolve(value);
    };
    const abort = () => settle(new Error('Plugin tool aborted'), true);
    const timeoutMs = hooks?.timeoutMs ?? this.options.timeoutMs ?? 70_000;
    const timer = setTimeout(
      () => settle(new Error(`Plugin tool ${toolName} timed out after ${timeoutMs}ms`), true),
      timeoutMs
    );
    this.pending.set(requestId, { settle, onUpdate: hooks?.onUpdate });
    signal?.addEventListener('abort', abort, { once: true });
    try {
      this.emit({
        identity: this.identity,
        requestId,
        toolName,
        fingerprint,
        args: args as Record<string, unknown>,
      });
    } catch (e) {
      settle(e instanceof Error ? e : new Error(String(e)));
    }
    return promise;
  }
  resolve(result: PluginToolInvokeResult): boolean {
    const p = this.pending.get(result.requestId);
    if (!p) return false;
    p.settle(result.ok ? result.result : new Error(result.error || 'Plugin tool failed'));
    return true;
  }
  cancelAll(reason = 'Plugin tool cancelled'): void {
    for (const p of [...this.pending.values()]) p.settle(new Error(reason), true);
  }
  progress(requestId: string, text: string): void {
    try {
      this.pending
        .get(requestId)
        ?.onUpdate?.({ content: [{ type: 'text', text }], details: undefined });
    } catch {
      /* Progress is best effort. */
    }
  }
  get pendingCount(): number {
    return this.pending.size;
  }
}
export function createPluginTools(
  descriptors: PluginToolDescriptor[],
  invoker: Pick<PluginToolInvoker, 'invoke'>
): ToolDefinition[] {
  return descriptors.map((d) => ({
    name: d.name,
    label: d.name,
    description: d.description,
    parameters: d.parameters as unknown as ToolDefinition['parameters'],
    ...(d.readOnly ? { annotations: { readOnlyHint: true } } : {}),
    async execute(_id, params, signal, onUpdate) {
      const result = (await invoker.invoke(
        d.name,
        params ?? {},
        signal,
        d.fingerprint,
        ...(d.timeoutMs !== undefined || onUpdate
          ? [{ timeoutMs: (d.timeoutMs ?? 60_000) + 10_000, onUpdate }]
          : [])
      )) as PluginToolResult;
      const artifacts = pluginArtifactsFromToolDetails({ artifacts: result?.artifacts });
      const text = typeof result?.content === 'string' ? result.content : '';
      const line = artifacts.length
        ? `[产出文件] ${artifacts.map((artifact) => `${artifact.name}（${artifact.mime}，${artifact.size}）`).join('、')}`
        : '';
      return {
        content: [
          {
            type: 'text' as const,
            text: line ? (text ? `${text}\n${line}` : line) : text,
          },
        ],
        details: artifacts.length ? { details: result?.details, artifacts } : result?.details,
      };
    },
  }));
}
