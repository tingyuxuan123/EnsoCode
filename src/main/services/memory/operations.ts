import type { NoteStatus, UpsertMode } from '@shared/memory/constants';
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
import type Database from 'better-sqlite3';
import type { VaultBindingStore } from './bindings';
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
}

export function resolveTargetRelPath(
  db: Database.Database,
  spaceId: string,
  noteRef: string | undefined,
  title: string,
  type: string
): { relPath: string; exists: boolean } {
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
  const safeType = normalizeNoteType(type);
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

    let nextBody: string;
    if (!existingParsed || input.mode === 'replace') {
      nextBody = safeWrite.content.trim();
    } else if (input.mode === 'section' && input.section?.trim()) {
      nextBody = patchMarkdownSection(existingParsed.body, input.section, safeWrite.content);
    } else {
      const prev = existingParsed.body.trimEnd();
      nextBody = prev ? `${prev}\n\n${safeWrite.content.trim()}` : safeWrite.content.trim();
    }

    const mergedTags = [
      ...new Set([...(existingParsed?.frontmatter.tags ?? []), ...(input.tags ?? [])]),
    ];
    const mergedSources = [
      ...new Set([...(existingParsed?.frontmatter.sources ?? []), ...(input.sources ?? [])]),
    ];

    const status: NoteStatus = input.status ?? (input.actor === 'user' ? 'verified' : 'draft');

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

    return {
      action,
      spaceId: input.spaceId,
      relPath: writtenRel,
      slug,
      title: safeTitle,
      type: safeType,
      status,
      redacted: safeWrite.redacted,
    };
  });
}
