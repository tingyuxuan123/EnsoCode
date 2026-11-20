import fs, { statSync } from 'node:fs';
import path, { basename } from 'node:path';
import {
  type CompilableSessionDto,
  isMemoryCreateInput,
  isMemoryEditPatch,
  isMemoryListQuery,
  isPendingMemoryWriteDecision,
  isValidVaultPreset,
  isVaultDocKind,
  type MemoryJobsSnapshot,
  type MemoryLintReport,
  type MemoryListResult,
  type MemoryMutationResult,
  type MemoryStats,
  type MemoryVaultActionResult,
} from '@shared/memory/dto';
import { isGraphQuery, isTreeQuery, type MemoryGraphDto } from '@shared/memory/graphDto';
import { IPC_CHANNELS } from '@shared/types';
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { BotStore } from '../services/bots/botStore';
import { BotChatStore } from '../services/bots/chatStore';
import {
  cancelChatModelDownload,
  deleteChatModel,
  listChatModels,
  setChatModelProgressSink,
  startChatModelDownload,
} from '../services/chatModels';
import { hasCompiledSession } from '../services/memory/compiler';
import { syncSpaceIndex } from '../services/memory/indexDb';
import { listPendingWrites, rejectPendingWrite } from '../services/memory/pending';
import { isSpaceId, projectSpaceId } from '../services/memory/types';
import { ensureVaultScaffold } from '../services/memory/vault';
import {
  type AdminContext,
  applyPresetToSpace,
  archiveNoteById,
  buildWikiGraph,
  buildWikiTree,
  clearFinishedCompileJobs,
  createNoteManual,
  deleteNotePermanentlyById,
  editNoteManual,
  getMemoryStats,
  getNoteDetailById,
  getSchemaForSpace,
  listNotesForAdmin,
  listVaultSpaces,
  noteFileAbsolutePath,
  readVaultDoc,
  restoreNoteById,
  runLintForAdmin,
  saveSchemaForSpace,
  toMemoryJobsSnapshot,
} from '../services/memoryAdmin';
import {
  approvePendingMemoryWrite,
  distillSessionNow,
  getMemoryCompileJobs,
  markVaultSelfWrite,
  memoryBindings,
  memoryDatabase,
  memoryIndexPath,
  memoryLanguage,
  notifyMemoryChanged,
  rebuildMemoryIndex,
  setMemoryChangeListener,
  unwatchSpace,
  watchSpace,
} from '../services/memoryHost';
import { sendToAllWindows } from '../windows/createAppWindow';
import { isMainWebContents } from '../windows/MainWindow';
import { isSettingsWebContents } from '../windows/SettingsWindow';
import { readSettings } from './settings';

const EMPTY_LIST: MemoryListResult = { items: [], total: 0, types: [] };
const EMPTY_STATS: MemoryStats = {
  totalNotes: 0,
  totalLinks: 0,
  brokenLinks: 0,
  draftCount: 0,
  verifiedCount: 0,
  staleCount: 0,
  archivedCount: 0,
  indexBytes: 0,
  spaces: [],
};
const EMPTY_JOBS: MemoryJobsSnapshot = { compile: [] };
const EMPTY_GRAPH: MemoryGraphDto = { nodes: [], edges: [], totalNotes: 0 };
const EMPTY_LINT: MemoryLintReport = {
  issues: [],
  checkedNotes: 0,
  checkedAt: new Date(0).toISOString(),
};

function isTrustedWindow(webContentsId: number): boolean {
  return isMainWebContents(webContentsId) || isSettingsWebContents(webContentsId);
}

function invalidRequest(): MemoryMutationResult {
  return { ok: false, error: 'Invalid request.' };
}

function broadcast(channel: string, payload?: unknown): void {
  sendToAllWindows(channel, payload);
}

function memoryChanged(): void {
  broadcast(IPC_CHANNELS.MEMORY_CHANGED);
}

async function buildAdminContext(): Promise<AdminContext> {
  const { labeler, activeProjectSpaceIds } = await spaceMetadata();
  return {
    db: memoryDatabase(),
    bindings: memoryBindings(),
    indexDbPath: memoryIndexPath(),
    language: memoryLanguage(),
    spaceLabel: labeler,
    knownExtraSpaceIds: activeProjectSpaceIds,
    onSelfWrite: markVaultSelfWrite,
  };
}

export function registerMemoryHandlers(): void {
  setChatModelProgressSink((progress) => {
    broadcast(IPC_CHANNELS.MEMORY_CHAT_MODEL_PROGRESS, progress);
  });
  setMemoryChangeListener(memoryChanged);

  ipcMain.handle(IPC_CHANNELS.MEMORY_LIST, async (event, request: unknown) => {
    if (!isTrustedWindow(event.sender.id) || !isMemoryListQuery(request)) return EMPTY_LIST;
    try {
      const ctx = await buildAdminContext();
      return listNotesForAdmin(ctx, request);
    } catch {
      return EMPTY_LIST;
    }
  });

  ipcMain.handle(IPC_CHANNELS.MEMORY_DETAIL, async (event, id: unknown) => {
    if (!isTrustedWindow(event.sender.id) || typeof id !== 'string' || !id) return null;
    try {
      const ctx = await buildAdminContext();
      return getNoteDetailById(ctx, id);
    } catch {
      return null;
    }
  });

  ipcMain.handle(IPC_CHANNELS.MEMORY_CREATE, async (event, input: unknown) => {
    if (!isTrustedWindow(event.sender.id) || !isMemoryCreateInput(input)) return invalidRequest();
    if (!isSpaceId(input.spaceId)) return invalidRequest();
    const ctx = await buildAdminContext();
    const res = await createNoteManual(ctx, input);
    if (res.ok) notifyMemoryChanged();
    return res;
  });

  ipcMain.handle(IPC_CHANNELS.MEMORY_UPDATE, async (event, id: unknown, patch: unknown) => {
    if (!isTrustedWindow(event.sender.id) || typeof id !== 'string' || !id) {
      return invalidRequest();
    }
    if (!isMemoryEditPatch(patch)) return invalidRequest();
    const ctx = await buildAdminContext();
    const res = await editNoteManual(ctx, id, patch);
    if (res.ok) notifyMemoryChanged();
    return res;
  });

  ipcMain.handle(IPC_CHANNELS.MEMORY_ARCHIVE, async (event, id: unknown) => {
    if (!isTrustedWindow(event.sender.id) || typeof id !== 'string' || !id) return invalidRequest();
    const ctx = await buildAdminContext();
    const res = await archiveNoteById(ctx, id);
    if (res.ok) notifyMemoryChanged();
    return res;
  });

  ipcMain.handle(IPC_CHANNELS.MEMORY_RESTORE, async (event, id: unknown) => {
    if (!isTrustedWindow(event.sender.id) || typeof id !== 'string' || !id) return invalidRequest();
    const ctx = await buildAdminContext();
    const res = await restoreNoteById(ctx, id);
    if (res.ok) notifyMemoryChanged();
    return res;
  });

  ipcMain.handle(IPC_CHANNELS.MEMORY_DELETE, async (event, id: unknown) => {
    if (!isTrustedWindow(event.sender.id) || typeof id !== 'string' || !id) return invalidRequest();
    const ctx = await buildAdminContext();
    const res = await deleteNotePermanentlyById(ctx, id);
    if (res.ok) notifyMemoryChanged();
    return res;
  });

  ipcMain.handle(IPC_CHANNELS.MEMORY_STATS, async (event) => {
    if (!isTrustedWindow(event.sender.id)) return EMPTY_STATS;
    try {
      const ctx = await buildAdminContext();
      return getMemoryStats(ctx);
    } catch {
      return EMPTY_STATS;
    }
  });

  ipcMain.handle(IPC_CHANNELS.MEMORY_SPACES, async (event) => {
    if (!isTrustedWindow(event.sender.id)) return [];
    try {
      const ctx = await buildAdminContext();
      return listVaultSpaces(ctx);
    } catch {
      return [];
    }
  });

  ipcMain.handle(
    IPC_CHANNELS.MEMORY_BIND_VAULT,
    async (event, spaceId: unknown): Promise<MemoryVaultActionResult> => {
      if (!isTrustedWindow(event.sender.id) || typeof spaceId !== 'string' || !isSpaceId(spaceId)) {
        return { ok: false, error: 'Invalid memory space.' };
      }
      const parent = BrowserWindow.fromWebContents(event.sender) ?? undefined;
      const picked = await dialog.showOpenDialog(parent ?? (undefined as never), {
        title: 'Select Obsidian Vault or Markdown Folder',
        properties: ['openDirectory', 'createDirectory'],
      });
      if (picked.canceled || picked.filePaths.length === 0) {
        return { ok: false, cancelled: true };
      }
      try {
        const dirPath = picked.filePaths[0];
        const store = memoryBindings();
        const bound = store.bindExternal(spaceId, dirPath);
        ensureVaultScaffold(bound.rootPath, bound.preset, memoryLanguage(), true);
        syncSpaceIndex(memoryDatabase(), spaceId, bound.rootPath, {
          updateManagedIndex: true,
          force: true,
        });
        watchSpace(spaceId);
        notifyMemoryChanged();
        const ctx = await buildAdminContext();
        const space = listVaultSpaces(ctx).find((s) => s.spaceId === spaceId);
        return { ok: true, space };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.MEMORY_UNBIND_VAULT,
    async (event, spaceId: unknown): Promise<MemoryVaultActionResult> => {
      if (!isTrustedWindow(event.sender.id) || typeof spaceId !== 'string' || !isSpaceId(spaceId)) {
        return { ok: false, error: 'Invalid memory space.' };
      }
      try {
        unwatchSpace(spaceId);
        const bound = memoryBindings().unbind(spaceId);
        ensureVaultScaffold(bound.rootPath, bound.preset, memoryLanguage(), false);
        syncSpaceIndex(memoryDatabase(), spaceId, bound.rootPath, { force: true });
        watchSpace(spaceId);
        notifyMemoryChanged();
        const ctx = await buildAdminContext();
        const space = listVaultSpaces(ctx).find((s) => s.spaceId === spaceId);
        return { ok: true, space };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.MEMORY_OPEN_VAULT,
    async (event, target: unknown): Promise<{ ok: boolean; error?: string }> => {
      if (!isTrustedWindow(event.sender.id) || !target || typeof target !== 'object') {
        return { ok: false, error: 'Invalid request.' };
      }
      const req = target as { spaceId?: unknown; noteId?: unknown; app?: unknown };
      const mode = req.app === 'obsidian' ? 'obsidian' : 'folder';
      let absPath: string | null = null;
      if (typeof req.noteId === 'string' && req.noteId) {
        absPath = noteFileAbsolutePath(memoryBindings(), req.noteId);
      } else if (typeof req.spaceId === 'string' && isSpaceId(req.spaceId)) {
        const resolved = memoryBindings().resolveSpace(req.spaceId);
        ensureVaultScaffold(
          resolved.rootPath,
          resolved.preset,
          memoryLanguage(),
          resolved.isExternal
        );
        absPath = resolved.rootPath;
      }
      if (!absPath || !fs.existsSync(absPath)) {
        return { ok: false, error: 'Target folder or note does not exist.' };
      }
      try {
        if (mode === 'obsidian') {
          const url = `obsidian://open?path=${encodeURIComponent(absPath)}`;
          await shell.openExternal(url);
          return { ok: true };
        }
        const errText = await shell.openPath(absPath);
        return errText ? { ok: false, error: errText } : { ok: true };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }
  );

  ipcMain.handle(IPC_CHANNELS.MEMORY_GET_SCHEMA, async (event, spaceId: unknown) => {
    if (!isTrustedWindow(event.sender.id) || typeof spaceId !== 'string' || !isSpaceId(spaceId)) {
      return '';
    }
    const ctx = await buildAdminContext();
    return getSchemaForSpace(ctx, spaceId);
  });

  ipcMain.handle(
    IPC_CHANNELS.MEMORY_SAVE_SCHEMA,
    async (event, spaceId: unknown, content: unknown, preset?: unknown) => {
      if (
        !isTrustedWindow(event.sender.id) ||
        typeof spaceId !== 'string' ||
        !isSpaceId(spaceId) ||
        typeof content !== 'string'
      ) {
        return { ok: false, error: 'Invalid request.' };
      }
      const validPreset = isValidVaultPreset(preset) ? preset : undefined;
      try {
        const ctx = await buildAdminContext();
        saveSchemaForSpace(ctx, spaceId, content, validPreset);
        notifyMemoryChanged();
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.MEMORY_APPLY_PRESET,
    async (event, spaceId: unknown, preset: unknown) => {
      if (
        !isTrustedWindow(event.sender.id) ||
        typeof spaceId !== 'string' ||
        !isSpaceId(spaceId) ||
        !isValidVaultPreset(preset)
      ) {
        return { ok: false, error: 'Invalid request.' };
      }
      try {
        const ctx = await buildAdminContext();
        const schema = applyPresetToSpace(ctx, spaceId, preset);
        notifyMemoryChanged();
        return { ok: true, schema };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }
  );

  ipcMain.handle(IPC_CHANNELS.MEMORY_REBUILD_INDEX, (event) => {
    if (!isTrustedWindow(event.sender.id)) return { ok: false, error: 'Unauthorized.' };
    try {
      rebuildMemoryIndex();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.MEMORY_LINT, async (event, spaceId: unknown) => {
    if (!isTrustedWindow(event.sender.id)) return EMPTY_LINT;
    if (
      spaceId !== undefined &&
      spaceId !== null &&
      (typeof spaceId !== 'string' || !isSpaceId(spaceId))
    ) {
      return EMPTY_LINT;
    }
    try {
      const ctx = await buildAdminContext();
      return runLintForAdmin(ctx, spaceId ?? null);
    } catch {
      return EMPTY_LINT;
    }
  });

  ipcMain.handle(IPC_CHANNELS.MEMORY_GRAPH, async (event, query: unknown) => {
    if (!isTrustedWindow(event.sender.id) || !isGraphQuery(query)) return EMPTY_GRAPH;
    try {
      const ctx = await buildAdminContext();
      return buildWikiGraph(ctx.db, query, ctx.spaceLabel);
    } catch {
      return EMPTY_GRAPH;
    }
  });

  ipcMain.handle(IPC_CHANNELS.MEMORY_TREE, async (event, query: unknown) => {
    if (!isTrustedWindow(event.sender.id) || !isTreeQuery(query)) return [];
    try {
      const ctx = await buildAdminContext();
      return buildWikiTree(ctx.db, query, ctx.spaceLabel);
    } catch {
      return [];
    }
  });

  ipcMain.handle(IPC_CHANNELS.MEMORY_JOBS, async (event) => {
    if (!isTrustedWindow(event.sender.id)) return EMPTY_JOBS;
    try {
      const titles = readConversationTitles();
      const projects = await projectNames();
      return toMemoryJobsSnapshot(
        getMemoryCompileJobs(25),
        (id) => titles.get(id) ?? null,
        (pid) => (pid ? (projects.get(pid) ?? null) : null)
      );
    } catch {
      return EMPTY_JOBS;
    }
  });

  ipcMain.handle(IPC_CHANNELS.MEMORY_JOBS_CLEAR, (event) => {
    if (!isTrustedWindow(event.sender.id)) return 0;
    try {
      const removed = clearFinishedCompileJobs(memoryDatabase());
      if (removed > 0) notifyMemoryChanged();
      return removed;
    } catch {
      return 0;
    }
  });

  ipcMain.handle(IPC_CHANNELS.MEMORY_PENDING_WRITES, async (event) => {
    if (!isTrustedWindow(event.sender.id)) return [];
    try {
      const { labeler } = await spaceMetadata();
      return listPendingWrites(memoryDatabase(), labeler);
    } catch {
      return [];
    }
  });

  ipcMain.handle(
    IPC_CHANNELS.MEMORY_PENDING_WRITE_REVIEW,
    (event, id: unknown, decision: unknown): MemoryMutationResult => {
      if (
        !isTrustedWindow(event.sender.id) ||
        typeof id !== 'string' ||
        !id ||
        !isPendingMemoryWriteDecision(decision)
      ) {
        return invalidRequest();
      }
      if (decision === 'reject') {
        const ok = rejectPendingWrite(memoryDatabase(), id);
        if (ok) notifyMemoryChanged();
        return ok ? { ok: true } : { ok: false, error: 'Pending write not found.' };
      }
      const res = approvePendingMemoryWrite(id);
      return res.ok ? { ok: true } : { ok: false, error: res.error ?? 'Approval failed.' };
    }
  );

  ipcMain.handle(IPC_CHANNELS.MEMORY_DISTILLABLE_SESSIONS, async (event) => {
    if (!isTrustedWindow(event.sender.id)) return [];
    return listCompilableSessions();
  });

  ipcMain.handle(
    IPC_CHANNELS.MEMORY_DISTILL_SESSION,
    async (event, sessionId: unknown, force: unknown) => {
      if (!isTrustedWindow(event.sender.id) || typeof sessionId !== 'string' || !sessionId) {
        return false;
      }
      const target = (await listCompilableSessionRecords()).find((s) => s.sessionId === sessionId);
      if (!target) return false;
      return distillSessionNow(
        {
          sessionId: target.sessionId,
          sessionFile: target.sessionFile,
          projectId: target.projectId,
        },
        { force: force === true }
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.MEMORY_READ_VAULT_DOC,
    async (event, spaceId: unknown, kind: unknown) => {
      if (
        !isTrustedWindow(event.sender.id) ||
        typeof spaceId !== 'string' ||
        !isSpaceId(spaceId) ||
        !isVaultDocKind(kind)
      ) {
        return null;
      }
      try {
        const ctx = await buildAdminContext();
        return readVaultDoc(ctx, spaceId, kind);
      } catch {
        return null;
      }
    }
  );

  // 本地小模型（用于语音纠错与可选的离线 Wiki 编译）
  ipcMain.handle(IPC_CHANNELS.MEMORY_CHAT_MODELS, (event) => {
    if (!isTrustedWindow(event.sender.id)) return [];
    return listChatModels();
  });
  ipcMain.handle(IPC_CHANNELS.MEMORY_CHAT_MODEL_DOWNLOAD, async (event, modelId: unknown) => {
    if (!isTrustedWindow(event.sender.id) || typeof modelId !== 'string' || !modelId) return false;
    return startChatModelDownload(modelId);
  });
  ipcMain.handle(IPC_CHANNELS.MEMORY_CHAT_MODEL_CANCEL, (event, modelId: unknown) => {
    if (!isTrustedWindow(event.sender.id) || typeof modelId !== 'string' || !modelId) return false;
    return cancelChatModelDownload(modelId);
  });
  ipcMain.handle(IPC_CHANNELS.MEMORY_CHAT_MODEL_DELETE, async (event, modelId: unknown) => {
    if (!isTrustedWindow(event.sender.id) || typeof modelId !== 'string' || !modelId) return false;
    return deleteChatModel(modelId);
  });
}

async function projectNames(): Promise<Map<string, string>> {
  const { getSourceAuthorityRegistry } = await import('./agent');
  const registry = getSourceAuthorityRegistry();
  const names = new Map<string, string>();
  for (const project of registry?.projection().projects ?? []) {
    if (project.kind === 'bot-home') continue;
    names.set(
      project.projectId,
      project.kind === 'scratch' ? 'Temporary chats' : basename(project.canonicalPath)
    );
  }
  return names;
}

const GLOBAL_SPACE_LABEL = 'Global';
const PROJECT_SPACE_PREFIX = 'proj:';

async function spaceMetadata(): Promise<{
  labeler: (spaceId: string) => string;
  activeProjectSpaceIds: string[];
}> {
  const { getSourceAuthorityRegistry } = await import('./agent');
  const registry = getSourceAuthorityRegistry();
  const names = new Map<string, string>();
  const activeProjectSpaceIds: string[] = [];
  for (const project of registry?.projection().projects ?? []) {
    if (project.kind === 'bot-home') continue;
    if (project.kind !== 'scratch' && project.state === 'active') {
      try {
        activeProjectSpaceIds.push(projectSpaceId(project.projectId));
      } catch {}
    }
    names.set(
      project.projectId,
      project.kind === 'scratch' ? 'Temporary chats' : basename(project.canonicalPath)
    );
  }
  const bots = new BotStore(path.join(app.getPath('userData'), 'bots'));
  const chats = new BotChatStore(path.join(app.getPath('userData'), 'bot-chats'));
  const labeler = (spaceId: string) => {
    if (spaceId.startsWith('bot:')) {
      return `成员：${bots.get(spaceId.slice(4))?.name ?? '已删除成员'}`;
    }
    if (spaceId.startsWith('chat:')) {
      return `群：${chats.get(spaceId.slice(5))?.title ?? '已删除群'}`;
    }
    if (!spaceId.startsWith(PROJECT_SPACE_PREFIX)) return GLOBAL_SPACE_LABEL;
    const projectId = spaceId.slice(PROJECT_SPACE_PREFIX.length);
    return names.get(projectId) ?? projectId.slice(0, 8);
  };
  return { labeler, activeProjectSpaceIds };
}

function readConversationTitles(): Map<string, string> {
  const titles = new Map<string, string>();
  const settings = readSettings();
  const store = settings?.['enso-conversations'];
  if (!store || typeof store !== 'object') return titles;
  const state = (store as Record<string, unknown>).state;
  if (!state || typeof state !== 'object') return titles;
  const conversations = (state as Record<string, unknown>).conversations;
  if (!conversations || typeof conversations !== 'object') return titles;
  const entries = Array.isArray(conversations)
    ? conversations
    : Object.values(conversations as Record<string, unknown>);
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    const { id, title } = entry as { id?: unknown; title?: unknown };
    if (typeof id === 'string' && typeof title === 'string' && title.trim()) {
      titles.set(id, title.trim());
    }
  }
  return titles;
}

interface CompilableRecord extends CompilableSessionDto {
  sessionFile: string;
}

async function listCompilableSessionRecords(): Promise<CompilableRecord[]> {
  const { getSourceAuthorityRegistry } = await import('./agent');
  const registry = getSourceAuthorityRegistry();
  if (!registry) return [];
  const snapshot = registry.projection();
  const projects = new Map(snapshot.projects.map((p) => [p.projectId, p]));
  const db = memoryDatabase();
  const titles = readConversationTitles();
  const sessionRoot = path.join(app.getPath('userData'), 'agent', 'sessions');
  const records: CompilableRecord[] = [];
  for (const conversation of snapshot.conversations) {
    const sessionFile = conversation.sessionFile;
    if (!sessionFile) continue;
    const project = projects.get(conversation.projectId);
    let updatedAt = '';
    try {
      updatedAt = statSync(path.resolve(sessionRoot, sessionFile)).mtime.toISOString();
    } catch {}
    records.push({
      sessionId: conversation.conversationId,
      sessionFile,
      title: titles.get(conversation.conversationId) ?? conversation.conversationId.slice(0, 8),
      projectId: project?.kind === 'scratch' ? null : conversation.projectId || null,
      projectName:
        project?.kind === 'scratch'
          ? 'Temporary chats'
          : project
            ? basename(project.canonicalPath)
            : null,
      messageCount: 0,
      compiled: hasCompiledSession(db, conversation.conversationId),
      updatedAt,
    });
  }
  return records.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

async function listCompilableSessions(): Promise<CompilableSessionDto[]> {
  return (await listCompilableSessionRecords()).map(({ sessionFile: _f, ...dto }) => dto);
}
