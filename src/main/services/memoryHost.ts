import fs from 'node:fs';
import path from 'node:path';
import type { ChildSessionIdentity, SessionIdentity } from '@shared/builtinAgents';
import {
  DEFAULT_MEMORY_DISTILL_ENABLED,
  DEFAULT_MEMORY_LANGUAGE,
  resolveMemoryLanguage,
} from '@shared/memory/constants';
import { normalizeMemoryModelIdleMinutes } from '@shared/memory/modelIdle';
import { effectiveDisabledBuiltinTools } from '@shared/types';
import type { MemoryOp } from '@shared/types/agent';
import type Database from 'better-sqlite3';
import { app } from 'electron';
import { holdLocalChat, syncLocalChatFromSettings } from './llama/chat';
import { VaultBindingStore } from './memory/bindings';
import { executeMemoryOp } from './memory/bridge';
import {
  type CompileJobRow,
  type CompilePayload,
  type Complete,
  ensureCompileJob,
  lastCompileWatermark,
  listCompileJobs,
  listResumableCompileJobs,
  recentCompiledNotes,
  runCompileJob,
  sliceTranscript,
  type TranscriptMessage,
} from './memory/compiler';
import { deleteSpaceIndex, openIndexDb, syncSpaceIndex } from './memory/indexDb';
import { approvePendingWrite } from './memory/pending';
import type { MemorySpaceContext } from './memory/space';
import { ensureVaultScaffold } from './memory/vault';
import { VaultWatcherManager } from './memory/watcher';

let db: Database.Database | null = null;
let bindings: VaultBindingStore | null = null;
let watcher: VaultWatcherManager | null = null;
let rootOverride: string | null = null;

/** 测试注入根目录（避免依赖 Electron app.getPath）。生产环境传 null。 */
export function setMemoryRootForTest(dir: string | null): void {
  closeMemoryDb();
  rootOverride = dir;
}

export function memoryRoot(): string {
  return rootOverride ?? path.join(app.getPath('userData'), 'memory');
}

export function memoryIndexPath(): string {
  return path.join(memoryRoot(), 'index.db');
}

export function memoryBindings(): VaultBindingStore {
  if (!bindings) bindings = new VaultBindingStore(memoryRoot());
  return bindings;
}

function ensureWatcher(): VaultWatcherManager {
  if (!watcher) {
    watcher = new VaultWatcherManager((spaceId, rootPath) => {
      try {
        const res = syncSpaceIndex(memoryDatabase(), spaceId, rootPath, {
          updateManagedIndex: true,
        });
        if (res.changed > 0 || res.removed > 0) notifyMemoryChanged();
      } catch {}
    });
  }
  return watcher;
}

export function watchSpace(spaceId: string): void {
  try {
    const resolved = memoryBindings().resolveSpace(spaceId);
    if (fs.existsSync(resolved.rootPath)) {
      ensureWatcher().watch(spaceId, resolved.rootPath);
    }
  } catch {}
}

export function unwatchSpace(spaceId: string): void {
  watcher?.unwatch(spaceId);
}

export function markVaultSelfWrite(rootPath: string): void {
  watcher?.markSelfWrite(rootPath);
}

export function memoryDatabase(): Database.Database {
  if (!db) {
    db = openIndexDb(memoryIndexPath());
    syncAllKnownSpaces();
    resumeMemoryCompile();
  }
  return db;
}

export function syncAllKnownSpaces(opts: { force?: boolean } = {}): void {
  const database = db;
  if (!database) return;
  const store = memoryBindings();
  const known = store.listKnownSpaceIds();
  for (const spaceId of known) {
    try {
      const space = store.resolveSpace(spaceId);
      if (spaceId === 'global') {
        ensureVaultScaffold(space.rootPath, space.preset, compileConfig.language, space.isExternal);
      }
      if (fs.existsSync(space.rootPath)) {
        syncSpaceIndex(database, spaceId, space.rootPath, {
          updateManagedIndex: false,
          force: opts.force,
        });
        watchSpace(spaceId);
      }
    } catch {}
  }
}

export function rebuildMemoryIndex(): void {
  if (db) {
    try {
      db.close();
    } catch {}
    db = null;
  }
  const indexPath = memoryIndexPath();
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.rmSync(`${indexPath}${suffix}`, { force: true });
    } catch {}
  }
  db = openIndexDb(indexPath);
  syncAllKnownSpaces({ force: true });
  notifyMemoryChanged();
}

export function closeMemoryDb(): void {
  if (changeTimer) {
    clearTimeout(changeTimer);
    changeTimer = null;
  }
  watcher?.closeAll();
  watcher = null;
  if (db) {
    try {
      db.close();
    } catch {}
    db = null;
  }
  bindings = null;
}

// ---------------------------------------------------------------------------
// 变更通知（trailing 防抖，避免高频批量写刷爆 UI）
// ---------------------------------------------------------------------------

let onMemoryChanged: (() => void) | null = null;
let changeTimer: NodeJS.Timeout | null = null;

export function setMemoryChangeListener(listener: (() => void) | null): void {
  onMemoryChanged = listener;
}

export function notifyMemoryChanged(): void {
  if (!onMemoryChanged) return;
  if (changeTimer) return;
  changeTimer = setTimeout(() => {
    changeTimer = null;
    onMemoryChanged?.();
  }, 120);
}

// ---------------------------------------------------------------------------
// 设置同步 & 异步 Wiki Compiler
// ---------------------------------------------------------------------------

export interface MemoryCompileConfig {
  enabled: boolean;
  complete: (() => Complete | null | Promise<Complete | null>) | null;
  readTranscript: (sessionFile: string) => Promise<TranscriptMessage[]>;
  language: string;
}

let compileConfig: MemoryCompileConfig = {
  enabled: DEFAULT_MEMORY_DISTILL_ENABLED,
  complete: null,
  readTranscript: readSessionTranscript,
  language: DEFAULT_MEMORY_LANGUAGE,
};

export function configureMemoryDistill(next: Partial<MemoryCompileConfig>): void {
  compileConfig = { ...compileConfig, ...next };
}

export function syncMemoryFromSettings(state: Record<string, unknown>): void {
  const memoryModelIdleMinutes = normalizeMemoryModelIdleMinutes(state.memoryModelIdleMinutes);
  syncLocalChatFromSettings({ ...state, memoryModelIdleMinutes });
  const enabled =
    state.memoryDistillEnabled !== false &&
    !effectiveDisabledBuiltinTools(state.disabledBuiltinTools).includes('memory');
  const language = resolveMemoryLanguage(state.memoryLanguage);
  configureMemoryDistill({ enabled, language });
}

export function memoryLanguage(): string {
  return compileConfig.language;
}

export function getMemoryCompletion(): Promise<Complete | null> {
  return Promise.resolve(compileConfig.complete?.() ?? null);
}

let llmJobRun: Promise<void> = Promise.resolve();
const enqueueLlmJob = (task: () => Promise<void>): Promise<void> => {
  const release = holdLocalChat();
  const run = llmJobRun
    .then(task)
    .catch(() => {})
    .finally(release);
  llmJobRun = run;
  return run;
};

async function readSessionTranscript(sessionFile: string): Promise<TranscriptMessage[]> {
  const sessionDir = path.join(app.getPath('userData'), 'agent', 'sessions');
  const root = path.resolve(sessionDir);
  const resolved = path.resolve(sessionFile);
  if (!resolved.startsWith(`${root}${path.sep}`)) return [];
  const [{ SessionManager, sessionEntryToContextMessages }, { projectMessage }] = await Promise.all(
    [import('@earendil-works/pi-coding-agent'), import('../../agent/projection')]
  );
  const branch = SessionManager.open(resolved, sessionDir).getBranch();
  const out: TranscriptMessage[] = [];
  for (const entry of branch) {
    for (const raw of sessionEntryToContextMessages(entry)) {
      const m = projectMessage(raw);
      if (!m || (m.role !== 'user' && m.role !== 'assistant')) continue;
      const text = m.content
        .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
        .map((p) => p.text)
        .join('\n');
      if (text.trim()) out.push({ role: m.role, text, entryId: entry.id });
    }
  }
  return out;
}

export async function scheduleMemoryDistill(
  payload: CompilePayload,
  opts: { continueFromLastJob?: boolean } = {}
): Promise<string | undefined> {
  if (!compileConfig.enabled) return payload.fromEntryId;
  let watermark = payload.fromEntryId;
  await runCompile(payload, {
    manual: false,
    continueFromLastJob: opts.continueFromLastJob === true,
    onWatermark: (next) => {
      watermark = next;
    },
  });
  return watermark;
}

export async function distillSessionNow(
  payload: CompilePayload,
  opts: { force?: boolean } = {}
): Promise<boolean> {
  let started = false;
  await runCompile(payload, {
    manual: true,
    force: opts.force,
    onStarted: () => {
      started = true;
    },
  });
  return started;
}

function runCompile(
  initialPayload: CompilePayload,
  opts: {
    manual: boolean;
    force?: boolean;
    continueFromLastJob?: boolean;
    onStarted?: () => void;
    onWatermark?: (watermark: string | undefined) => void;
  }
): Promise<void> {
  return enqueueLlmJob(async () => {
    const database = memoryDatabase();
    let payload = { ...initialPayload, ...(opts.force ? { force: true } : {}) };
    if (opts.continueFromLastJob && payload.fromEntryId === undefined) {
      const last = lastCompileWatermark(database, payload.sessionId);
      if (last) payload = { ...payload, fromEntryId: last };
    }
    const messages = await compileConfig.readTranscript(payload.sessionFile);
    const sliced = sliceTranscript(messages, payload.fromEntryId, payload.toEntryId);
    if (sliced.messages.length === 0) {
      opts.onWatermark?.(sliced.watermark);
      return;
    }
    const stamped: CompilePayload = {
      ...payload,
      ...(sliced.watermark ? { toEntryId: sliced.watermark } : {}),
    };
    const jobId = ensureCompileJob(database, stamped);
    opts.onWatermark?.(sliced.watermark);
    const complete = await compileConfig.complete?.();
    if (!complete) return;
    opts.onStarted?.();
    await runCompileJob(database, jobId, {
      bindings: memoryBindings(),
      readTranscript: compileConfig.readTranscript,
      complete,
      language: compileConfig.language,
      onSelfWrite: markVaultSelfWrite,
      onChanged: notifyMemoryChanged,
    });
    notifyMemoryChanged();
  });
}

function resumeMemoryCompile(): void {
  if (!compileConfig.enabled || !db) return;
  const jobs = listResumableCompileJobs(db);
  if (jobs.length === 0) return;
  void enqueueLlmJob(async () => {
    const complete = await compileConfig.complete?.();
    if (!complete || !db) return;
    for (const job of jobs) {
      try {
        await runCompileJob(db, job.id, {
          bindings: memoryBindings(),
          readTranscript: compileConfig.readTranscript,
          complete,
          language: compileConfig.language,
          onSelfWrite: markVaultSelfWrite,
          onChanged: notifyMemoryChanged,
        });
      } catch {}
    }
  });
}

export function getMemoryCompileJobs(limit?: number): CompileJobRow[] {
  return db ? listCompileJobs(db, limit) : [];
}

export async function awaitMemoryDistill(): Promise<void> {
  let seen: Promise<void>;
  do {
    seen = llmJobRun;
    await seen;
  } while (seen !== llmJobRun);
}

export function getRecentCompiledNotes(spaceId: string, sinceMs: number): string[] {
  return recentCompiledNotes(memoryDatabase(), spaceId, sinceMs);
}

// ---------------------------------------------------------------------------
// Worker 调用桥 & 待审批写入批准
// ---------------------------------------------------------------------------

/** 子会话（coworker `${parentId}::cw-x` / typed child）归属父会话所在项目。 */
export function rootSessionId(identity: SessionIdentity | ChildSessionIdentity): string {
  const raw = 'parent' in identity ? identity.parent.sessionId : identity.sessionId;
  const sep = raw.indexOf('::');
  return sep === -1 ? raw : raw.slice(0, sep);
}

export async function invokeMemory(
  op: MemoryOp,
  params: unknown,
  ctx: MemorySpaceContext & { sessionId?: string }
): Promise<unknown> {
  const database = memoryDatabase();
  const store = memoryBindings();
  const result = await executeMemoryOp(database, op, params, {
    ...ctx,
    bindings: store,
    language: compileConfig.language,
    onSelfWrite: markVaultSelfWrite,
    onChanged: notifyMemoryChanged,
    onPending: () => notifyMemoryChanged(),
  });
  // Ensure active space is watched after first touch
  if (ctx.projectId) watchSpace(`proj:${ctx.projectId}`);
  watchSpace('global');
  return result;
}

export function approvePendingMemoryWrite(id: string): {
  ok: boolean;
  relPath?: string;
  spaceId?: string;
  error?: string;
} {
  const result = approvePendingWrite(memoryDatabase(), id, memoryBindings(), {
    language: compileConfig.language,
    onSelfWrite: markVaultSelfWrite,
  });
  if (result.ok) notifyMemoryChanged();
  return result;
}

export async function removeSpaceCompletely(spaceId: string): Promise<void> {
  await awaitMemoryDistill();
  unwatchSpace(spaceId);
  const store = memoryBindings();
  const resolved = store.resolveSpace(spaceId);
  deleteSpaceIndex(memoryDatabase(), spaceId);
  // 只删除 Collabra 托管目录，绝不删除用户挂载的外部 Obsidian Vault！
  if (!resolved.isExternal && fs.existsSync(resolved.rootPath)) {
    fs.rmSync(resolved.rootPath, { recursive: true, force: true });
  }
  store.removeSpace(spaceId);
  notifyMemoryChanged();
}
