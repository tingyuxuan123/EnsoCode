import fs from 'node:fs';
import path from 'node:path';

interface WatchEntry {
  spaceId: string;
  rootPath: string;
  watcher: fs.FSWatcher;
  timer: NodeJS.Timeout | null;
}

const DEBOUNCE_MS = 350;
const SELF_WRITE_IGNORE_MS = 800;

/**
 * 轻量监听已绑定或活跃的 Vault 目录：用户在 Obsidian 里编辑、重命名或删除 `.md` 时自动增量重索引并刷新 UI。
 * 通过短窗口 self-write 标记抑制 Collabra 自身写盘引起的重复回扫。
 */
export class VaultWatcherManager {
  private readonly entries = new Map<string, WatchEntry>();
  private readonly selfWriteUntil = new Map<string, number>();

  constructor(private readonly onExternalChange: (spaceId: string, rootPath: string) => void) {}

  markSelfWrite(rootPath: string): void {
    const key = path.resolve(rootPath);
    this.selfWriteUntil.set(key, Date.now() + SELF_WRITE_IGNORE_MS);
  }

  watch(spaceId: string, rootPath: string): void {
    const resolved = path.resolve(rootPath);
    const existing = this.entries.get(spaceId);
    if (existing) {
      if (existing.rootPath === resolved) return;
      this.unwatch(spaceId);
    }
    if (!fs.existsSync(resolved)) return;
    try {
      const watcher = fs.watch(
        resolved,
        { recursive: process.platform === 'darwin' || process.platform === 'win32' },
        (_event, filename) => {
          if (typeof filename === 'string') {
            const normalized = filename.replace(/\\/g, '/');
            if (
              normalized.startsWith('.obsidian/') ||
              normalized.startsWith('.git/') ||
              normalized.endsWith('.tmp')
            ) {
              return;
            }
          }
          const until = this.selfWriteUntil.get(resolved) ?? 0;
          if (Date.now() < until) return;

          const entry = this.entries.get(spaceId);
          if (!entry) return;
          if (entry.timer) clearTimeout(entry.timer);
          entry.timer = setTimeout(() => {
            entry.timer = null;
            this.onExternalChange(spaceId, resolved);
          }, DEBOUNCE_MS);
        }
      );
      watcher.on('error', () => {
        this.unwatch(spaceId);
      });
      this.entries.set(spaceId, { spaceId, rootPath: resolved, watcher, timer: null });
    } catch {
      // fs.watch on some filesystems/platforms may fail silently; manual & on-access sync still work
    }
  }

  unwatch(spaceId: string): void {
    const entry = this.entries.get(spaceId);
    if (!entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    try {
      entry.watcher.close();
    } catch {}
    this.entries.delete(spaceId);
  }

  closeAll(): void {
    for (const id of [...this.entries.keys()]) this.unwatch(id);
    this.selfWriteUntil.clear();
  }
}
