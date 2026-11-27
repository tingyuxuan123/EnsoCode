import { randomUUID } from 'node:crypto';
import {
  isSameSessionIdentity as isSameGeneration,
  type SessionIdentity,
} from '@shared/builtinAgents';
import type { AgentCommand, AgentWorkerEvent } from '@shared/types/agent';
import type { SessionAttempt } from './gate';
import type { PluginSessionBridge } from './service';

/** Like reload/agent-run brokers: post is transport only, exact-generation worker receipt is success. */
export class PluginInjectionRequests {
  private readonly pending = new Map<
    string,
    { identity: SessionIdentity; finish(result: SessionAttempt): void }
  >();
  constructor(
    private readonly post: (command: AgentCommand) => { ok: boolean; error?: string },
    private readonly lookup: (sessionId: string) => SessionIdentity | undefined,
    private readonly timeoutMs = 15_000
  ) {}
  inject(
    identity: SessionIdentity,
    message: Parameters<PluginSessionBridge['inject']>[1],
    signal?: AbortSignal
  ): Promise<SessionAttempt> {
    if (signal?.aborted) return Promise.resolve({ ok: false, error: '注入已取消' });
    const requestId = randomUUID();
    return new Promise((resolve) => {
      const finish = (result: SessionAttempt) => {
        if (!this.pending.delete(requestId)) return;
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        resolve(result);
      };
      const abort = () => finish({ ok: false, error: '注入已取消，投递状态未知，请勿自动重试' });
      const timer = setTimeout(
        () => finish({ ok: false, error: '等待 worker 接收超时，投递状态未知，请勿自动重试' }),
        this.timeoutMs
      );
      this.pending.set(requestId, { identity: { ...identity }, finish });
      signal?.addEventListener('abort', abort, { once: true });
      try {
        const sent = this.post({
          type: 'plugin-inject',
          identity: { sessionId: identity.sessionId, generation: identity.generation },
          requestId,
          pluginId: message.pluginId,
          pluginName: message.pluginName,
          text: message.text,
          ...(message.images.length ? { images: message.images } : {}),
          deliverAs: message.deliverAs,
          triggerTurn: message.triggerTurn,
        });
        if (!sent.ok) finish({ ok: false, error: sent.error ?? '无法下发注入' });
      } catch (error) {
        finish({ ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    });
  }
  settle(event: AgentWorkerEvent): boolean {
    if (event.type !== 'plugin-inject-result') {
      if (
        event.type === 'parent-ended' ||
        event.type === 'parent-rejected' ||
        event.type === 'parent-ready'
      ) {
        for (const entry of this.pending.values()) {
          if (
            entry.identity.sessionId === event.identity.sessionId &&
            (event.type === 'parent-ready'
              ? !isSameGeneration(entry.identity, event.identity)
              : isSameGeneration(entry.identity, event.identity))
          )
            entry.finish({ ok: false, error: '会话已退出或换代，无法确认投递' });
        }
      }
      return false;
    }
    const entry = this.pending.get(event.requestId);
    if (!entry || !isSameGeneration(entry.identity, event.identity)) return true;
    const live = this.lookup(entry.identity.sessionId);
    entry.finish(
      !live || !isSameGeneration(live, entry.identity)
        ? { ok: false, error: '会话代次已变化，无法确认投递' }
        : event.ok
          ? { ok: true }
          : { ok: false, error: event.error ?? 'worker 拒绝注入' }
    );
    return true;
  }
  failAll(error: string): void {
    for (const entry of this.pending.values()) entry.finish({ ok: false, error });
  }
}
