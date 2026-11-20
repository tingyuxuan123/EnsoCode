import fs from 'node:fs';
import path from 'node:path';
import { LOG_FILENAME, SCHEMA_FILENAME, type VaultPreset } from '@shared/memory/constants';
import type {
  CompileJobDto,
  MemoryCreateInput,
  MemoryEditPatch,
  MemoryJobsSnapshot,
  MemoryLintReport,
  MemoryListQuery,
  MemoryListResult,
  MemoryMutationResult,
  MemoryNoteDetail,
  MemoryStats,
  VaultDocDto,
  VaultDocKind,
  VaultSpaceDto,
} from '@shared/memory/dto';
import {
  normalizeNoteType,
  parseMarkdownNote,
  parseNoteId,
  relPathToSlug,
  serializeMarkdownNote,
} from '@shared/memory/markdown';
import { buildPresetSchemaMarkdown } from '@shared/memory/presets';
import type Database from 'better-sqlite3';
import type { VaultBindingStore } from './memory/bindings';
import { type CompileJobRow, clearFinishedCompileJobs } from './memory/compiler';
import {
  buildWikiGraph,
  buildWikiTree,
  getNoteDetail,
  listIndexedNotes,
  syncSpaceIndex,
} from './memory/indexDb';
import { runVaultLint } from './memory/lint';
import { upsertWikiNote } from './memory/operations';
import { parseSpaceId } from './memory/types';
import {
  appendVaultLog,
  archiveNoteFile,
  chooseIndexFilename,
  deleteNoteFile,
  ensureVaultScaffold,
  readNoteFile,
  readNoteMtimeIso,
  readSchemaFile,
  restoreNoteFile,
  withSpaceLock,
  writeNoteAtomic,
  writeSchemaFile,
} from './memory/vault';

export { buildWikiGraph, buildWikiTree };

export interface AdminContext {
  db: Database.Database;
  bindings: VaultBindingStore;
  indexDbPath: string;
  language: string;
  spaceLabel: (spaceId: string) => string;
  knownExtraSpaceIds?: readonly string[];
  onSelfWrite?: (rootPath: string) => void;
}

export function listVaultSpaces(ctx: AdminContext): VaultSpaceDto[] {
  const spaceIds = new Set<string>([
    ...ctx.bindings.listKnownSpaceIds(),
    ...(ctx.knownExtraSpaceIds ?? []),
  ]);
  const todayIso = new Date().toISOString().slice(0, 10);
  const out: VaultSpaceDto[] = [];

  for (const spaceId of spaceIds) {
    const parsed = parseSpaceId(spaceId);
    if (!parsed) continue;
    const resolved = ctx.bindings.resolveSpace(spaceId);
    const counts = ctx.db
      .prepare(
        `SELECT
           count(*) FILTER (WHERE is_archived = 0) AS note_count,
           count(*) FILTER (WHERE is_archived = 0 AND status = 'draft') AS draft_count,
           count(*) FILTER (WHERE is_archived = 0 AND stale_after IS NOT NULL AND stale_after < ?) AS stale_count
         FROM notes WHERE space_id = ?`
      )
      .get(todayIso, spaceId) as { note_count: number; draft_count: number; stale_count: number };
    const broken = (
      ctx.db
        .prepare(
          `SELECT count(*) AS c FROM links l
           JOIN notes n ON n.space_id = l.space_id AND n.rel_path = l.source_path
           WHERE l.space_id = ? AND l.is_broken = 1 AND n.is_archived = 0 AND n.is_raw = 0`
        )
        .get(spaceId) as { c: number }
    ).c;

    out.push({
      spaceId,
      label: ctx.spaceLabel(spaceId),
      kind: parsed.kind,
      rootPath: resolved.rootPath,
      isExternal: resolved.isExternal,
      preset: resolved.preset,
      noteCount: counts.note_count,
      brokenLinks: broken,
      staleCount: counts.stale_count,
      draftCount: counts.draft_count,
      indexFilename: fs.existsSync(resolved.rootPath)
        ? chooseIndexFilename(resolved.rootPath)
        : 'index.md',
    });
  }

  const order = { global: 0, project: 1, chat: 2, bot: 3 };
  return out.sort((a, b) => order[a.kind] - order[b.kind] || a.label.localeCompare(b.label));
}

export function getMemoryStats(ctx: AdminContext): MemoryStats {
  const spaces = listVaultSpaces(ctx);
  const todayIso = new Date().toISOString().slice(0, 10);
  const row = ctx.db
    .prepare(
      `SELECT
         count(*) FILTER (WHERE is_archived = 0) AS total_notes,
         count(*) FILTER (WHERE is_archived = 0 AND status = 'draft') AS draft_count,
         count(*) FILTER (WHERE is_archived = 0 AND status = 'verified') AS verified_count,
         count(*) FILTER (WHERE is_archived = 0 AND stale_after IS NOT NULL AND stale_after < ?) AS stale_count,
         count(*) FILTER (WHERE is_archived = 1) AS archived_count
       FROM notes`
    )
    .get(todayIso) as {
    total_notes: number;
    draft_count: number;
    verified_count: number;
    stale_count: number;
    archived_count: number;
  };
  const links = ctx.db
    .prepare(
      `SELECT
         count(*) FILTER (WHERE is_broken = 0) AS ok_links,
         count(*) FILTER (WHERE is_broken = 1) AS broken_links
       FROM links`
    )
    .get() as { ok_links: number; broken_links: number };

  let indexBytes = 0;
  try {
    indexBytes = fs.statSync(ctx.indexDbPath).size;
  } catch {}

  return {
    totalNotes: row.total_notes,
    totalLinks: links.ok_links,
    brokenLinks: links.broken_links,
    draftCount: row.draft_count,
    verifiedCount: row.verified_count,
    staleCount: row.stale_count,
    archivedCount: row.archived_count,
    indexBytes,
    spaces,
  };
}

export function listNotesForAdmin(ctx: AdminContext, query: MemoryListQuery): MemoryListResult {
  return listIndexedNotes(ctx.db, query, ctx.spaceLabel);
}

export function getNoteDetailById(ctx: AdminContext, id: string): MemoryNoteDetail | null {
  const parsed = parseNoteId(id);
  if (!parsed) return null;
  const resolved = ctx.bindings.resolveSpace(parsed.spaceId);
  return getNoteDetail(ctx.db, parsed.spaceId, parsed.relPath, resolved.rootPath, ctx.spaceLabel);
}

export async function createNoteManual(
  ctx: AdminContext,
  input: MemoryCreateInput
): Promise<MemoryMutationResult> {
  try {
    const res = await upsertWikiNote(ctx.db, ctx.bindings, {
      spaceId: input.spaceId,
      note: input.slug,
      title: input.title,
      type: input.type,
      description: input.description,
      tags: input.tags,
      content: input.body,
      mode: 'replace',
      actor: 'user',
      status: 'verified',
      language: ctx.language,
      skipSanitize: true,
      onSelfWrite: ctx.onSelfWrite,
    });
    const resolved = ctx.bindings.resolveSpace(res.spaceId);
    const note = getNoteDetail(ctx.db, res.spaceId, res.relPath, resolved.rootPath, ctx.spaceLabel);
    return note ? { ok: true, note } : { ok: false, error: 'Failed to load created note.' };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function editNoteManual(
  ctx: AdminContext,
  id: string,
  patch: MemoryEditPatch
): Promise<MemoryMutationResult> {
  const parsedId = parseNoteId(id);
  if (!parsedId) return { ok: false, error: 'Invalid note id.' };
  const { spaceId, relPath } = parsedId;

  return withSpaceLock(spaceId, () => {
    const resolved = ctx.bindings.resolveSpace(spaceId);
    const raw = readNoteFile(resolved.rootPath, relPath);
    if (raw === null) return { ok: false, error: 'Note not found.' };
    if (patch.expectedUpdatedAt) {
      const diskUpdatedAt = readNoteMtimeIso(resolved.rootPath, relPath);
      if (diskUpdatedAt && diskUpdatedAt !== patch.expectedUpdatedAt) {
        syncSpaceIndex(ctx.db, spaceId, resolved.rootPath, { updateManagedIndex: false });
        const currentNote =
          getNoteDetail(ctx.db, spaceId, relPath, resolved.rootPath, ctx.spaceLabel) ?? undefined;
        return {
          ok: false,
          conflict: true,
          currentNote,
          error: 'Note was modified externally on disk.',
        };
      }
    }
    const existing = parseMarkdownNote(raw, relPathToSlug(relPath));
    const nowIso = new Date().toISOString();

    const nextFm = {
      ...existing.frontmatter,
      ...(patch.title !== undefined
        ? { title: patch.title.trim() || existing.frontmatter.title }
        : {}),
      ...(patch.description !== undefined
        ? patch.description.trim()
          ? { description: patch.description.trim() }
          : { description: undefined }
        : {}),
      ...(patch.type !== undefined ? { type: normalizeNoteType(patch.type) } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.tags !== undefined
        ? { tags: patch.tags.map((t) => t.trim()).filter(Boolean) }
        : {}),
      ...(patch.staleAfter !== undefined
        ? patch.staleAfter?.trim()
          ? { stale_after: patch.staleAfter.trim() }
          : { stale_after: undefined }
        : {}),
    };
    if (patch.status === 'verified') {
      nextFm.verified = { by: 'user', at: nowIso };
    }

    const nextBody = patch.body !== undefined ? patch.body : existing.body;
    const serialized = serializeMarkdownNote(nextFm, nextBody);
    ctx.onSelfWrite?.(resolved.rootPath);
    writeNoteAtomic(resolved.rootPath, relPath, serialized);
    appendVaultLog(resolved.rootPath, {
      action: patch.status === 'verified' && patch.body === undefined ? 'verify' : 'edit',
      slug: relPathToSlug(relPath),
      detail: `${nextFm.title ?? relPath} (user)`,
    });
    syncSpaceIndex(ctx.db, spaceId, resolved.rootPath, { updateManagedIndex: true });
    const detail = getNoteDetail(ctx.db, spaceId, relPath, resolved.rootPath, ctx.spaceLabel);
    return detail ? { ok: true, note: detail } : { ok: false, error: 'Note not found after edit.' };
  });
}

export async function archiveNoteById(
  ctx: AdminContext,
  id: string
): Promise<MemoryMutationResult> {
  const parsedId = parseNoteId(id);
  if (!parsedId) return { ok: false, error: 'Invalid note id.' };
  const { spaceId, relPath } = parsedId;
  return withSpaceLock(spaceId, () => {
    const resolved = ctx.bindings.resolveSpace(spaceId);
    try {
      ctx.onSelfWrite?.(resolved.rootPath);
      const out = archiveNoteFile(resolved.rootPath, relPath);
      syncSpaceIndex(ctx.db, spaceId, resolved.rootPath, { updateManagedIndex: true });
      const detail = getNoteDetail(ctx.db, spaceId, out.relPath, resolved.rootPath, ctx.spaceLabel);
      return detail ? { ok: true, note: detail } : { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
}

export async function restoreNoteById(
  ctx: AdminContext,
  id: string
): Promise<MemoryMutationResult> {
  const parsedId = parseNoteId(id);
  if (!parsedId) return { ok: false, error: 'Invalid note id.' };
  const { spaceId, relPath } = parsedId;
  return withSpaceLock(spaceId, () => {
    const resolved = ctx.bindings.resolveSpace(spaceId);
    try {
      ctx.onSelfWrite?.(resolved.rootPath);
      const out = restoreNoteFile(resolved.rootPath, relPath);
      syncSpaceIndex(ctx.db, spaceId, resolved.rootPath, { updateManagedIndex: true });
      const detail = getNoteDetail(ctx.db, spaceId, out.relPath, resolved.rootPath, ctx.spaceLabel);
      return detail ? { ok: true, note: detail } : { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
}

export async function deleteNotePermanentlyById(
  ctx: AdminContext,
  id: string
): Promise<MemoryMutationResult> {
  const parsedId = parseNoteId(id);
  if (!parsedId) return { ok: false, error: 'Invalid note id.' };
  const { spaceId, relPath } = parsedId;
  return withSpaceLock(spaceId, () => {
    const resolved = ctx.bindings.resolveSpace(spaceId);
    ctx.onSelfWrite?.(resolved.rootPath);
    const deleted = deleteNoteFile(resolved.rootPath, relPath);
    if (!deleted) return { ok: false, error: 'Note not found.' };
    appendVaultLog(resolved.rootPath, {
      action: 'delete',
      slug: relPathToSlug(relPath),
      detail: 'deleted permanently by user',
    });
    syncSpaceIndex(ctx.db, spaceId, resolved.rootPath, { updateManagedIndex: true });
    return { ok: true };
  });
}

export function runLintForAdmin(ctx: AdminContext, spaceId?: string | null): MemoryLintReport {
  return runVaultLint(ctx.db, {
    ...(spaceId ? { spaceIds: [spaceId] } : {}),
    spaceLabel: ctx.spaceLabel,
  });
}

export function getSchemaForSpace(ctx: AdminContext, spaceId: string): string {
  const resolved = ctx.bindings.resolveSpace(spaceId);
  return readSchemaFile(resolved.rootPath, resolved.preset, ctx.language);
}

export function saveSchemaForSpace(
  ctx: AdminContext,
  spaceId: string,
  content: string,
  preset?: VaultPreset
): void {
  if (preset) ctx.bindings.setPreset(spaceId, preset);
  const resolved = ctx.bindings.resolveSpace(spaceId);
  ensureVaultScaffold(resolved.rootPath, resolved.preset, ctx.language, resolved.isExternal);
  ctx.onSelfWrite?.(resolved.rootPath);
  writeSchemaFile(resolved.rootPath, content);
}

export function applyPresetToSpace(
  ctx: AdminContext,
  spaceId: string,
  preset: VaultPreset
): string {
  ctx.bindings.setPreset(spaceId, preset);
  const resolved = ctx.bindings.resolveSpace(spaceId);
  const content = buildPresetSchemaMarkdown(preset, ctx.language);
  ensureVaultScaffold(resolved.rootPath, preset, ctx.language, resolved.isExternal);
  ctx.onSelfWrite?.(resolved.rootPath);
  writeSchemaFile(resolved.rootPath, content);
  return content;
}

export function toMemoryJobsSnapshot(
  jobs: readonly CompileJobRow[],
  resolveSessionTitle: (sessionId: string) => string | null,
  resolveProjectName: (projectId: string | null) => string | null
): MemoryJobsSnapshot {
  const compile: CompileJobDto[] = jobs.map((job) => ({
    id: job.id,
    sessionId: job.sessionId,
    sessionTitle: resolveSessionTitle(job.sessionId),
    projectId: job.payload.projectId,
    projectName: resolveProjectName(job.payload.projectId),
    status: job.status,
    attempts: job.attempts,
    written: job.written,
    error: job.error,
    notes: job.notes,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  }));
  return { compile };
}

export { clearFinishedCompileJobs };

export function readVaultDoc(
  ctx: AdminContext,
  spaceId: string,
  kind: VaultDocKind
): VaultDocDto | null {
  const resolved = ctx.bindings.resolveSpace(spaceId);
  if (kind === 'schema') {
    const filePath = path.join(resolved.rootPath, SCHEMA_FILENAME);
    let updatedAt: string | null = null;
    try {
      if (fs.existsSync(filePath))
        updatedAt = new Date(fs.statSync(filePath).mtimeMs).toISOString();
    } catch {}
    return {
      spaceId,
      kind,
      filename: SCHEMA_FILENAME,
      content: readSchemaFile(resolved.rootPath, resolved.preset, ctx.language),
      updatedAt,
    };
  }
  const filename = kind === 'log' ? LOG_FILENAME : chooseIndexFilename(resolved.rootPath);
  const filePath = path.join(resolved.rootPath, filename);
  if (!fs.existsSync(filePath)) {
    return { spaceId, kind, filename, content: '', updatedAt: null };
  }
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return null;
    return {
      spaceId,
      kind,
      filename,
      content: fs.readFileSync(filePath, 'utf8'),
      updatedAt: new Date(stat.mtimeMs).toISOString(),
    };
  } catch {
    return null;
  }
}

export function noteFileAbsolutePath(bindings: VaultBindingStore, id: string): string | null {
  const parsed = parseNoteId(id);
  if (!parsed) return null;
  const resolved = bindings.resolveSpace(parsed.spaceId);
  const target = path.resolve(resolved.rootPath, parsed.relPath);
  return fs.existsSync(target) ? target : null;
}
