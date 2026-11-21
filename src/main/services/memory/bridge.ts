import { makeNoteId } from '@shared/memory/markdown';
import {
  parseMemoryArchiveRequest,
  parseMemoryIndexRequest,
  parseMemoryReadRequest,
  parseMemorySearchRequest,
  parseMemoryUpsertRequest,
} from '@shared/memory/toolParams';
import type { MemoryOp } from '@shared/types/agent';
import type Database from 'better-sqlite3';
import type { VaultBindingStore } from './bindings';
import {
  getNoteDetail,
  listIndexedNotes,
  resolveNoteRef,
  resolveReadNoteRefs,
  searchIndexedNotes,
  syncSpaceIndex,
} from './indexDb';
import { upsertWikiNote } from './operations';
import { queuePendingWrite } from './pending';
import { sanitizeMemoryWrite } from './safety';
import { defaultCaptureSpace, type MemorySpaceContext, resolveSpaceIds } from './space';
import { GLOBAL_SPACE, MemoryValidationError } from './types';
import { archiveNoteFile, ensureVaultScaffold, readSchemaFile, withSpaceLock } from './vault';

export interface MemoryBridgeContext extends MemorySpaceContext {
  bindings: VaultBindingStore;
  language?: string;
  sessionId?: string;
  now?: Date;
  onChanged?: () => void;
  onPending?: (id: string) => void;
  onSelfWrite?: (rootPath: string) => void;
}

/** Bot 会话写共享空间（项目 / 全局）需用户审批；自己的 bot / chat 空间直接写 */
function needsReview(ctx: MemoryBridgeContext, spaceId: string): boolean {
  return Boolean(ctx.botId) && (spaceId === GLOBAL_SPACE || spaceId.startsWith('proj:'));
}

function defaultReadScope(ctx: MemorySpaceContext) {
  return ctx.chatId ? 'chat' : ctx.botId ? 'bot' : ctx.projectId ? 'project' : 'global';
}

function ensureAndSyncSpaces(
  db: Database.Database,
  bindings: VaultBindingStore,
  spaceIds: readonly string[],
  language?: string
): void {
  for (const spaceId of spaceIds) {
    const space = bindings.resolveSpace(spaceId);
    ensureVaultScaffold(space.rootPath, space.preset, language ?? 'zh', space.isExternal);
    syncSpaceIndex(db, spaceId, space.rootPath);
  }
}

/**
 * Worker `memory-invoke` 的 Main 侧执行入口。
 * 所有入参按 unknown 收窄，所有路径由 Main 按 spaceId 派生并校验边界。
 */
export async function executeMemoryOp(
  db: Database.Database,
  op: MemoryOp,
  params: unknown,
  ctx: MemoryBridgeContext
): Promise<unknown> {
  if (op === 'index') {
    const req = parseMemoryIndexRequest(params ?? {});
    if (!req) throw new MemoryValidationError('invalid_request', 'invalid memory_index params');
    const spaceIds = resolveSpaceIds(req.spaceId ?? defaultReadScope(ctx), ctx);
    if (spaceIds.length === 0) return { schema: '', notes: [], spaces: [] };
    ensureAndSyncSpaces(db, ctx.bindings, spaceIds, ctx.language);

    const primary = ctx.bindings.resolveSpace(spaceIds[0]);
    const schema = readSchemaFile(primary.rootPath, primary.preset, ctx.language ?? 'zh');
    const notes: {
      spaceId: string;
      slug: string;
      title: string;
      type: string;
      description: string;
      status: string;
      tags: string[];
      linkCount: number;
      isRaw: boolean;
    }[] = [];

    for (const spaceId of spaceIds) {
      const remaining = req.limit - notes.length;
      if (remaining <= 0) break;
      const listed = listIndexedNotes(db, {
        spaceId,
        type: req.type,
        includeArchived: false,
        includeRaw: req.includeRaw,
        limit: remaining,
        offset: 0,
      });
      for (const item of listed.items) {
        notes.push({
          spaceId: item.spaceId,
          slug: item.slug,
          title: item.title,
          type: item.type,
          description: item.description,
          status: item.status,
          tags: item.tags,
          linkCount: item.outboundCount + item.inboundCount,
          isRaw: item.isRaw,
        });
      }
    }
    return { spaces: spaceIds, schema, notes };
  }

  if (op === 'search') {
    const req = parseMemorySearchRequest(params);
    if (!req) throw new MemoryValidationError('invalid_request', 'invalid memory_search params');
    const spaceIds = resolveSpaceIds(req.spaceId ?? defaultReadScope(ctx), ctx);
    if (spaceIds.length === 0) return { results: [] };
    ensureAndSyncSpaces(db, ctx.bindings, spaceIds, ctx.language);

    const hits = searchIndexedNotes(db, {
      spaceIds,
      query: req.query,
      type: req.type,
      status: req.status,
      includeArchived: false,
      limit: req.limit,
    });
    return {
      results: hits.map((hit, index) => ({
        id: hit.id,
        spaceId: hit.spaceId,
        slug: hit.slug,
        title: hit.title,
        type: hit.type,
        status: hit.status,
        description: hit.description,
        snippet: hit.snippet,
        tags: hit.tags,
        isRaw: hit.isRaw,
        neighbors: hit.neighbors,
        rank: index + 1,
      })),
    };
  }

  if (op === 'read') {
    const req = parseMemoryReadRequest(params);
    if (!req) throw new MemoryValidationError('invalid_request', 'invalid memory_read params');
    const spaceIds = resolveSpaceIds(req.spaceId ?? 'all', ctx);
    if (spaceIds.length === 0) return { found: false };
    ensureAndSyncSpaces(db, ctx.bindings, spaceIds, ctx.language);

    const refs = resolveReadNoteRefs(db, spaceIds, req.note);
    if (refs.length > 1) {
      return {
        found: false,
        reason: 'ambiguous',
        note: req.note,
        candidates: refs.map(({ spaceId, relPath, title }) => ({
          id: makeNoteId(spaceId, relPath),
          spaceId,
          title,
        })),
        message:
          'This note reference matches multiple visible spaces. Retry memory_read with one of the candidate ids as note.',
      };
    }
    const ref = refs[0];
    if (!ref) return { found: false, note: req.note };
    const space = ctx.bindings.resolveSpace(ref.spaceId);
    const detail = getNoteDetail(db, ref.spaceId, ref.relPath, space.rootPath);
    if (!detail) return { found: false, note: req.note };
    return {
      found: true,
      id: detail.id,
      spaceId: detail.spaceId,
      slug: detail.slug,
      relPath: detail.relPath,
      title: detail.title,
      type: detail.type,
      status: detail.status,
      description: detail.description,
      tags: detail.tags,
      resource: detail.resource,
      sources: detail.sources,
      staleAfter: detail.staleAfter,
      isRaw: detail.isRaw,
      isArchived: detail.isArchived,
      body: detail.body,
      links: detail.links,
      backlinks: detail.backlinks,
      updatedAt: detail.updatedAt,
    };
  }

  if (op === 'upsert') {
    const req = parseMemoryUpsertRequest(params);
    if (!req) throw new MemoryValidationError('invalid_request', 'invalid memory_upsert params');
    const spaceKey = req.spaceId ?? defaultCaptureSpace(ctx);
    const spaceIds = resolveSpaceIds(spaceKey, ctx);
    const targetSpaceId = spaceIds[0];
    if (!targetSpaceId) {
      throw new MemoryValidationError(
        'no_project',
        "Cannot write to 'project' memory without an active project; set spaceId='global' instead."
      );
    }

    const sanitized = sanitizeMemoryWrite({ title: req.title, content: req.content });
    const safeDesc = req.description
      ? sanitizeMemoryWrite({ title: null, content: req.description }).content
      : undefined;

    if (needsReview(ctx, targetSpaceId)) {
      const space = ctx.bindings.resolveSpace(targetSpaceId);
      ensureVaultScaffold(space.rootPath, space.preset, ctx.language ?? 'zh', space.isExternal);
      syncSpaceIndex(db, targetSpaceId, space.rootPath);
      const pending = queuePendingWrite(
        db,
        ctx.bindings,
        {
          kind: 'agent',
          spaceId: targetSpaceId,
          botId: ctx.botId ?? null,
          chatId: ctx.chatId ?? null,
          note: req.note,
          title: sanitized.title ?? req.title,
          type: req.type,
          description: safeDesc,
          mode: req.mode,
          section: req.section,
          tags: req.tags,
          sources: req.sources ?? (ctx.sessionId ? [`session:${ctx.sessionId}`] : []),
          resource: req.resource,
          staleAfter: req.staleAfter,
          proposedBody: sanitized.content,
          redacted: sanitized.redacted,
        },
        ctx.now
      );
      ctx.onPending?.(pending.id);
      ctx.onChanged?.();
      return {
        status: 'pending_review',
        written: false,
        pendingId: pending.id,
        spaceId: targetSpaceId,
        slug: pending.slug,
        title: pending.title,
        ...(sanitized.redacted ? { redacted: true } : {}),
        message:
          `Not written yet: writes from Bot members to ${targetSpaceId === GLOBAL_SPACE ? 'global' : 'project'} ` +
          'wiki memory require user approval and have been queued in the inbox.',
      };
    }

    const res = await upsertWikiNote(db, ctx.bindings, {
      spaceId: targetSpaceId,
      note: req.note,
      title: sanitized.title ?? req.title,
      type: req.type,
      description: safeDesc,
      content: sanitized.content,
      mode: req.mode,
      section: req.section,
      tags: req.tags,
      sources: req.sources ?? (ctx.sessionId ? [`session:${ctx.sessionId}`] : []),
      resource: req.resource,
      staleAfter: req.staleAfter,
      actor: ctx.botId ? `bot:${ctx.botId}` : 'collabra-agent',
      status: 'draft',
      language: ctx.language,
      now: ctx.now,
      skipSanitize: true,
      onSelfWrite: ctx.onSelfWrite,
    });
    ctx.onChanged?.();
    return {
      status: res.action,
      written: true,
      spaceId: res.spaceId,
      relPath: res.relPath,
      slug: res.slug,
      title: res.title,
      type: res.type,
      noteStatus: res.status,
      ...(sanitized.redacted ? { redacted: true } : {}),
    };
  }

  if (op === 'archive') {
    const req = parseMemoryArchiveRequest(params);
    if (!req) throw new MemoryValidationError('invalid_request', 'invalid memory_archive params');
    const spaceIds = resolveSpaceIds(req.spaceId ?? defaultCaptureSpace(ctx), ctx);
    if (spaceIds.length === 0) {
      throw new MemoryValidationError('no_project', 'No target memory space available.');
    }
    ensureAndSyncSpaces(db, ctx.bindings, spaceIds, ctx.language);

    const ref = resolveNoteRef(db, spaceIds, req.note);
    if (!ref) {
      throw new MemoryValidationError('not_found', `Memory note not found: ${req.note}`);
    }
    if (ref.isRaw) {
      throw new MemoryValidationError(
        'readonly_raw',
        'Cannot archive read-only raw/ reference files.'
      );
    }
    if (needsReview(ctx, ref.spaceId)) {
      throw new MemoryValidationError(
        'permission_denied',
        'Bot members cannot archive notes in shared project or global vaults directly.'
      );
    }

    const archived = await withSpaceLock(ref.spaceId, () => {
      const space = ctx.bindings.resolveSpace(ref.spaceId);
      ctx.onSelfWrite?.(space.rootPath);
      const out = archiveNoteFile(space.rootPath, ref.relPath, {
        reason: req.reason,
        supersededBy: req.supersededBy,
        now: ctx.now,
      });
      syncSpaceIndex(db, ref.spaceId, space.rootPath, { updateManagedIndex: true });
      return out;
    });
    ctx.onChanged?.();
    return {
      status: 'archived',
      spaceId: ref.spaceId,
      slug: archived.slug,
      archivedPath: archived.relPath,
    };
  }

  throw new MemoryValidationError('unsupported_op', `Unsupported memory op: ${String(op)}`);
}
