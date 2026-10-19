import { randomUUID } from 'node:crypto';
import { closeSync, constants, lstatSync, mkdirSync, openSync, realpathSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import type { BrowserDownloadEntry } from '@shared/types/browser';
import { type DownloadItem, shell } from 'electron';
import {
  BrowserDataFile,
  type BrowserStoreQuery,
  browserHttpUrl,
  browserStoreId,
  browserStoreNumber,
  browserStoreObject,
  browserStorePage,
} from './browserHistory';

const MAX_ENTRIES = 1000;
const RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const STATES = new Set(['progressing', 'paused', 'completed', 'cancelled', 'interrupted']);

type DownloadAction = 'pause' | 'resume' | 'cancel' | 'remove' | 'reveal';
interface ActiveDownload {
  item: DownloadItem;
  updated: (event: Electron.Event, state: string) => void;
  done: (event: Electron.Event, state: string) => void;
}
interface DirectoryIdentity {
  path: string;
  dev: number;
  ino: number;
}

function truncateName(value: string, bytes: number): string {
  let result = '';
  for (const character of value) {
    if (Buffer.byteLength(result + character) > bytes) break;
    result += character;
  }
  return result;
}

function unsafeFilenameCharacter(character: string): boolean {
  const code = character.charCodeAt(0);
  return code < 32 || code === 127 || /[\\/:*?"<>|\u202a-\u202e\u2066-\u2069]/.test(character);
}

function safeFilename(raw: string): string {
  let name = Array.from(basename(raw.replace(/\\/g, '/')).normalize('NFC'))
    .map((character) => (unsafeFilenameCharacter(character) ? '_' : character))
    .join('')
    .replace(/^[.\s]+|[.\s]+$/g, '');
  if (!name) name = 'download';
  if (RESERVED_NAME.test(name)) name = `_${name}`;
  const extension = truncateName(extname(name), 30);
  const stem = name.slice(0, name.length - extname(name).length);
  return `${truncateName(stem, 180 - Buffer.byteLength(extension))}${extension}`;
}

function validFilename(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    Buffer.byteLength(value) <= 240 &&
    value !== '.' &&
    value !== '..' &&
    !/^[.\s]|[.\s]$/.test(value) &&
    !Array.from(value).some(unsafeFilenameCharacter) &&
    !RESERVED_NAME.test(value)
  );
}

function parseDownload(value: unknown): BrowserDownloadEntry | undefined {
  const row = browserStoreObject(value);
  const url = browserHttpUrl(row?.url);
  if (
    !row ||
    !url ||
    !browserStoreId(row.id) ||
    !browserStoreId(row.conversationId) ||
    !browserStoreId(row.tabId) ||
    !validFilename(row.filename) ||
    !browserStoreNumber(row.receivedBytes) ||
    !browserStoreNumber(row.totalBytes) ||
    !browserStoreNumber(row.startedAt) ||
    !browserStoreNumber(row.updatedAt) ||
    typeof row.state !== 'string' ||
    !STATES.has(row.state)
  )
    return undefined;
  const state = row.state as BrowserDownloadEntry['state'];
  return {
    id: row.id,
    conversationId: row.conversationId,
    tabId: row.tabId,
    url,
    filename: row.filename,
    receivedBytes: row.receivedBytes,
    totalBytes: row.totalBytes,
    startedAt: row.startedAt,
    updatedAt: row.updatedAt,
    state,
    ...(typeof row.error === 'string' ? { error: row.error.slice(0, 300) } : {}),
  };
}

function safeBytes(value: number): number {
  return browserStoreNumber(value) ? value : 0;
}

export class BrowserDownloads {
  private readonly items = new Map<string, BrowserDownloadEntry>();
  private readonly active = new Map<string, ActiveDownload>();
  private readonly accepted = new WeakSet<DownloadItem>();
  private readonly file: BrowserDataFile;
  private readonly downloadDir: string;
  private directory?: DirectoryIdentity;
  private disposed = false;

  constructor(
    private readonly options: {
      filePath: string;
      downloadDir: string;
      onChange?: (conversationId: string) => void;
    }
  ) {
    this.downloadDir = resolve(options.downloadDir);
    this.file = new BrowserDataFile(options.filePath, () => ({
      version: 1,
      items: [...this.items.values()],
    }));
    const data = browserStoreObject(this.file.read());
    if (data?.version !== 1 || !Array.isArray(data.items)) return;
    let interrupted = false;
    for (const raw of data.items.slice(0, MAX_ENTRIES)) {
      const entry = parseDownload(raw);
      if (!entry || this.items.has(entry.id)) continue;
      if (entry.state === 'progressing' || entry.state === 'paused') {
        entry.state = 'interrupted';
        entry.error = 'Download interrupted by application restart';
        entry.updatedAt = Date.now();
        interrupted = true;
      }
      this.items.set(entry.id, entry);
    }
    if (interrupted) this.file.changed();
  }

  accept(item: DownloadItem, owner: { conversationId: string; tabId: string; url?: string }): void {
    if (this.accepted.has(item)) return;
    try {
      if (this.disposed) throw new Error('Browser downloads manager is disposed');
      if (!browserStoreId(owner.conversationId) || !browserStoreId(owner.tabId))
        throw new Error('Invalid download owner');
      const url = browserHttpUrl(item.getURL() || owner.url);
      if (!url) throw new Error('Only credential-free HTTP(S) downloads are allowed');
      if (this.active.size >= MAX_ENTRIES) throw new Error('Too many active browser downloads');
      const filename = this.allocate(item.getFilename());
      item.setSavePath(join(this.downloadDir, filename));
      const now = Date.now();
      const entry: BrowserDownloadEntry = {
        id: randomUUID(),
        conversationId: owner.conversationId,
        tabId: owner.tabId,
        url,
        filename,
        receivedBytes: safeBytes(item.getReceivedBytes()),
        totalBytes: safeBytes(item.getTotalBytes()),
        state: item.isPaused() ? 'paused' : 'progressing',
        startedAt: now,
        updatedAt: now,
      };
      const active: ActiveDownload = {
        item,
        updated: (_event, state) => {
          if (this.active.get(entry.id) !== active) return;
          entry.state =
            state === 'interrupted' ? 'interrupted' : item.isPaused() ? 'paused' : 'progressing';
          this.progress(entry, item);
          this.changed(entry.conversationId);
        },
        done: (_event, state) => {
          if (this.active.get(entry.id) !== active) return;
          this.finish(
            entry,
            state === 'completed' || state === 'cancelled' ? state : 'interrupted'
          );
        },
      };
      this.items.set(entry.id, entry);
      this.active.set(entry.id, active);
      item.on('updated', active.updated);
      item.on('done', active.done);
      this.accepted.add(item);
      this.prune();
      this.changed(entry.conversationId);
    } catch (error) {
      item.cancel();
      throw error;
    }
  }

  query(
    conversationId: string,
    query: BrowserStoreQuery = {}
  ): { items: BrowserDownloadEntry[]; total: number } {
    const needle = typeof query.query === 'string' ? query.query.trim().toLowerCase() : '';
    const items = [...this.items.values()].filter(
      (entry) =>
        entry.conversationId === conversationId &&
        (!needle ||
          entry.filename.toLowerCase().includes(needle) ||
          entry.url.toLowerCase().includes(needle))
    );
    items.sort((a, b) => b.startedAt - a.startedAt);
    return browserStorePage(items, query);
  }

  async action(conversationId: string, id: string, action: DownloadAction): Promise<void> {
    if (this.disposed) throw new Error('Browser downloads manager is disposed');
    const entry = this.items.get(id);
    if (!entry || entry.conversationId !== conversationId) throw new Error('Download not found');
    const active = this.active.get(id);
    if (action === 'reveal') {
      this.ensureDirectory(false);
      const path = join(this.downloadDir, entry.filename);
      const stat = lstatSync(path);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1)
        throw new Error('Download file is unavailable');
      shell.showItemInFolder(path);
      return;
    }
    if (action === 'remove') {
      if (active) {
        active.item.cancel();
        if (this.active.has(id)) this.finish(entry, 'cancelled');
      }
      this.items.delete(id);
      this.changed(conversationId);
      return;
    }
    if (!active) throw new Error('Download is no longer active');
    if (action === 'pause') {
      if (entry.state !== 'progressing') throw new Error('Download cannot be paused');
      active.item.pause();
      if (this.active.get(id) !== active) return;
      entry.state = active.item.isPaused() ? 'paused' : 'progressing';
    } else if (action === 'resume') {
      if ((entry.state !== 'paused' && entry.state !== 'interrupted') || !active.item.canResume())
        throw new Error('Download cannot be resumed');
      active.item.resume();
      if (this.active.get(id) !== active) return;
      entry.state = active.item.isPaused() ? 'paused' : 'progressing';
    } else if (action === 'cancel') {
      active.item.cancel();
      if (this.active.has(id)) this.finish(entry, 'cancelled');
      return;
    } else {
      throw new Error('Invalid download action');
    }
    this.progress(entry, active.item);
    delete entry.error;
    this.changed(conversationId);
  }

  async flush(): Promise<void> {
    this.file.flush();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const id of [...this.active.keys()]) {
      const entry = this.items.get(id);
      if (entry) this.finish(entry, 'interrupted');
    }
    try {
      this.file.flush();
    } catch {
      // Explicit flush still reports persistence failures after disposal.
    }
  }

  private ensureDirectory(create: boolean): void {
    if (create) mkdirSync(this.downloadDir, { recursive: true, mode: 0o700 });
    const stat = lstatSync(this.downloadDir);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new Error('Unsafe browser download directory');
    const path = realpathSync(this.downloadDir);
    if (path !== join(realpathSync(dirname(this.downloadDir)), basename(this.downloadDir)))
      throw new Error('Unsafe browser download directory');
    if (
      this.directory &&
      (path !== this.directory.path ||
        stat.dev !== this.directory.dev ||
        stat.ino !== this.directory.ino)
    )
      throw new Error('Browser download directory changed');
    this.directory ??= { path, dev: stat.dev, ino: stat.ino };
  }

  private allocate(raw: string): string {
    this.ensureDirectory(true);
    const name = safeFilename(typeof raw === 'string' ? raw : 'download');
    const extension = extname(name);
    const stem = name.slice(0, name.length - extension.length);
    const reserved = new Set([...this.items.values()].map((entry) => entry.filename.toLowerCase()));
    for (let suffix = 0; suffix < 100_000; suffix++) {
      const filename = suffix ? `${stem} (${suffix})${extension}` : name;
      if (reserved.has(filename.toLowerCase())) continue;
      const path = join(this.downloadDir, filename);
      try {
        const fd = openSync(
          path,
          constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
          0o600
        );
        closeSync(fd);
        return filename;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
    }
    throw new Error('Could not allocate a unique download filename');
  }

  private progress(entry: BrowserDownloadEntry, item: DownloadItem): void {
    entry.receivedBytes = safeBytes(item.getReceivedBytes());
    entry.totalBytes = safeBytes(item.getTotalBytes());
    entry.updatedAt = Date.now();
  }

  private finish(
    entry: BrowserDownloadEntry,
    state: 'completed' | 'cancelled' | 'interrupted'
  ): void {
    const active = this.active.get(entry.id);
    if (!active) return;
    this.active.delete(entry.id);
    active.item.removeListener('updated', active.updated);
    active.item.removeListener('done', active.done);
    this.progress(entry, active.item);
    entry.state = state;
    if (state === 'interrupted') entry.error = 'Download interrupted';
    else delete entry.error;
    this.changed(entry.conversationId);
  }

  private changed(conversationId: string): void {
    this.file.changed();
    try {
      this.options.onChange?.(conversationId);
    } catch {
      // UI notification failure must not interrupt Chromium download lifecycle events.
    }
  }

  private prune(): void {
    const candidates = [...this.items.values()].filter((entry) => !this.active.has(entry.id));
    candidates.sort((a, b) => a.startedAt - b.startedAt);
    for (const entry of candidates) {
      if (this.items.size <= MAX_ENTRIES) break;
      this.items.delete(entry.id);
    }
  }
}
