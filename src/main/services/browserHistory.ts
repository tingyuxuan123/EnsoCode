import { randomUUID } from 'node:crypto';
import {
  closeSync,
  constants,
  fstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { assertAllowedUrl } from '@shared/browser/urlPolicy';
import type { BrowserHistoryEntry } from '@shared/types/browser';

const MAX_ENTRIES = 10_000;
const MAX_FILE_BYTES = 32 * 1024 * 1024;

export interface BrowserStoreQuery {
  query?: string;
  offset?: number;
  limit?: number;
}

export function browserHttpUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 16_384) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    return assertAllowedUrl(url.href).href;
  } catch {
    return undefined;
  }
}

export function browserStoreId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 512 &&
    !Array.from(value).some(
      (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127
    )
  );
}

export function browserStoreObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function browserStoreNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export function browserStorePage<T>(
  items: T[],
  query: BrowserStoreQuery
): { items: T[]; total: number } {
  const offset = Number.isFinite(query.offset) ? Math.max(0, Math.floor(query.offset ?? 0)) : 0;
  const limit = Number.isFinite(query.limit)
    ? Math.min(200, Math.max(1, Math.floor(query.limit ?? 50)))
    : 50;
  return {
    items: items.slice(offset, offset + limit).map((item) => ({ ...item })),
    total: items.length,
  };
}

export class BrowserDataFile {
  private dirty = false;
  private scheduled = false;

  constructor(
    private readonly filePath: string,
    private readonly snapshot: () => unknown
  ) {}

  read(): unknown {
    let fd: number | undefined;
    try {
      fd = openSync(this.filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
      const stat = fstatSync(fd);
      if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return undefined;
      return JSON.parse(readFileSync(fd, 'utf8')) as unknown;
    } catch {
      return undefined;
    } finally {
      if (fd !== undefined) closeSync(fd);
    }
  }

  changed(): void {
    this.dirty = true;
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      try {
        this.flush();
      } catch {
        // Keep dirty state so an explicit flush can retry and report the failure.
      }
    });
  }

  flush(): void {
    if (!this.dirty) return;
    const data = JSON.stringify(this.snapshot());
    if (Buffer.byteLength(data) > MAX_FILE_BYTES)
      throw new Error('Browser store exceeds size limit');
    mkdirSync(dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, data, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      renameSync(temporary, this.filePath);
      this.dirty = false;
    } finally {
      rmSync(temporary, { force: true });
    }
  }
}

function parseHistory(value: unknown): BrowserHistoryEntry | undefined {
  const row = browserStoreObject(value);
  const url = browserHttpUrl(row?.url);
  if (
    !row ||
    !url ||
    !browserStoreId(row.id) ||
    !browserStoreId(row.conversationId) ||
    !browserStoreId(row.tabId) ||
    typeof row.title !== 'string' ||
    row.title.length > 1024 ||
    !browserStoreNumber(row.visitedAt)
  )
    return undefined;
  return {
    id: row.id,
    conversationId: row.conversationId,
    tabId: row.tabId,
    url,
    title: row.title,
    visitedAt: row.visitedAt,
  };
}

export class BrowserHistoryStore {
  private items: BrowserHistoryEntry[] = [];
  private readonly latestByTab = new Map<string, string>();
  private readonly file: BrowserDataFile;
  private readonly limit: number;

  constructor(options: { filePath: string; limit?: number }) {
    this.limit = Number.isFinite(options.limit)
      ? Math.min(MAX_ENTRIES, Math.max(1, Math.floor(options.limit ?? MAX_ENTRIES)))
      : MAX_ENTRIES;
    this.file = new BrowserDataFile(options.filePath, () => ({ version: 1, items: this.items }));
    const data = browserStoreObject(this.file.read());
    if (data?.version !== 1 || !Array.isArray(data.items)) return;
    const ids = new Set<string>();
    for (const raw of data.items.slice(0, MAX_ENTRIES)) {
      const entry = parseHistory(raw);
      if (!entry || ids.has(entry.id)) continue;
      ids.add(entry.id);
      this.items.push(entry);
    }
    this.trim();
  }

  record(entry: {
    conversationId: string;
    tabId: string;
    url: string;
    title: string;
    at?: number;
  }): void {
    if (!browserStoreId(entry.conversationId) || !browserStoreId(entry.tabId)) return;
    const key = JSON.stringify([entry.conversationId, entry.tabId]);
    const url = browserHttpUrl(entry.url);
    if (!url) {
      this.latestByTab.delete(key);
      return;
    }
    const visitedAt = browserStoreNumber(entry.at) ? entry.at : Date.now();
    const title = typeof entry.title === 'string' ? entry.title.slice(0, 1024) : '';
    const previous = this.items.find((item) => item.id === this.latestByTab.get(key));
    if (previous?.url === url) {
      previous.title = title;
      previous.visitedAt = visitedAt;
    } else {
      const item = {
        id: randomUUID(),
        conversationId: entry.conversationId,
        tabId: entry.tabId,
        url,
        title,
        visitedAt,
      };
      this.items.push(item);
      this.latestByTab.set(key, item.id);
    }
    this.trim();
    this.file.changed();
  }

  query(
    conversationId: string,
    query: BrowserStoreQuery = {}
  ): { items: BrowserHistoryEntry[]; total: number } {
    const needle = typeof query.query === 'string' ? query.query.trim().toLowerCase() : '';
    const items = this.items.filter(
      (item) =>
        item.conversationId === conversationId &&
        (!needle ||
          item.url.toLowerCase().includes(needle) ||
          item.title.toLowerCase().includes(needle))
    );
    items.sort((a, b) => b.visitedAt - a.visitedAt);
    return browserStorePage(items, query);
  }

  remove(conversationId: string, id: string): void {
    const remaining = this.items.filter(
      (item) => item.conversationId !== conversationId || item.id !== id
    );
    if (remaining.length === this.items.length) return;
    this.items = remaining;
    this.pruneTabs();
    this.file.changed();
  }

  clear(conversationId: string): void {
    const remaining = this.items.filter((item) => item.conversationId !== conversationId);
    if (remaining.length === this.items.length) return;
    this.items = remaining;
    this.pruneTabs();
    this.file.changed();
  }

  async flush(): Promise<void> {
    this.file.flush();
  }

  private trim(): void {
    this.items.sort((a, b) => b.visitedAt - a.visitedAt);
    this.items = this.items.slice(0, this.limit);
    this.pruneTabs();
  }

  private pruneTabs(): void {
    const ids = new Set(this.items.map((item) => item.id));
    for (const [key, id] of this.latestByTab) if (!ids.has(id)) this.latestByTab.delete(key);
  }
}
