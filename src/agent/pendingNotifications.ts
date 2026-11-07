import { randomUUID } from 'node:crypto';
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { REMINDER_QUEUE_LIMIT } from './reminderQueue';

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_TEXT_CHARS = 64_000;

function fileName(sessionId: string): string | null {
  if (!/^[A-Za-z0-9._:-]{1,160}$/.test(sessionId) || sessionId === '.' || sessionId === '..')
    return null;
  const name = `${encodeURIComponent(sessionId)}.json`;
  return Buffer.byteLength(name) <= 240 ? name : null;
}

function bounded(texts: unknown): string[] {
  if (!Array.isArray(texts)) return [];
  const result: string[] = [];
  let bytes = 2;
  for (let i = texts.length - 1; i >= 0 && result.length < REMINDER_QUEUE_LIMIT; i--) {
    const raw = texts[i];
    if (typeof raw !== 'string' || !raw.trim()) continue;
    const text = raw.slice(0, MAX_TEXT_CHARS);
    const size = Buffer.byteLength(JSON.stringify(text)) + 1;
    if (bytes + size > MAX_BYTES) break;
    result.push(text);
    bytes += size;
  }
  return result.reverse();
}

/** Best-effort 未投递通知。侧文件不是任务账本，不承诺恢复进程或严格一次投递。 */
export class PendingNotificationStore {
  constructor(private readonly dir: string) {}

  private directory(create = false): boolean {
    try {
      if (create) mkdirSync(this.dir, { recursive: true, mode: 0o700 });
      return lstatSync(this.dir).isDirectory();
    } catch {
      return false;
    }
  }

  load(sessionId: string): string[] {
    const name = fileName(sessionId);
    if (!name || !this.directory()) return [];
    let fd: number | undefined;
    try {
      const file = path.join(this.dir, name);
      const before = lstatSync(file, { bigint: true });
      // O_NOFOLLOW is unavailable on Windows; never follow a linked leaf there either.
      if (before.isSymbolicLink() || !before.isFile()) return [];
      fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
      const stat = fstatSync(fd, { bigint: true });
      if (
        !stat.isFile() ||
        stat.dev !== before.dev ||
        stat.ino !== before.ino ||
        stat.size > BigInt(MAX_BYTES)
      )
        return [];
      // 即使检查后文件继续增长，也只读取有界内容。
      const size = Number(stat.size);
      const buffer = Buffer.alloc(size + 1);
      const bytes = readSync(fd, buffer, 0, buffer.length, 0);
      if (bytes > size) return [];
      return bounded(JSON.parse(buffer.subarray(0, bytes).toString('utf8')));
    } catch {
      return [];
    } finally {
      if (fd !== undefined) closeSync(fd);
    }
  }

  save(sessionId: string, texts: readonly string[]): void {
    const name = fileName(sessionId);
    if (!name || !this.directory(texts.length > 0)) return;
    const file = path.join(this.dir, name);
    const tmp = `${file}.${randomUUID()}.tmp`;
    try {
      const value = bounded(texts);
      if (value.length === 0) {
        rmSync(file, { force: true });
        return;
      }
      writeFileSync(tmp, JSON.stringify(value), { flag: 'wx', mode: 0o600 });
      renameSync(tmp, file);
    } catch (error) {
      console.warn(`[notify] failed to persist notifications for ${sessionId}:`, error);
    } finally {
      try {
        rmSync(tmp, { force: true });
      } catch {
        /* best-effort */
      }
    }
  }
}
