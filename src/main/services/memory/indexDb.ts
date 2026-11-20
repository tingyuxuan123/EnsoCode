import fs from 'node:fs';
import path from 'node:path';
import type { NoteStatus } from '@shared/memory/constants';
import type {
  MemoryListQuery,
  MemoryListResult,
  MemoryNoteDetail,
  MemoryNoteSummary,
  NoteBacklinkDto,
  NoteLinkDto,
} from '@shared/memory/dto';
import type {
  GraphEdgeDto,
  GraphNodeDto,
  GraphQuery,
  MemoryGraphDto,
  TreeNodeDto,
  TreeQuery,
} from '@shared/memory/graphDto';
import {
  makeNoteId,
  parseMarkdownNote,
  relPathToSlug,
  resolveWikiLinkTarget,
  type WikiLinkTargetCandidate,
} from '@shared/memory/markdown';
import Database from 'better-sqlite3';
import { contentHash } from './contentHash';
import { buildFtsMatchQuery } from './fts';
import type { IndexedNoteRow } from './types';
import { readNoteFile, scanVaultMarkdownFiles, writeManagedIndex } from './vault';

export const INDEX_SCHEMA_VERSION = 1;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS notes (
  rowid         INTEGER PRIMARY KEY AUTOINCREMENT,
  space_id      TEXT NOT NULL,
  rel_path      TEXT NOT NULL,
  slug          TEXT NOT NULL,
  title         TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  type          TEXT NOT NULL DEFAULT 'note',
  status        TEXT NOT NULL DEFAULT 'verified',
  tags_json     TEXT NOT NULL DEFAULT '[]',
  tags_text     TEXT NOT NULL DEFAULT '',
  resource      TEXT,
  generated_by  TEXT,
  generated_at  TEXT,
  verified_by   TEXT,
  verified_at   TEXT,
  stale_after   TEXT,
  sources_json  TEXT NOT NULL DEFAULT '[]',
  superseded_by TEXT,
  is_raw        INTEGER NOT NULL DEFAULT 0,
  is_archived   INTEGER NOT NULL DEFAULT 0,
  content_hash  TEXT NOT NULL,
  mtime_ms      REAL NOT NULL,
  size_bytes    INTEGER NOT NULL,
  line_count    INTEGER NOT NULL DEFAULT 0,
  body_preview  TEXT NOT NULL DEFAULT '',
  body_text     TEXT NOT NULL DEFAULT '',
  updated_at    TEXT NOT NULL,
  UNIQUE (space_id, rel_path)
);

CREATE INDEX IF NOT EXISTS notes_space_idx ON notes (space_id, is_archived, is_raw, type, status);
CREATE INDEX IF NOT EXISTS notes_slug_idx ON notes (space_id, slug);

CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
  title,
  description,
  tags_text,
  body_text,
  content='notes',
  content_rowid='rowid',
  tokenize='trigram'
);

CREATE TRIGGER IF NOT EXISTS notes_ai AFTER INSERT ON notes BEGIN
  INSERT INTO notes_fts(rowid, title, description, tags_text, body_text)
  VALUES (new.rowid, new.title, new.description, new.tags_text, new.body_text);
END;

CREATE TRIGGER IF NOT EXISTS notes_ad AFTER DELETE ON notes BEGIN
  INSERT INTO notes_fts(notes_fts, rowid, title, description, tags_text, body_text)
  VALUES ('delete', old.rowid, old.title, old.description, old.tags_text, old.body_text);
END;

CREATE TRIGGER IF NOT EXISTS notes_au AFTER UPDATE ON notes BEGIN
  INSERT INTO notes_fts(notes_fts, rowid, title, description, tags_text, body_text)
  VALUES ('delete', old.rowid, old.title, old.description, old.tags_text, old.body_text);
  INSERT INTO notes_fts(rowid, title, description, tags_text, body_text)
  VALUES (new.rowid, new.title, new.description, new.tags_text, new.body_text);
END;

CREATE TABLE IF NOT EXISTS links (
  space_id    TEXT NOT NULL,
  source_path TEXT NOT NULL,
  target_raw  TEXT NOT NULL,
  target_path TEXT,
  is_broken   INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS links_source_idx ON links (space_id, source_path);
CREATE INDEX IF NOT EXISTS links_target_idx ON links (space_id, target_path);

CREATE TABLE IF NOT EXISTS compile_jobs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT NOT NULL,
  fingerprint TEXT NOT NULL UNIQUE,
  payload     TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending',
  attempts    INTEGER NOT NULL DEFAULT 0,
  written     INTEGER NOT NULL DEFAULT 0,
  error       TEXT,
  notes_json  TEXT NOT NULL DEFAULT '[]',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS compile_jobs_status_idx ON compile_jobs (status, created_at);

CREATE TABLE IF NOT EXISTS pending_writes (
  id              TEXT PRIMARY KEY,
  kind            TEXT NOT NULL DEFAULT 'agent',
  space_id        TEXT NOT NULL,
  bot_id          TEXT,
  chat_id         TEXT,
  target_rel_path TEXT NOT NULL,
  slug            TEXT NOT NULL,
  title           TEXT NOT NULL,
  type            TEXT NOT NULL,
  description     TEXT,
  mode            TEXT NOT NULL DEFAULT 'replace',
  section         TEXT,
  tags_json       TEXT NOT NULL DEFAULT '[]',
  sources_json    TEXT NOT NULL DEFAULT '[]',
  resource        TEXT,
  stale_after     TEXT,
  existing_body   TEXT,
  proposed_body   TEXT NOT NULL,
  redacted        INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'pending',
  created_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS pending_writes_status_idx ON pending_writes (status, created_at);
`;

export function openIndexDb(dbPath: string): Database.Database {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  const current = Number(db.pragma('user_version', { simple: true }) ?? 0);
  if (current !== INDEX_SCHEMA_VERSION) {
    // 派生索引可随时清空重建；schema 升级直接重建表，零历史包袱
    db.exec(`
      DROP TRIGGER IF EXISTS notes_ai;
      DROP TRIGGER IF EXISTS notes_ad;
      DROP TRIGGER IF EXISTS notes_au;
      DROP TABLE IF EXISTS notes_fts;
      DROP TABLE IF EXISTS notes;
      DROP TABLE IF EXISTS links;
      DROP TABLE IF EXISTS compile_jobs;
      DROP TABLE IF EXISTS pending_writes;
    `);
    db.exec(SCHEMA_SQL);
    db.pragma(`user_version = ${INDEX_SCHEMA_VERSION}`);
  } else {
    db.exec(SCHEMA_SQL);
  }
  return db;
}

interface RawNoteRow {
  space_id: string;
  rel_path: string;
  slug: string;
  title: string;
  description: string;
  type: string;
  status: string;
  tags_json: string;
  resource: string | null;
  generated_by: string | null;
  generated_at: string | null;
  verified_by: string | null;
  verified_at: string | null;
  stale_after: string | null;
  sources_json: string;
  superseded_by: string | null;
  is_raw: number;
  is_archived: number;
  content_hash: string;
  mtime_ms: number;
  size_bytes: number;
  line_count: number;
  body_preview: string;
  updated_at: string;
  outbound_count?: number;
  inbound_count?: number;
}

function parseJsonArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function makePreview(body: string): string {
  const flat = body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^#+\s*/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
  const chars = Array.from(flat);
  return chars.length <= 240 ? chars.join('') : `${chars.slice(0, 240).join('')}…`;
}

function toSummary(row: RawNoteRow, spaceLabel: (spaceId: string) => string): MemoryNoteSummary {
  return {
    id: makeNoteId(row.space_id, row.rel_path),
    spaceId: row.space_id,
    spaceLabel: spaceLabel(row.space_id),
    relPath: row.rel_path,
    slug: row.slug,
    title: row.title,
    description: row.description,
    type: row.type,
    status: (row.status === 'draft' || row.status === 'verified' || row.status === 'deprecated'
      ? row.status
      : 'verified') as NoteStatus,
    tags: parseJsonArray(row.tags_json),
    isRaw: row.is_raw === 1,
    isArchived: row.is_archived === 1,
    generatedBy: row.generated_by,
    generatedAt: row.generated_at,
    verifiedBy: row.verified_by,
    verifiedAt: row.verified_at,
    staleAfter: row.stale_after,
    outboundCount: row.outbound_count ?? 0,
    inboundCount: row.inbound_count ?? 0,
    lineCount: row.line_count,
    updatedAt: row.updated_at,
  };
}

function toIndexedRow(row: RawNoteRow): IndexedNoteRow {
  return {
    spaceId: row.space_id,
    relPath: row.rel_path,
    slug: row.slug,
    title: row.title,
    description: row.description,
    type: row.type,
    status: row.status as NoteStatus,
    tags: parseJsonArray(row.tags_json),
    resource: row.resource,
    generatedBy: row.generated_by,
    generatedAt: row.generated_at,
    verifiedBy: row.verified_by,
    verifiedAt: row.verified_at,
    staleAfter: row.stale_after,
    sources: parseJsonArray(row.sources_json),
    supersededBy: row.superseded_by,
    isRaw: row.is_raw === 1,
    isArchived: row.is_archived === 1,
    contentHash: row.content_hash,
    mtimeMs: row.mtime_ms,
    sizeBytes: row.size_bytes,
    lineCount: row.line_count,
    bodyPreview: row.body_preview,
    updatedAt: row.updated_at,
  };
}

export interface SyncSpaceResult {
  indexed: number;
  changed: number;
  removed: number;
  indexFilename: string | null;
}

/**
 * 增量扫描 Vault 目录并刷新派生索引、解析全空间 `[[wikilink]]` 边表，并在有变更时重写托管 `index.md`。
 */
export function syncSpaceIndex(
  db: Database.Database,
  spaceId: string,
  rootPath: string,
  opts: { updateManagedIndex?: boolean; force?: boolean } = {}
): SyncSpaceResult {
  const scanned = scanVaultMarkdownFiles(rootPath);
  const existingRows = db
    .prepare('SELECT rel_path, mtime_ms, size_bytes, content_hash FROM notes WHERE space_id = ?')
    .all(spaceId) as {
    rel_path: string;
    mtime_ms: number;
    size_bytes: number;
    content_hash: string;
  }[];
  const existingMap = new Map(existingRows.map((r) => [r.rel_path, r]));
  const seenPaths = new Set<string>();

  const toUpsert: {
    file: (typeof scanned)[number];
    parsed: ReturnType<typeof parseMarkdownNote>;
    hash: string;
  }[] = [];

  for (const file of scanned) {
    seenPaths.add(file.relPath);
    const prev = existingMap.get(file.relPath);
    if (
      !opts.force &&
      prev &&
      Math.abs(prev.mtime_ms - file.mtimeMs) < 1 &&
      prev.size_bytes === file.sizeBytes
    ) {
      continue;
    }
    let raw: string;
    try {
      raw = fs.readFileSync(file.absPath, 'utf8');
    } catch {
      continue;
    }
    const hash = contentHash(raw);
    const fallbackTitle = path.basename(file.relPath, '.md');
    const parsed = parseMarkdownNote(raw, fallbackTitle);
    toUpsert.push({ file, parsed, hash });
  }

  const removedPaths = existingRows
    .map((r) => r.rel_path)
    .filter((relPath) => !seenPaths.has(relPath));

  const changed = toUpsert.length;
  const removed = removedPaths.length;

  const upsertStmt = db.prepare(`
    INSERT INTO notes (
      space_id, rel_path, slug, title, description, type, status, tags_json, tags_text,
      resource, generated_by, generated_at, verified_by, verified_at, stale_after,
      sources_json, superseded_by, is_raw, is_archived, content_hash, mtime_ms,
      size_bytes, line_count, body_preview, body_text, updated_at
    ) VALUES (
      @space_id, @rel_path, @slug, @title, @description, @type, @status, @tags_json, @tags_text,
      @resource, @generated_by, @generated_at, @verified_by, @verified_at, @stale_after,
      @sources_json, @superseded_by, @is_raw, @is_archived, @content_hash, @mtime_ms,
      @size_bytes, @line_count, @body_preview, @body_text, @updated_at
    )
    ON CONFLICT(space_id, rel_path) DO UPDATE SET
      slug = excluded.slug,
      title = excluded.title,
      description = excluded.description,
      type = excluded.type,
      status = excluded.status,
      tags_json = excluded.tags_json,
      tags_text = excluded.tags_text,
      resource = excluded.resource,
      generated_by = excluded.generated_by,
      generated_at = excluded.generated_at,
      verified_by = excluded.verified_by,
      verified_at = excluded.verified_at,
      stale_after = excluded.stale_after,
      sources_json = excluded.sources_json,
      superseded_by = excluded.superseded_by,
      is_raw = excluded.is_raw,
      is_archived = excluded.is_archived,
      content_hash = excluded.content_hash,
      mtime_ms = excluded.mtime_ms,
      size_bytes = excluded.size_bytes,
      line_count = excluded.line_count,
      body_preview = excluded.body_preview,
      body_text = excluded.body_text,
      updated_at = excluded.updated_at
  `);

  const delNoteStmt = db.prepare('DELETE FROM notes WHERE space_id = ? AND rel_path = ?');
  const delLinksBySource = db.prepare('DELETE FROM links WHERE space_id = ? AND source_path = ?');
  const insLinkStmt = db.prepare(
    'INSERT INTO links (space_id, source_path, target_raw, target_path, is_broken) VALUES (?, ?, ?, ?, ?)'
  );

  db.transaction(() => {
    for (const relPath of removedPaths) {
      delNoteStmt.run(spaceId, relPath);
      delLinksBySource.run(spaceId, relPath);
    }

    for (const { file, parsed, hash } of toUpsert) {
      const fm = parsed.frontmatter;
      const slug = relPathToSlug(file.relPath);
      const updatedAt = new Date(file.mtimeMs).toISOString();
      upsertStmt.run({
        space_id: spaceId,
        rel_path: file.relPath,
        slug,
        title: fm.title ?? slug,
        description: fm.description ?? '',
        type: fm.type,
        status: file.isArchived ? 'deprecated' : fm.status,
        tags_json: JSON.stringify(fm.tags),
        tags_text: fm.tags.join(' '),
        resource: fm.resource ?? null,
        generated_by: fm.generated?.by ?? null,
        generated_at: fm.generated?.at ?? null,
        verified_by: fm.verified?.by ?? null,
        verified_at: fm.verified?.at ?? null,
        stale_after: fm.stale_after ?? null,
        sources_json: JSON.stringify(fm.sources),
        superseded_by: fm.superseded_by ?? null,
        is_raw: file.isRaw ? 1 : 0,
        is_archived: file.isArchived ? 1 : 0,
        content_hash: hash,
        mtime_ms: file.mtimeMs,
        size_bytes: file.sizeBytes,
        line_count: parsed.lineCount,
        body_preview: makePreview(parsed.body),
        body_text: parsed.body,
        updated_at: updatedAt,
      });

      delLinksBySource.run(spaceId, file.relPath);
      for (const link of parsed.links) {
        insLinkStmt.run(spaceId, file.relPath, link.target, null, 1);
      }
    }

    // Re-resolve link targets across the entire space whenever notes were added/changed/removed
    if (changed > 0 || removed > 0 || opts.force) {
      const candidates = db
        .prepare('SELECT rel_path AS relPath, slug, title FROM notes WHERE space_id = ?')
        .all(spaceId) as WikiLinkTargetCandidate[];
      const allLinks = db
        .prepare('SELECT rowid, target_raw FROM links WHERE space_id = ?')
        .all(spaceId) as { rowid: number; target_raw: string }[];
      const updateLink = db.prepare(
        'UPDATE links SET target_path = ?, is_broken = ? WHERE rowid = ?'
      );
      for (const row of allLinks) {
        const target = resolveWikiLinkTarget(row.target_raw, candidates);
        updateLink.run(target, target ? 0 : 1, row.rowid);
      }
    }
  }).immediate();

  let indexFilename: string | null = null;
  if (
    opts.updateManagedIndex &&
    fs.existsSync(rootPath) &&
    (changed > 0 || removed > 0 || opts.force)
  ) {
    const catalog = db
      .prepare(
        `SELECT rel_path AS relPath, slug, title, description, type, status, is_raw, is_archived
         FROM notes WHERE space_id = ?`
      )
      .all(spaceId) as {
      relPath: string;
      slug: string;
      title: string;
      description: string;
      type: string;
      status: NoteStatus;
      is_raw: number;
      is_archived: number;
    }[];
    indexFilename = writeManagedIndex(
      rootPath,
      catalog.map((c) => ({
        relPath: c.relPath,
        slug: c.slug,
        title: c.title,
        description: c.description,
        type: c.type,
        status: c.status,
        isRaw: c.is_raw === 1,
        isArchived: c.is_archived === 1,
      }))
    );
  }

  const indexed = (
    db.prepare('SELECT count(*) AS c FROM notes WHERE space_id = ?').get(spaceId) as { c: number }
  ).c;
  return { indexed, changed, removed, indexFilename };
}

export function deleteSpaceIndex(db: Database.Database, spaceId: string): void {
  db.transaction(() => {
    db.prepare('DELETE FROM links WHERE space_id = ?').run(spaceId);
    db.prepare('DELETE FROM notes WHERE space_id = ?').run(spaceId);
    db.prepare('DELETE FROM pending_writes WHERE space_id = ?').run(spaceId);
  }).immediate();
}

export interface SearchIndexedOptions {
  spaceIds: readonly string[];
  query: string;
  type?: string;
  status?: NoteStatus;
  includeArchived?: boolean;
  includeRaw?: boolean;
  limit?: number;
}

export interface SearchNoteHit {
  id: string;
  spaceId: string;
  relPath: string;
  slug: string;
  title: string;
  description: string;
  type: string;
  status: NoteStatus;
  tags: string[];
  isRaw: boolean;
  snippet: string;
  updatedAt: string;
  neighbors: { slug: string; title: string; direction: 'outbound' | 'inbound' }[];
}

export function searchIndexedNotes(
  db: Database.Database,
  opts: SearchIndexedOptions
): SearchNoteHit[] {
  if (opts.spaceIds.length === 0) return [];
  const q = opts.query.trim();
  if (!q) return [];
  const limit = Math.max(1, Math.min(50, opts.limit ?? 8));

  const placeholders = opts.spaceIds.map(() => '?').join(',');
  const baseConds = [`n.space_id IN (${placeholders})`];
  const baseParams: unknown[] = [...opts.spaceIds];
  if (!opts.includeArchived) baseConds.push('n.is_archived = 0');
  if (opts.includeRaw === false) baseConds.push('n.is_raw = 0');
  if (opts.type) {
    baseConds.push('n.type = ?');
    baseParams.push(opts.type);
  }
  if (opts.status) {
    baseConds.push('n.status = ?');
    baseParams.push(opts.status);
  }
  const baseWhere = baseConds.join(' AND ');

  const { match, short } = buildFtsMatchQuery(q);
  const scored = new Map<string, { row: RawNoteRow; score: number }>();

  const addRows = (rows: RawNoteRow[], baseScore: number) => {
    rows.forEach((row, idx) => {
      const key = `${row.space_id}::${row.rel_path}`;
      const rankScore = baseScore / (1 + idx * 0.25);
      const prev = scored.get(key);
      if (!prev) scored.set(key, { row, score: rankScore });
      else prev.score += rankScore;
    });
  };

  // 1. Exact / substring match on title, slug, tags, description (highest signal)
  const qEsc = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const titleRows = db
    .prepare(
      `SELECT n.* FROM notes n
       WHERE ${baseWhere}
         AND (n.title LIKE ? ESCAPE '\\' OR n.slug LIKE ? ESCAPE '\\' OR n.tags_text LIKE ? ESCAPE '\\' OR n.description LIKE ? ESCAPE '\\')
       ORDER BY n.updated_at DESC LIMIT ?`
    )
    .all(...baseParams, qEsc, qEsc, qEsc, qEsc, limit * 2) as RawNoteRow[];
  addRows(titleRows, 3.0);

  // 2. FTS5 trigram match (tokens >= 3 chars)
  if (match) {
    try {
      const ftsRows = db
        .prepare(
          `SELECT n.* FROM notes_fts
           JOIN notes n ON n.rowid = notes_fts.rowid
           WHERE notes_fts MATCH ? AND ${baseWhere}
           ORDER BY notes_fts.rank LIMIT ?`
        )
        .all(match, ...baseParams, limit * 3) as RawNoteRow[];
      addRows(ftsRows, 2.0);
    } catch {}
  }

  // 3. Short-token LIKE fallback (<3 chars CJK or short keywords)
  if (short.length > 0) {
    const likeConds = short
      .map(
        () =>
          "(n.title LIKE ? ESCAPE '\\' OR n.description LIKE ? ESCAPE '\\' OR n.tags_text LIKE ? ESCAPE '\\' OR n.body_text LIKE ? ESCAPE '\\')"
      )
      .join(' OR ');
    const likeParams = short.flatMap((t) => {
      const p = `%${t.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      return [p, p, p, p];
    });
    const shortRows = db
      .prepare(
        `SELECT n.* FROM notes n
         WHERE ${baseWhere} AND (${likeConds})
         ORDER BY n.updated_at DESC LIMIT ?`
      )
      .all(...baseParams, ...likeParams, limit * 2) as RawNoteRow[];
    addRows(shortRows, 1.5);
  }

  // Verified notes receive a modest trust boost over drafts
  const ordered = [...scored.values()]
    .map(({ row, score }) => ({
      row,
      score: score * (row.status === 'verified' ? 1.15 : row.status === 'deprecated' ? 0.5 : 1.0),
    }))
    .sort((a, b) => b.score - a.score || b.row.updated_at.localeCompare(a.row.updated_at))
    .slice(0, limit);

  const outLinksStmt = db.prepare(`
    SELECT n.slug, n.title FROM links l
    JOIN notes n ON n.space_id = l.space_id AND n.rel_path = l.target_path
    WHERE l.space_id = ? AND l.source_path = ? AND l.target_path IS NOT NULL
    LIMIT 6
  `);
  const inLinksStmt = db.prepare(`
    SELECT n.slug, n.title FROM links l
    JOIN notes n ON n.space_id = l.space_id AND n.rel_path = l.source_path
    WHERE l.space_id = ? AND l.target_path = ?
    LIMIT 6
  `);

  return ordered.map(({ row }) => {
    const out = outLinksStmt.all(row.space_id, row.rel_path) as { slug: string; title: string }[];
    const inc = inLinksStmt.all(row.space_id, row.rel_path) as { slug: string; title: string }[];
    const seenNeighbor = new Set<string>();
    const neighbors: SearchNoteHit['neighbors'] = [];
    for (const o of out) {
      if (seenNeighbor.has(o.slug)) continue;
      seenNeighbor.add(o.slug);
      neighbors.push({ slug: o.slug, title: o.title, direction: 'outbound' });
    }
    for (const i of inc) {
      if (seenNeighbor.has(i.slug)) continue;
      seenNeighbor.add(i.slug);
      neighbors.push({ slug: i.slug, title: i.title, direction: 'inbound' });
    }
    return {
      id: makeNoteId(row.space_id, row.rel_path),
      spaceId: row.space_id,
      relPath: row.rel_path,
      slug: row.slug,
      title: row.title,
      description: row.description,
      type: row.type,
      status: row.status as NoteStatus,
      tags: parseJsonArray(row.tags_json),
      isRaw: row.is_raw === 1,
      snippet: row.description || row.body_preview,
      updatedAt: row.updated_at,
      neighbors,
    };
  });
}

export function listIndexedNotes(
  db: Database.Database,
  query: MemoryListQuery,
  spaceLabel: (spaceId: string) => string = (s) => s
): MemoryListResult {
  const conds: string[] = [];
  const params: unknown[] = [];
  if (!query.includeArchived) conds.push('n.is_archived = 0');
  if (query.includeRaw === false) conds.push('n.is_raw = 0');
  if (query.spaceId) {
    conds.push('n.space_id = ?');
    params.push(query.spaceId);
  }
  if (query.type) {
    conds.push('n.type = ?');
    params.push(query.type);
  }
  if (query.status) {
    conds.push('n.status = ?');
    params.push(query.status);
  }
  const q = query.query?.trim() ?? '';
  if (q) {
    const { match, short } = buildFtsMatchQuery(q);
    const textConds: string[] = [];
    if (match) {
      textConds.push('n.rowid IN (SELECT rowid FROM notes_fts WHERE notes_fts MATCH ?)');
      params.push(match);
    }
    for (const token of short) {
      const p = `%${token.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      textConds.push(
        "(n.title LIKE ? ESCAPE '\\' OR n.description LIKE ? ESCAPE '\\' OR n.tags_text LIKE ? ESCAPE '\\' OR n.body_text LIKE ? ESCAPE '\\')"
      );
      params.push(p, p, p, p);
    }
    if (textConds.length > 0) conds.push(`(${textConds.join(' OR ')})`);
  }

  const where = conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : '';
  const total = (
    db.prepare(`SELECT count(*) AS total FROM notes n ${where}`).get(...params) as { total: number }
  ).total;

  const rows = db
    .prepare(
      `SELECT n.*,
              (SELECT count(*) FROM links l WHERE l.space_id = n.space_id AND l.source_path = n.rel_path) AS outbound_count,
              (SELECT count(*) FROM links l WHERE l.space_id = n.space_id AND l.target_path = n.rel_path) AS inbound_count
       FROM notes n
       ${where}
       ORDER BY n.updated_at DESC, n.slug ASC
       LIMIT ? OFFSET ?`
    )
    .all(...params, query.limit, query.offset) as RawNoteRow[];

  const typesWhere = query.spaceId ? 'WHERE space_id = ?' : '';
  const typeRows = db
    .prepare(`SELECT DISTINCT type FROM notes ${typesWhere} ORDER BY type ASC`)
    .all(...(query.spaceId ? [query.spaceId] : [])) as { type: string }[];

  return {
    items: rows.map((row) => toSummary(row, spaceLabel)),
    total,
    types: typeRows.map((r) => r.type),
  };
}

export function resolveNoteRef(
  db: Database.Database,
  spaceIds: readonly string[],
  noteRef: string
): IndexedNoteRow | null {
  const cleaned = noteRef.trim();
  if (!cleaned || spaceIds.length === 0) return null;

  // Support canonical `${spaceId}::${relPath}`
  const sep = cleaned.indexOf('::');
  if (sep > 0) {
    const spaceId = cleaned.slice(0, sep);
    const relPath = cleaned.slice(sep + 2);
    if (spaceIds.includes(spaceId)) {
      const exact = db
        .prepare('SELECT * FROM notes WHERE space_id = ? AND rel_path = ?')
        .get(spaceId, relPath) as RawNoteRow | undefined;
      if (exact) return toIndexedRow(exact);
    }
  }

  for (const spaceId of spaceIds) {
    const candidates = db
      .prepare('SELECT rel_path AS relPath, slug, title FROM notes WHERE space_id = ?')
      .all(spaceId) as WikiLinkTargetCandidate[];
    const target = resolveWikiLinkTarget(cleaned, candidates);
    if (target) {
      const row = db
        .prepare('SELECT * FROM notes WHERE space_id = ? AND rel_path = ?')
        .get(spaceId, target) as RawNoteRow | undefined;
      if (row) return toIndexedRow(row);
    }
  }
  return null;
}

export function getNoteDetail(
  db: Database.Database,
  spaceId: string,
  relPath: string,
  rootPath: string,
  spaceLabel: (id: string) => string = (s) => s
): MemoryNoteDetail | null {
  const row = db
    .prepare(
      `SELECT n.*,
              (SELECT count(*) FROM links l WHERE l.space_id = n.space_id AND l.source_path = n.rel_path) AS outbound_count,
              (SELECT count(*) FROM links l WHERE l.space_id = n.space_id AND l.target_path = n.rel_path) AS inbound_count
       FROM notes n
       WHERE n.space_id = ? AND n.rel_path = ?`
    )
    .get(spaceId, relPath) as RawNoteRow | undefined;
  if (!row) return null;

  const rawMarkdown = readNoteFile(rootPath, relPath) ?? '';
  const parsed = parseMarkdownNote(rawMarkdown, row.title);

  const linkRows = db
    .prepare(
      `SELECT l.target_raw, l.target_path, l.is_broken, n.title AS resolved_title
       FROM links l
       LEFT JOIN notes n ON n.space_id = l.space_id AND n.rel_path = l.target_path
       WHERE l.space_id = ? AND l.source_path = ?`
    )
    .all(spaceId, relPath) as {
    target_raw: string;
    target_path: string | null;
    is_broken: number;
    resolved_title: string | null;
  }[];

  const links: NoteLinkDto[] = linkRows.map((l) => ({
    raw: `[[${l.target_raw}]]`,
    target: l.target_raw,
    resolvedNoteId: l.target_path ? makeNoteId(spaceId, l.target_path) : null,
    resolvedTitle: l.resolved_title,
    isBroken: l.is_broken === 1,
  }));

  const backlinkRows = db
    .prepare(
      `SELECT DISTINCT n.rel_path, n.slug, n.title, n.type
       FROM links l
       JOIN notes n ON n.space_id = l.space_id AND n.rel_path = l.source_path
       WHERE l.space_id = ? AND l.target_path = ?
       ORDER BY n.updated_at DESC`
    )
    .all(spaceId, relPath) as { rel_path: string; slug: string; title: string; type: string }[];

  const backlinks: NoteBacklinkDto[] = backlinkRows.map((b) => ({
    noteId: makeNoteId(spaceId, b.rel_path),
    slug: b.slug,
    title: b.title,
    type: b.type,
  }));

  return {
    ...toSummary(row, spaceLabel),
    body: parsed.body,
    rawMarkdown,
    resource: row.resource,
    sources: parseJsonArray(row.sources_json),
    supersededBy: row.superseded_by,
    links,
    backlinks,
  };
}

export function buildWikiGraph(
  db: Database.Database,
  query: GraphQuery,
  spaceLabel: (id: string) => string = (s) => s
): MemoryGraphDto {
  const conds: string[] = [];
  const params: unknown[] = [];
  if (!query.includeArchived) conds.push('n.is_archived = 0');
  if (query.spaceId) {
    conds.push('n.space_id = ?');
    params.push(query.spaceId);
  }
  const where = conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : '';
  const totalNotes = (
    db.prepare(`SELECT count(*) AS c FROM notes n ${where}`).get(...params) as { c: number }
  ).c;

  const having = query.includeOrphans === false ? 'HAVING link_count > 0' : '';
  const nodeRows = db
    .prepare(
      `SELECT n.space_id, n.rel_path, n.slug, n.title, n.type, n.status, n.is_raw, n.is_archived,
              (
                (SELECT count(*) FROM links l WHERE l.space_id = n.space_id AND l.source_path = n.rel_path AND l.target_path IS NOT NULL) +
                (SELECT count(*) FROM links l WHERE l.space_id = n.space_id AND l.target_path = n.rel_path)
              ) AS link_count
       FROM notes n
       ${where}
       GROUP BY n.rowid
       ${having}
       ORDER BY link_count DESC, n.updated_at DESC
       LIMIT ?`
    )
    .all(...params, query.limit) as {
    space_id: string;
    rel_path: string;
    slug: string;
    title: string;
    type: string;
    status: NoteStatus;
    is_raw: number;
    is_archived: number;
    link_count: number;
  }[];

  const nodes: GraphNodeDto[] = nodeRows.map((r) => ({
    id: makeNoteId(r.space_id, r.rel_path),
    spaceId: r.space_id,
    spaceLabel: spaceLabel(r.space_id),
    slug: r.slug,
    title: r.title,
    noteType: r.type,
    status: r.status,
    linkCount: r.link_count,
    isRaw: r.is_raw === 1,
    isArchived: r.is_archived === 1,
  }));

  const nodeIds = new Set(nodes.map((n) => n.id));
  const linkWhere = query.spaceId
    ? 'WHERE space_id = ? AND target_path IS NOT NULL'
    : 'WHERE target_path IS NOT NULL';
  const rawEdges = db
    .prepare(`SELECT DISTINCT space_id, source_path, target_path FROM links ${linkWhere}`)
    .all(...(query.spaceId ? [query.spaceId] : [])) as {
    space_id: string;
    source_path: string;
    target_path: string;
  }[];

  const edges: GraphEdgeDto[] = [];
  for (const e of rawEdges) {
    const source = makeNoteId(e.space_id, e.source_path);
    const target = makeNoteId(e.space_id, e.target_path);
    if (source !== target && nodeIds.has(source) && nodeIds.has(target)) {
      edges.push({ source, target, label: 'links_to' });
    }
  }

  return { nodes, edges, totalNotes };
}

export function buildWikiTree(
  db: Database.Database,
  query: TreeQuery,
  spaceLabel: (id: string) => string = (s) => s
): TreeNodeDto[] {
  const conds: string[] = [];
  const params: unknown[] = [];
  if (!query.includeArchived) conds.push('is_archived = 0');
  if (query.spaceId) {
    conds.push('space_id = ?');
    params.push(query.spaceId);
  }
  const where = conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : '';
  const rows = db
    .prepare(
      `SELECT space_id, rel_path, slug, title, type, status
       FROM notes ${where}
       ORDER BY updated_at DESC, slug ASC`
    )
    .all(...params) as {
    space_id: string;
    rel_path: string;
    slug: string;
    title: string;
    type: string;
    status: NoteStatus;
  }[];

  const groups = new Map<string, { label: string; items: typeof rows }>();
  for (const row of rows) {
    const key =
      query.groupBy === 'type' ? row.type : query.groupBy === 'status' ? row.status : row.space_id;
    const label = query.groupBy === 'space' ? spaceLabel(row.space_id) : key;
    const bucket = groups.get(key) ?? { label, items: [] };
    bucket.items.push(row);
    groups.set(key, bucket);
  }

  return [...groups.entries()]
    .sort((a, b) => b[1].items.length - a[1].items.length || a[1].label.localeCompare(b[1].label))
    .map(([key, bucket]) => ({
      id: `${query.groupBy}:${key}`,
      kind: query.groupBy === 'space' ? 'space' : 'group',
      label: bucket.label,
      count: bucket.items.length,
      children: bucket.items.slice(0, query.limitPerGroup).map((item) => ({
        id: makeNoteId(item.space_id, item.rel_path),
        kind: 'note' as const,
        label: item.title,
        count: 1,
        noteId: makeNoteId(item.space_id, item.rel_path),
        slug: item.slug,
        status: item.status,
      })),
    }));
}
