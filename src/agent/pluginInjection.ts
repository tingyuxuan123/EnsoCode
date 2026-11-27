import { isSameSessionIdentity, type SessionIdentity } from '@shared/builtinAgents';
import type { AgentCommand, AgentWorkerEvent } from '@shared/types/agent';
import type { PluginEventInvoker } from './pluginEvents';

interface Target {
  identity: SessionIdentity;
  parentId?: string;
  pluginEvents?: PluginEventInvoker;
  session?: { readonly isCompacting: boolean };
  compaction?: 'queued' | 'running';
}
type Receipt = Extract<AgentWorkerEvent, { type: 'plugin-inject-result' }>;

/** Worker-local at-most-once admission; a receipt acknowledges admission, not model completion. */
export class PluginInjectionReceiver<T extends Target> {
  private readonly receipts = new Map<string, Receipt>();
  constructor(
    private readonly lookup: (id: string) => T | undefined,
    private readonly emit: (event: Receipt) => void,
    private readonly failed: (target: T, error: string) => void,
    private readonly maxReceipts = 4096
  ) {
    if (!Number.isSafeInteger(maxReceipts) || maxReceipts < 1)
      throw new RangeError('maxReceipts must be a positive safe integer');
  }
  receive(command: Extract<AgentCommand, { type: 'plugin-inject' }>): void {
    const { identity, requestId } = command;
    // A generation can never be resurrected. Its receipts are no longer needed:
    // a replay of an old command will fail the live-target identity check below.
    for (const [id, receipt] of this.receipts) {
      const live = this.lookup(receipt.identity.sessionId);
      if (!live || !isSameSessionIdentity(receipt.identity, live.identity))
        this.receipts.delete(id);
    }
    const previous = this.receipts.get(requestId);
    if (previous) {
      this.emit(
        isSameSessionIdentity(previous.identity, identity)
          ? previous
          : {
              type: 'plugin-inject-result',
              identity,
              requestId,
              ok: false,
              error: '投递 ID 已绑定其他会话代次',
            }
      );
      return;
    }
    const target = this.lookup(identity.sessionId);
    if (!target || !isSameSessionIdentity(identity, target.identity)) {
      this.emit({
        type: 'plugin-inject-result',
        identity,
        requestId,
        ok: false,
        error: '会话不存在或代次已变化',
      });
      return;
    }
    // Never LRU-evict a live receipt: that would make an executable old ID new again.
    // Capacity rejections have not executed anything and need no retained receipt.
    if (this.receipts.size >= this.maxReceipts) {
      this.emit({
        type: 'plugin-inject-result',
        identity,
        requestId,
        ok: false,
        error: '当前 worker 的活跃投递回执已达上限，拒绝新投递',
      });
      return;
    }
    const result =
      target.parentId || !target.pluginEvents
        ? { ok: false as const, error: '目标会话不支持注入或尚未就绪' }
        : target.compaction === 'running' || target.session?.isCompacting
          ? { ok: false as const, error: '会话正在压缩，拒绝注入；请等待压缩结束后重新发起' }
          : target.pluginEvents.deliver(command, (error) => {
              if (this.lookup(identity.sessionId) === target) this.failed(target, error);
            });
    const receipt: Receipt = { type: 'plugin-inject-result', identity, requestId, ...result };
    this.receipts.set(requestId, receipt);
    this.emit(receipt);
  }
}
