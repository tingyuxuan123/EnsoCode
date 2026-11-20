import { randomUUID } from 'node:crypto';
import type { UpsertMode } from '@shared/memory/constants';
import type { PendingMemoryWriteDto, PendingMemoryWriteKind } from '@shared/memory/dto';
import {
  normalizeNoteType,
  parseMarkdownNote,
  patchMarkdownSection,
  relPathToSlug,
  serializeMarkdownNote,
} from '@shared/memory/markdown';
import type Database from 'better-sqlite3';
import type { VaultBindingStore } from './bindings';
import { syncSpaceIndex } from './indexDb';
import { resolveTargetRelPath } from './operations';
import { appendVaultLog, ensureVaultScaffold, readNoteFile, writeNoteAtomic } from './vault';

export interface PendingWriteInput {
  kind: PendingMemoryWriteKind;
  spaceId: string;
  botId: string | null;
  chatId: string | null;
  note?: string;
  title: string;
  type: string;
  description?: string;
  mode: UpsertMode;
  section?: string;
  tags?: string[];
  sources?: string[];
  resource?: string;
  staleAfter?: string;
  proposedBody: string;
  redacted: boolean;
}

interface RawPendingRow {
  id: string;
  kind: string;
  space_id: string;
  bot_id: string | null;
  chat_id: string | null;
  target_rel_path: string;
  slug: string;
  title: string;
  type: string;
  description: string | null;
  mode: string;
  section: string | null;
  tags_json: string;
  sources_json: string;
  resource: string | null;
  stale_after: string | null;
  existing_body: string | null;
  proposed_body: string;
  redacted: number;
  created_at: string;
}

function parseJsonStrings(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function toDto(row: RawPendingRow, spaceLabel: (spaceId: string) => string): PendingMemoryWriteDto {
  return {
    id: row.id,
    kind: row.kind === 'compile' ? 'compile' : 'agent',
    spaceId: row.space_id,
    spaceLabel: spaceLabel(row.space_id),
    botId: row.bot_id,
    chatId: row.chat_id,
    targetRelPath: row.target_rel_path,
    slug: row.slug,
    title: row.title,
    type: row.type,
    description: row.description,
    mode: (row.mode === 'append' || row.mode === 'section' ? row.mode : 'replace') as UpsertMode,
    section: row.section,
    existingBody: row.existing_body,
    proposedBody: row.proposed_body,
    redacted: row.redacted === 1,
    createdAt: row.created_at,
  };
}

export function queuePendingWrite(
  db: Database.Database,
  bindings: VaultBindingStore,
  input: PendingWriteInput,
  now: Date = new Date()
): PendingMemoryWriteDto {
  const space = bindings.resolveSpace(input.spaceId);
  const safeType = normalizeNoteType(input.type);
  const target = resolveTargetRelPath(db, input.spaceId, input.note, input.title, safeType);
  const existingRaw = readNoteFile(space.rootPath, target.relPath);
  const existingBody = existingRaw ? parseMarkdownNote(existingRaw, input.title).body : null;
  const slug = relPathToSlug(target.relPath);
  const id = randomUUID();
  const createdAt = now.toISOString();

  db.prepare(
    `INSERT INTO pending_writes (
       id, kind, space_id, bot_id, chat_id, target_rel_path, slug, title, type,
       description, mode, section, tags_json, sources_json, resource, stale_after,
       existing_body, proposed_body, redacted, status, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`
  ).run(
    id,
    input.kind,
    input.spaceId,
    input.botId,
    input.chatId,
    target.relPath,
    slug,
    input.title,
    safeType,
    input.description ?? null,
    input.mode,
    input.section ?? null,
    JSON.stringify(input.tags ?? []),
    JSON.stringify(input.sources ?? []),
    input.resource ?? null,
    input.staleAfter ?? null,
    existingBody,
    input.proposedBody,
    input.redacted ? 1 : 0,
    createdAt
  );

  const row = db.prepare('SELECT * FROM pending_writes WHERE id = ?').get(id) as RawPendingRow;
  return toDto(row, (s) => s);
}

export function listPendingWrites(
  db: Database.Database,
  spaceLabel: (spaceId: string) => string = (s) => s
): PendingMemoryWriteDto[] {
  const rows = db
    .prepare(
      "SELECT * FROM pending_writes WHERE status = 'pending' ORDER BY created_at ASC, id ASC"
    )
    .all() as RawPendingRow[];
  return rows.map((row) => toDto(row, spaceLabel));
}

export function rejectPendingWrite(db: Database.Database, id: string): boolean {
  return (
    db
      .prepare("UPDATE pending_writes SET status = 'rejected' WHERE id = ? AND status = 'pending'")
      .run(id).changes > 0
  );
}

export function approvePendingWrite(
  db: Database.Database,
  id: string,
  bindings: VaultBindingStore,
  opts: { language?: string; now?: Date; onSelfWrite?: (rootPath: string) => void } = {}
): { ok: boolean; relPath?: string; spaceId?: string; error?: string } {
  const row = db
    .prepare("SELECT * FROM pending_writes WHERE id = ? AND status = 'pending'")
    .get(id) as RawPendingRow | undefined;
  if (!row) return { ok: false, error: 'Pending write not found.' };

  const now = opts.now ?? new Date();
  const isoNow = now.toISOString();
  const space = bindings.resolveSpace(row.space_id);
  ensureVaultScaffold(space.rootPath, space.preset, opts.language ?? 'zh', space.isExternal);

  const existingRaw = readNoteFile(space.rootPath, row.target_rel_path);
  const existingParsed = existingRaw ? parseMarkdownNote(existingRaw, row.title) : null;

  let nextBody: string;
  if (!existingParsed || row.mode === 'replace') {
    nextBody = row.proposed_body.trim();
  } else if (row.mode === 'section' && row.section) {
    nextBody = patchMarkdownSection(existingParsed.body, row.section, row.proposed_body);
  } else {
    const prev = existingParsed.body.trimEnd();
    nextBody = prev ? `${prev}\n\n${row.proposed_body.trim()}` : row.proposed_body.trim();
  }

  const tags = [
    ...new Set([...(existingParsed?.frontmatter.tags ?? []), ...parseJsonStrings(row.tags_json)]),
  ];
  const sources = [
    ...new Set([
      ...(existingParsed?.frontmatter.sources ?? []),
      ...parseJsonStrings(row.sources_json),
    ]),
  ];

  const markdown = serializeMarkdownNote(
    {
      type: row.type,
      title: row.title,
      ...(row.description
        ? { description: row.description }
        : existingParsed?.frontmatter.description
          ? { description: existingParsed.frontmatter.description }
          : {}),
      status: 'verified',
      tags,
      ...(row.resource
        ? { resource: row.resource }
        : existingParsed?.frontmatter.resource
          ? { resource: existingParsed.frontmatter.resource }
          : {}),
      generated: { by: row.bot_id ? `bot:${row.bot_id}` : 'collabra-agent', at: row.created_at },
      verified: { by: 'user', at: isoNow },
      ...(row.stale_after
        ? { stale_after: row.stale_after }
        : existingParsed?.frontmatter.stale_after
          ? { stale_after: existingParsed.frontmatter.stale_after }
          : {}),
      sources,
      extra: existingParsed?.frontmatter.extra ?? {},
    },
    nextBody
  );

  opts.onSelfWrite?.(space.rootPath);
  const writtenRel = writeNoteAtomic(space.rootPath, row.target_rel_path, markdown);
  appendVaultLog(space.rootPath, {
    action: existingParsed ? 'update' : 'create',
    slug: relPathToSlug(writtenRel),
    detail: `${row.title} (approved)`,
    now,
  });
  syncSpaceIndex(db, row.space_id, space.rootPath, { updateManagedIndex: true });
  db.prepare("UPDATE pending_writes SET status = 'approved' WHERE id = ?").run(id);
  return { ok: true, relPath: writtenRel, spaceId: row.space_id };
}
