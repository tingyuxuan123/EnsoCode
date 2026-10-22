import { type CodeSearchConfig, parseCodeSearchConfig } from '@shared/codeSearch';

interface Job {
  sessionId: string;
  controller: AbortController;
  start(): void;
}

const cancelled = () => new Error('Code search cancelled or timed out.');

export class CodeSearchHost {
  private config?: CodeSearchConfig;
  private readonly jobs = new Set<Job>();
  private readonly queue: Job[] = [];
  private readonly activeSessions = new Set<string>();
  private active = 0;

  constructor(private readonly limit = 2) {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('Invalid search concurrency.');
  }

  get accountKey(): string | null {
    return this.config?.accountKey ?? null;
  }

  configure(input: CodeSearchConfig): void {
    const config = parseCodeSearchConfig(input);
    if (!config || (this.config && config.revision <= this.config.revision)) return;
    this.config = config;
    for (const job of this.jobs) job.controller.abort();
  }

  pendingCount(sessionId: string): number {
    return [...this.jobs].filter((job) => job.sessionId === sessionId).length;
  }

  cancelSession(sessionId: string): void {
    for (const job of this.jobs) if (job.sessionId === sessionId) job.controller.abort();
  }

  private pump(): void {
    while (this.active < this.limit) {
      const index = this.queue.findIndex((job) => !this.activeSessions.has(job.sessionId));
      if (index < 0) return;
      const job = this.queue.splice(index, 1)[0];
      if (job) job.start();
    }
  }

  run<T>(
    sessionId: string,
    caller: AbortSignal | undefined,
    action: (key: string, signal: AbortSignal) => Promise<T>
  ): Promise<T> {
    const key = this.accountKey;
    if (!key)
      return Promise.reject(new Error('Select a logged-in Devin account in code search settings.'));
    if (caller?.aborted) return Promise.reject(cancelled());
    if (this.jobs.size >= 64)
      return Promise.reject(new Error('Code search queue is full. Retry later.'));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 90_000);
    const onCallerAbort = () => controller.abort();
    caller?.addEventListener('abort', onCallerAbort, { once: true });
    return new Promise<T>((resolve, reject) => {
      let started = false;
      const cleanup = () => {
        clearTimeout(timer);
        caller?.removeEventListener('abort', onCallerAbort);
        controller.signal.removeEventListener('abort', onAbort);
      };
      const onAbort = () => {
        reject(cancelled());
        cleanup();
        if (!started) {
          this.jobs.delete(job);
          const index = this.queue.indexOf(job);
          if (index >= 0) this.queue.splice(index, 1);
          this.pump();
        }
      };
      const job: Job = {
        sessionId,
        controller,
        start: () => {
          started = true;
          this.active++;
          this.activeSessions.add(sessionId);
          // A cancelled caller gets a prompt rejection, but the physical slot remains
          // occupied until I/O really settles. Never overlap a replacement on abort alone.
          void Promise.resolve()
            .then(() => {
              if (controller.signal.aborted) throw cancelled();
              return action(key, controller.signal);
            })
            .then((value) => {
              if (controller.signal.aborted) reject(cancelled());
              else resolve(value);
            }, reject)
            .finally(() => {
              cleanup();
              this.jobs.delete(job);
              this.active--;
              this.activeSessions.delete(sessionId);
              this.pump();
            });
        },
      };
      controller.signal.addEventListener('abort', onAbort, { once: true });
      this.jobs.add(job);
      this.queue.push(job);
      this.pump();
    });
  }
}
