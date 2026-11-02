import { randomUUID } from 'node:crypto';
import { type FSWatcher, watch } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { DesignWatchRequest, DesignWatchResponse } from '@shared/types/design';
import { IPC_CHANNELS } from '@shared/types/ipc';
import { DesignServiceError } from './errors';
import { resolveDesignRoot } from './roots';
import { checkedPath } from './security';

interface Watch {
  owner: number;
  watcher: FSWatcher;
  timer?: NodeJS.Timeout;
}
export class DesignWatchService {
  private readonly watches = new Map<string, Watch>();
  private readonly closed = new Set<number>();
  private disposed = false;
  constructor(private readonly send: (owner: number, channel: string, event: unknown) => void) {}
  async start(owner: number, request: DesignWatchRequest): Promise<DesignWatchResponse> {
    if (this.watches.size >= 128)
      throw new DesignServiceError('FAILED', 'Design watch limit reached');
    const root = await resolveDesignRoot(request.root);
    const file = await checkedPath(root.path, request.rel);
    if (!(await stat(file)).isDirectory())
      throw new DesignServiceError('INVALID_ARGUMENT', 'Watch target must be a directory');
    if (this.disposed || this.closed.has(owner))
      throw new DesignServiceError('ABORTED', 'Design owner closed');
    const watchId = randomUUID();
    const entry: Watch = {
      owner,
      watcher: watch(file, { recursive: true }, () => {
        if (entry.timer) clearTimeout(entry.timer);
        entry.timer = setTimeout(
          () => this.send(owner, IPC_CHANNELS.DESIGN_WATCH_EVENT, { watchId }),
          150
        );
        entry.timer.unref();
      }),
    };
    entry.watcher.on('error', () => this.stop(owner, watchId));
    this.watches.set(watchId, entry);
    return { ok: true, watchId };
  }
  stop(owner: number, watchId: string): void {
    const entry = this.watches.get(watchId);
    if (!entry || entry.owner !== owner) return;
    if (entry.timer) clearTimeout(entry.timer);
    entry.watcher.close();
    this.watches.delete(watchId);
  }
  releaseOwner(owner: number): void {
    this.closed.add(owner);
    for (const [id, entry] of this.watches) if (entry.owner === owner) this.stop(owner, id);
  }
  dispose(): void {
    this.disposed = true;
    for (const [id, entry] of this.watches) this.stop(entry.owner, id);
  }
}
