import {
  type NoteStatus,
  STATUS_NOTE_REL_PATH,
  STATUS_NOTE_TYPE,
  type UpsertMode,
} from '@shared/memory/constants';
import {
  normalizeNoteSlug,
  normalizeNoteType,
  type OkfFrontmatter,
  parseMarkdownNote,
  patchMarkdownSection,
  relPathToSlug,
  resolveSafeRelPath,
  serializeMarkdownNote,
} from '@shared/memory/markdown';
import { type NoteDiff, noteDiff } from '@shared/memory/noteDiff';
import type Database from 'better-sqlite3';
import type { VaultBindingStore } from './bindings';
import { contentHash } from './contentHash';
import { resolveNoteRef, syncSpaceIndex } from './indexDb';
import { sanitizeMemoryWrite } from './safety';
import { MemoryValidationError } from './types';
import {
  appendVaultLog,
  ensureVaultScaffold,
  readNoteFile,
  withSpaceLock,
  writeNoteAtomic,
} from './vault';

export interface UpsertWikiNoteInput {
  spaceId: string;
  note?: string;
  title: string;
  type: string;
  description?: string;
  content: string;
  mode: UpsertMode;
  section?: string;
  tags?: string[];
  sources?: string[];
  resource?: string;
  staleAfter?: string;
  actor: string;
  status?: NoteStatus;
  language?: string;
  now?: Date;
  skipSanitize?: boolean;
  onSelfWrite?: (rootPath: string) => void;
  /** 调用方读到的正文指纹；不一致说明期间被改过，replace 降级为追加，不覆盖别人的编辑 */
  expectedBodyHash?: string;
  /** 降级追加时用这段内容（通常是模型给的增量结论），而不是整页重写结果 */
  conflictFallbackContent?: string;
}

export interface UpsertWikiNoteResult {
  action: 'created' | 'updated';
  spaceId: string;
  relPath: string;
  slug: string;
  title: string;
  type: string;
  status: NoteStatus;
  redacted: boolean;
  /** 正文在写入前被外部改过，replace 已降级为追加；调用方不应再把它标成已验证 */
  downgraded?: boolean;
  /** 本次正文改动（已裁剪）；新建页没有 before，不产生 diff */
  diff?: NoteDiff;
}

export interface MarkNoteVerifiedInput {
  spaceId: string;
  relPath: string;
  /** 核验者身份，例如 MEMORY_VERIFIER_ACTOR；与写入者分开记录 */
  by: string;
  now?: Date;
  onSelfWrite?: (rootPath: string) => void;
  /** 核验等待期间正文被改过就不再盖章 */
  expectedBodyHash?: string;
}

/**
 * 只改 frontmatter 的核验标记：正文、标签、来源都原样保留。
 * 用于“模型自查通过”这条路径，用户不需要再点一次确认。
 */
export async function markNoteVerified(
  db: Database.Database,
  bindings: VaultBindingStore,
  input: MarkNoteVerifiedInput
): Promise<boolean> {
  return withSpaceLock(input.spaceId, () => {
    const space = bindings.resolveSpace(input.spaceId);
    const raw = readNoteFile(space.rootPath, input.relPath);
    if (raw === null) return false;
    const parsed = parseMarkdownNote(raw, input.relPath);
    if (parsed.frontmatter.status === 'deprecated') return false;
    // 只核验仍处于 draft 的版本：用户已经自己确认过（或已改写状态）就不再抢署名
    if (parsed.frontmatter.status !== 'draft') return false;
    if (input.expectedBodyHash && contentHash(parsed.body) !== input.expectedBodyHash) return false;

    const now = input.now ?? new Date();
    const nextFm: OkfFrontmatter = {
      ...parsed.frontmatter,
      status: 'verified',
      verified: { by: input.by, at: now.toISOString() },
    };
    input.onSelfWrite?.(space.rootPath);
    writeNoteAtomic(space.rootPath, input.relPath, serializeMarkdownNote(nextFm, parsed.body));
    appendVaultLog(space.rootPath, {
      action: 'verify',
      slug: relPathToSlug(input.relPath),
      detail: input.by,
      now,
    });
    syncSpaceIndex(db, input.spaceId, space.rootPath, { updateManagedIndex: true });
    return true;
  });
}

export function resolveTargetRelPath(
  db: Database.Database,
  spaceId: string,
  noteRef: string | undefined,
  title: string,
  type: string
): { relPath: string; exists: boolean } {
  const safeType = normalizeNoteType(type);
  if (safeType === STATUS_NOTE_TYPE) {
    // 每空间唯一状态页：固定路径，标题或显式目录变化都不会分裂成第二篇
    // 大小写不敏感的文件系统上 `wiki/Status.md` 与 `wiki/status.md` 是同一个文件，
    // 所以按小写比对，命中时沿用磁盘上真实的写法，避免多出一行索引、或覆盖别人的文件。
    const occupants = db
      .prepare('SELECT type, rel_path FROM notes WHERE space_id = ? AND lower(rel_path) = ?')
      .all(spaceId, STATUS_NOTE_REL_PATH.toLowerCase()) as {
      type: string;
      rel_path: string;
    }[];
    if (occupants.length > 1) {
      // 大小写敏感盘上同时存在两种拼写：不猜，交给人
      throw new MemoryValidationError(
        'conflict',
        `${STATUS_NOTE_REL_PATH} matches ${occupants.map((o) => o.rel_path).join(', ')}. Keep only one before writing a status page.`
      );
    }
    const occupant = occupants[0];
    if (occupant && occupant.type !== STATUS_NOTE_TYPE) {
      // 固定路径上已经有别的主题的普通笔记：拒绝覆盖，交给用户决定
      throw new MemoryValidationError(
        'conflict',
        `${STATUS_NOTE_REL_PATH} already holds a "${occupant.type}" note. Move or rename it before writing a status page.`
      );
    }
    return { relPath: occupant?.rel_path ?? STATUS_NOTE_REL_PATH, exists: Boolean(occupant) };
  }

  if (noteRef) {
    const existing = resolveNoteRef(db, [spaceId], noteRef);
    if (existing) {
      if (existing.isRaw) {
        throw new MemoryValidationError(
          'readonly_raw',
          `Refused to overwrite read-only raw file: ${existing.relPath}. Create or update a note under wiki/ instead.`
        );
      }
      return { relPath: existing.relPath, exists: true };
    }
    const safe = resolveSafeRelPath(noteRef);
    if (safe) {
      if (safe.toLowerCase().startsWith('raw/')) {
        throw new MemoryValidationError(
          'readonly_raw',
          `Cannot write into raw/ directory (${safe}); raw/ is reserved for read-only reference files.`
        );
      }
      const prefixed =
        safe.includes('/') && (safe.startsWith('wiki/') || safe.startsWith('archive/'))
          ? safe
          : `wiki/${safe}`;
      return { relPath: prefixed, exists: false };
    }
  }
  const slug = normalizeNoteSlug(title);
  return { relPath: `wiki/${safeType}/${slug}.md`, exists: false };
}

export async function upsertWikiNote(
  db: Database.Database,
  bindings: VaultBindingStore,
  input: UpsertWikiNoteInput
): Promise<UpsertWikiNoteResult> {
  const safeWrite = input.skipSanitize
    ? { title: input.title, content: input.content, redacted: false }
    : sanitizeMemoryWrite({ title: input.title, content: input.content });

  const safeTitle = (safeWrite.title ?? input.title).trim() || 'Untitled';
  const safeDesc = input.description
    ? (input.skipSanitize
        ? input.description
        : sanitizeMemoryWrite({ title: null, content: input.description }).content
      ).trim()
    : undefined;
  const safeType = normalizeNoteType(input.type);
  const now = input.now ?? new Date();
  const isoNow = now.toISOString();

  return withSpaceLock(input.spaceId, () => {
    const space = bindings.resolveSpace(input.spaceId);
    ensureVaultScaffold(space.rootPath, space.preset, input.language ?? 'zh', space.isExternal);
    syncSpaceIndex(db, input.spaceId, space.rootPath);

    const target = resolveTargetRelPath(db, input.spaceId, input.note, safeTitle, safeType);
    const existingRaw = readNoteFile(space.rootPath, target.relPath);
    const existingParsed = existingRaw ? parseMarkdownNote(existingRaw, safeTitle) : null;

    // 正文在模型思考期间被改过（外部 Obsidian / 另一个写入方）时，replace 会覆盖别人的编辑。
    // 普通页降级成“追加增量”（注意不是追加整页，否则旧结论会被重新写回来）；
    // 状态页没有“追加”这个语义，直接拒绝，让人决定。
    const bodyChangedElsewhere =
      input.expectedBodyHash !== undefined &&
      existingParsed !== null &&
      contentHash(existingParsed.body) !== input.expectedBodyHash;

    if (bodyChangedElsewhere && safeType === STATUS_NOTE_TYPE) {
      throw new MemoryValidationError(
        'conflict',
        `${target.relPath} changed while the status page was being written; retry so the rewrite is based on the current text.`
      );
    }

    // 状态页只描述“现在”，追加会立刻制造两段互相矛盾的现状——一律整篇覆盖。
    const effectiveMode: UpsertMode =
      safeType === STATUS_NOTE_TYPE
        ? 'replace'
        : bodyChangedElsewhere && input.mode === 'replace'
          ? 'append'
          : input.mode;
    const downgraded = bodyChangedElsewhere && input.mode === 'replace';

    let nextBody: string;
    if (!existingParsed || effectiveMode === 'replace') {
      nextBody = safeWrite.content.trim();
    } else if (effectiveMode === 'section' && input.section?.trim()) {
      nextBody = patchMarkdownSection(existingParsed.body, input.section, safeWrite.content);
    } else {
      const prev = existingParsed.body.trimEnd();
      // 只有降级写入才用回退内容；普通追加仍用主内容。
      // 回退内容来自模型原文，未经脱敏，落盘前必须同样过一遍安全处理。
      const fallback = downgraded ? input.conflictFallbackContent : undefined;
      const appended = (
        fallback
          ? input.skipSanitize
            ? fallback
            : sanitizeMemoryWrite({ title: null, content: fallback }).content
          : safeWrite.content
      ).trim();
      nextBody = prev ? `${prev}\n\n${appended}` : appended;
    }

    const mergedTags = [
      ...new Set([...(existingParsed?.frontmatter.tags ?? []), ...(input.tags ?? [])]),
    ];
    const mergedSources = [
      ...new Set([...(existingParsed?.frontmatter.sources ?? []), ...(input.sources ?? [])]),
    ];

    // 降级写入的是“旧正文 + 增量”，没有经过重写与核验，只能是草稿
    const status: NoteStatus = downgraded
      ? 'draft'
      : (input.status ?? (input.actor === 'user' ? 'verified' : 'draft'));

    const nextFm: OkfFrontmatter = {
      type: safeType,
      title: safeTitle,
      ...(safeDesc
        ? { description: safeDesc }
        : existingParsed?.frontmatter.description
          ? { description: existingParsed.frontmatter.description }
          : {}),
      status,
      tags: mergedTags,
      ...(input.resource
        ? { resource: input.resource }
        : existingParsed?.frontmatter.resource
          ? { resource: existingParsed.frontmatter.resource }
          : {}),
      generated: { by: input.actor, at: isoNow },
      ...(status === 'verified'
        ? { verified: { by: input.actor === 'user' ? 'user' : input.actor, at: isoNow } }
        : existingParsed?.frontmatter.verified && input.actor === 'user'
          ? { verified: existingParsed.frontmatter.verified }
          : {}),
      ...(input.staleAfter
        ? { stale_after: input.staleAfter }
        : existingParsed?.frontmatter.stale_after
          ? { stale_after: existingParsed.frontmatter.stale_after }
          : {}),
      sources: mergedSources,
      extra: existingParsed?.frontmatter.extra ?? {},
    };

    const markdown = serializeMarkdownNote(nextFm, nextBody);
    input.onSelfWrite?.(space.rootPath);
    const writtenRel = writeNoteAtomic(space.rootPath, target.relPath, markdown);
    const slug = relPathToSlug(writtenRel);
    const action: 'created' | 'updated' = existingParsed ? 'updated' : 'created';
    appendVaultLog(space.rootPath, {
      action: action === 'created' ? 'create' : 'update',
      slug,
      detail: `${safeTitle} (${input.actor})`,
      now,
    });
    syncSpaceIndex(db, input.spaceId, space.rootPath, { updateManagedIndex: true });

    const diff = existingParsed ? noteDiff(existingParsed.body, nextBody) : null;
    return {
      action,
      spaceId: input.spaceId,
      relPath: writtenRel,
      slug,
      title: safeTitle,
      type: safeType,
      status,
      redacted: safeWrite.redacted,
      ...(downgraded ? { downgraded: true } : {}),
      ...(diff ? { diff } : {}),
    };
  });
}
