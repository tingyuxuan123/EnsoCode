import { randomUUID } from 'node:crypto';
import type { SessionIdentity } from '@shared/builtinAgents';
import type { SuperAssistantSnapshot, SuperAssistantTask } from '@shared/superAssistant';
import { parseSuperAssistantRequest } from '@shared/superAssistantProtocol';
import type { AgentActionResult, AgentWorkerEvent } from '@shared/types/agent';

export interface SuperAssistantTarget {
  projectId: string;
  projectName: string;
  conversationId: string;
  title: string;
}
interface Options {
  coordinator(): string | undefined;
  current(id: string): SessionIdentity | undefined;
  list(): SuperAssistantTarget[];
  projects?(): { projectId: string; projectName: string }[];
  create(projectId: string, title: string): string;
  history(id: string, limit?: number): Promise<unknown>;
  busy(id: string): boolean;
  prepare(id: string): Promise<SessionIdentity>;
  prompt(identity: SessionIdentity, text: string, deliveryId: string): AgentActionResult;
  abort(identity: SessionIdentity, deliveryId: string): AgentActionResult;
  changed(snapshot: SuperAssistantSnapshot): void;
  terminal?(task: SuperAssistantTask): void;
  persist?(tasks: SuperAssistantTask[]): void;
  restored?: SuperAssistantTask[];
}
interface Delivery {
  identity: SessionIdentity;
  acknowledged: boolean;
  lastSeq: number;
  cancelRequested?: boolean;
}
const terminal = (task: SuperAssistantTask) =>
  ['finished', 'failed', 'canceled'].includes(task.status);

/** Main owns admission, queue and terminal receipts. Idle is not a completion receipt. */
export class SuperAssistantHost {
  private tasks: SuperAssistantTask[];
  private deliveries = new Map<string, Delivery>();
  private pumping = new Set<string>();
  constructor(private readonly options: Options) {
    this.tasks = (options.restored ?? []).map((task) =>
      terminal(task)
        ? task
        : {
            ...task,
            status: 'failed',
            error: 'Interrupted by application restart; delivery was not replayed.',
            updatedAt: Date.now(),
          }
    );
    options.persist?.(this.tasks);
  }
  snapshot(): SuperAssistantSnapshot {
    return {
      ok: true,
      conversationId: this.options.coordinator(),
      tasks: this.tasks.map((task) => ({ ...task })),
    };
  }
  private changed(): void {
    this.options.persist?.(this.tasks);
    this.options.changed(this.snapshot());
  }
  async invoke(
    identity: SessionIdentity,
    input: unknown,
    signal?: AbortSignal
  ): Promise<{ ok: boolean; value?: unknown; error?: string }> {
    const current = this.options.current(identity.sessionId);
    if (
      'parent' in identity ||
      identity.sessionId !== this.options.coordinator() ||
      current?.generation !== identity.generation
    )
      return { ok: false, error: 'Coordinator root generation required.' };
    const request = parseSuperAssistantRequest(input);
    if (!request) return { ok: false, error: 'Invalid coordinator request.' };
    try {
      signal?.throwIfAborted();
      switch (request.operation) {
        case 'list':
        case 'search': {
          const query = request.operation === 'search' ? request.query.toLocaleLowerCase() : '';
          const limit = request.limit ?? 30;
          const projects = (this.options.projects?.() ?? []).filter((item) =>
            `${item.projectName} ${item.projectId}`.toLocaleLowerCase().includes(query)
          );
          const conversations = this.options
            .list()
            .filter((item) =>
              `${item.title} ${item.projectName} ${item.conversationId}`
                .toLocaleLowerCase()
                .includes(query)
            );
          return {
            ok: true,
            value: {
              projects: projects.slice(0, limit),
              conversations: conversations.slice(0, limit),
            },
          };
        }
        case 'status': {
          const snapshot = this.snapshot();
          return {
            ok: true,
            value:
              request.taskId === undefined
                ? snapshot
                : (snapshot.tasks.find((task) => task.id === request.taskId) ?? null),
          };
        }
        case 'cancel':
          return this.cancel(request.taskId);
        case 'history': {
          if (
            !this.options.list().some((target) => target.conversationId === request.conversationId)
          )
            throw new Error('Ordinary local conversation required.');
          const value = await this.options.history(request.conversationId, request.limit);
          signal?.throwIfAborted();
          return { ok: true, value };
        }
        case 'dispatch': {
          if (this.tasks.filter((task) => !terminal(task)).length >= 100)
            throw new Error('Task queue is full.');
          const title =
            typeof request.title === 'string' ? request.title : request.prompt.slice(0, 80);
          const conversationId =
            request.conversationId === undefined
              ? this.options.create(request.projectId, title)
              : request.conversationId;
          const target = this.options
            .list()
            .find(
              (entry) =>
                entry.conversationId === conversationId && entry.projectId === request.projectId
            );
          if (!target) throw new Error('Ordinary local conversation required.');
          const now = Date.now();
          const task: SuperAssistantTask = {
            ...target,
            id: randomUUID(),
            title,
            prompt: request.prompt,
            status: 'queued',
            createdAt: now,
            updatedAt: now,
          };
          this.tasks.push(task);
          this.changed();
          void this.pump(target.conversationId);
          return { ok: true, value: { ...task } };
        }
        default:
          throw new Error('Unknown coordinator operation.');
      }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
  cancel(taskId: unknown): AgentActionResult {
    const task = this.tasks.find((entry) => entry.id === taskId);
    if (!task || terminal(task)) return { ok: false, error: 'Task is not active.' };
    const delivery = this.deliveries.get(task.id);
    if (delivery && !delivery.acknowledged)
      return {
        ok: false,
        error: 'Waiting for target delivery receipt; retry cancel once accepted.',
      };
    if (delivery) {
      if (delivery.cancelRequested) return { ok: true };
      if (this.options.current(task.conversationId)?.generation !== delivery.identity.generation)
        return { ok: false, error: 'Target generation changed.' };
      const result = this.options.abort(delivery.identity, task.id);
      if (result.ok) delivery.cancelRequested = true;
      return result;
    }
    task.status = 'canceled';
    task.updatedAt = Date.now();
    this.changed();
    this.options.terminal?.(task);
    if (!delivery) void this.pump(task.conversationId);
    return { ok: true };
  }
  private async pump(id: string): Promise<void> {
    if (
      this.pumping.has(id) ||
      [...this.deliveries.values()].some((delivery) => delivery.identity.sessionId === id)
    )
      return;
    const task = this.tasks.find(
      (entry) => entry.conversationId === id && entry.status === 'queued'
    );
    if (!task || this.options.busy(id)) return;
    this.pumping.add(id);
    try {
      const identity = await this.options.prepare(id);
      if (task.status !== 'queued') return;
      if (this.options.busy(id)) return;
      this.deliveries.set(task.id, { identity, acknowledged: false, lastSeq: -1 });
      const result = this.options.prompt(identity, task.prompt, task.id);
      if (!result.ok) throw new Error(result.error ?? 'Dispatch rejected.');
    } catch (error) {
      if (!terminal(task)) {
        task.status = 'failed';
        task.error = error instanceof Error ? error.message : String(error);
        task.updatedAt = Date.now();
        this.options.terminal?.(task);
      }
      this.deliveries.delete(task.id);
    } finally {
      this.pumping.delete(id);
      this.changed();
      if (terminal(task)) void this.pump(id);
    }
  }
  observe(event: AgentWorkerEvent | { type: 'worker-exited' }, workspaceRoot?: string): void {
    if (event.type === 'worker-exited') {
      for (const task of this.tasks)
        if (!terminal(task)) {
          task.status = 'failed';
          task.error = 'Worker interrupted; delivery was not replayed.';
          task.updatedAt = Date.now();
        }
      this.deliveries.clear();
      this.changed();
      return;
    }
    if (!('identity' in event)) return;
    if ('parent' in event.identity) {
      if (
        (event.type === 'status' && event.status === 'idle') ||
        event.type === 'turn-completed' ||
        event.type === 'turn-failed' ||
        event.type === 'child-ended' ||
        event.type === 'child-rejected' ||
        event.type === 'child-ready'
      )
        void this.pump(workspaceRoot ?? event.identity.parent.sessionId);
      return;
    }
    const id = event.identity.sessionId;
    for (const task of this.tasks) {
      const delivery = this.deliveries.get(task.id);
      if (
        !delivery ||
        delivery.identity.sessionId !== id ||
        delivery.identity.generation !== event.identity.generation ||
        !('seq' in event) ||
        event.seq <= delivery.lastSeq
      )
        continue;
      delivery.lastSeq = event.seq;
      const previousStatus = task.status;
      const lifecycleEnd = event.type === 'parent-ended' || event.type === 'parent-rejected';
      if (event.type === 'delivery-settled' && event.deliveryId === task.id) {
        delivery.acknowledged = true;
        task.status = 'running';
      }
      if (event.type === 'delivery-deferred' && event.deliveryId === task.id)
        this.deliveries.delete(task.id);
      if ((event.type === 'delivery-rejected' && event.deliveryId === task.id) || lifecycleEnd) {
        task.status = 'failed';
        task.error = 'Target delivery interrupted or rejected.';
      }
      if (event.type === 'delivery-aborted' && event.deliveryId === task.id)
        task.status = 'canceled';
      if (
        delivery.acknowledged &&
        (event.type === 'turn-completed' || event.type === 'turn-failed')
      ) {
        task.status =
          event.type === 'turn-failed' || event.requestBudgetStop ? 'failed' : 'finished';
        if (event.type === 'turn-failed') task.error = event.error;
        else {
          task.summary = event.digest?.assistantText.slice(-12_000);
          task.error = event.requestBudgetError;
        }
      }
      if (
        delivery.acknowledged &&
        (event.type === 'approval-request' || event.type === 'ask-request')
      )
        task.status = 'waiting';
      if (
        (event.type === 'approval-resolved' || event.type === 'ask-resolved') &&
        task.status === 'waiting'
      )
        task.status = 'running';
      if (terminal(task)) this.deliveries.delete(task.id);
      if (task.status !== previousStatus) {
        task.updatedAt = Date.now();
        this.changed();
        if (terminal(task)) this.options.terminal?.(task);
      }
    }
    if (
      (event.type === 'status' && event.status === 'idle') ||
      event.type === 'turn-completed' ||
      event.type === 'turn-failed' ||
      event.type === 'parent-ready' ||
      event.type === 'delivery-rejected' ||
      event.type === 'delivery-aborted' ||
      (event.type === 'compaction' && event.state === 'end')
    )
      void this.pump(id);
  }
}
