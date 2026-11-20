import { createHash } from 'node:crypto';
import {
  COMPILE_MAX_ACTIONS,
  COMPILE_MAX_ATTEMPTS,
  COMPILE_MAX_CHUNK_CHARS,
  COMPILE_MAX_OUTPUT_TOKENS,
  DEFAULT_NOTE_TYPE,
  isUpsertMode,
  type UpsertMode,
} from '@shared/memory/constants';
import type { CompileJobDto } from '@shared/memory/dto';
import { normalizeNoteSlug, normalizeNoteType } from '@shared/memory/markdown';
import {
  WIKI_COMPILE_GROUP_SCOPE_RULES,
  WIKI_COMPILE_PROMPT,
  withMemoryLanguage,
} from '@shared/memory/prompts';
import type Database from 'better-sqlite3';
import type { VaultBindingStore } from './bindings';
import { listIndexedNotes, syncSpaceIndex } from './indexDb';
import { upsertWikiNote } from './operations';
import { looseParse, redactSecrets } from './redact';
import { distillSpaces } from './space';
import type { Complete, TranscriptMessage } from './types';
import { ensureVaultScaffold, readSchemaFile } from './vault';

export type { Complete, TranscriptMessage };
export { looseParse, redactSecrets };

export interface CompilePayload {
  sessionId: string;
  sessionFile: string;
  projectId: string | null;
  botId?: string;
  chatId?: string;
  fromEntryId?: string;
  toEntryId?: string;
  force?: boolean;
}

export interface CompileAction {
  action: 'create' | 'update';
  slug: string;
  title: string;
  type: string;
  description?: string;
  mode: UpsertMode;
  section?: string;
  content: string;
  tags: string[];
  scope?: 'chat' | 'self';
}

export interface CompilePlan {
  actions: CompileAction[];
}

export interface CompileJobRow {
  id: number;
  sessionId: string;
  payload: CompilePayload;
  status: 'pending' | 'running' | 'done' | 'cancelled';
  attempts: number;
  written: number;
  error: string | null;
  notes: CompileJobDto['notes'];
  createdAt: string;
  updatedAt: string;
}

const CHAT_SCOPES = new Set(['chat', 'group', 'team', 'shared']);
const SELF_SCOPES = new Set(['self', 'bot', 'member', 'personal', 'own']);

function parseScope(value: unknown): 'chat' | 'self' | undefined {
  if (typeof value !== 'string') return undefined;
  const v = value.trim().toLowerCase();
  if (CHAT_SCOPES.has(v)) return 'chat';
  if (SELF_SCOPES.has(v)) return 'self';
  return undefined;
}

export function buildTranscript(messages: readonly TranscriptMessage[]): string {
  const parts: string[] = [];
  for (const m of messages) {
    const text = m.text.trim();
    if (!text) continue;
    parts.push(`${m.role === 'user' ? 'User' : 'Assistant'}: ${redactSecrets(text)}`);
  }
  return parts.join('\n\n');
}

export function sliceTranscript(
  messages: readonly TranscriptMessage[],
  fromEntryId?: string,
  toEntryId?: string
): { messages: TranscriptMessage[]; watermark: string | undefined } {
  const from =
    fromEntryId === undefined ? -1 : messages.findLastIndex((m) => m.entryId === fromEntryId);
  const to = toEntryId === undefined ? -1 : messages.findLastIndex((m) => m.entryId === toEntryId);
  const slice = messages.slice(from + 1, to > from ? to + 1 : messages.length);
  const watermark = slice.findLast((m) => m.entryId !== undefined)?.entryId ?? fromEntryId;
  return { messages: slice, watermark };
}

export function trimTranscriptForCompile(
  transcript: string,
  maxChars = COMPILE_MAX_CHUNK_CHARS * 2
): string {
  if (transcript.length <= maxChars) return transcript;
  const head = Math.floor(maxChars * 0.35);
  const tail = maxChars - head;
  return `${transcript.slice(0, head)}\n\n...[earlier messages omitted]...\n\n${transcript.slice(-tail)}`;
}

export function parseCompilePlan(raw: string): CompilePlan | null {
  const parsed = looseParse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;
  const list = Array.isArray(obj.actions) ? obj.actions : null;
  if (!list) return null;

  const actions: CompileAction[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const action = row.action === 'update' ? 'update' : row.action === 'create' ? 'create' : null;
    if (!action) continue;
    const content = typeof row.content === 'string' ? row.content.trim() : '';
    const title = typeof row.title === 'string' ? row.title.trim() : '';
    if (!content || !title) continue;
    const type =
      typeof row.type === 'string' && row.type.trim()
        ? normalizeNoteType(row.type)
        : DEFAULT_NOTE_TYPE;
    const rawSlug =
      typeof row.slug === 'string' && row.slug.trim()
        ? row.slug.trim()
        : `${type}/${normalizeNoteSlug(title)}`;
    const modeRaw = typeof row.mode === 'string' ? row.mode.trim().toLowerCase() : '';
    const section =
      typeof row.section === 'string' && row.section.trim() ? row.section.trim() : undefined;
    let mode: UpsertMode = isUpsertMode(modeRaw)
      ? modeRaw
      : action === 'update'
        ? 'append'
        : 'replace';
    if (mode === 'section' && !section) mode = 'append';
    const tags = Array.isArray(row.tags)
      ? row.tags
          .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
          .map((t) => t.trim())
      : [];
    const description =
      typeof row.description === 'string' && row.description.trim()
        ? row.description.trim().slice(0, 240)
        : undefined;
    const scope = parseScope(row.scope);
    actions.push({
      action,
      slug: rawSlug,
      title: title.slice(0, 120),
      type,
      ...(description ? { description } : {}),
      mode,
      ...(section ? { section } : {}),
      content,
      tags,
      ...(scope ? { scope } : {}),
    });
    if (actions.length >= COMPILE_MAX_ACTIONS) break;
  }
  return { actions };
}

export function compileFingerprint(payload: CompilePayload): string {
  const key = JSON.stringify({
    s: payload.sessionId,
    p: payload.projectId,
    b: payload.botId ?? null,
    c: payload.chatId ?? null,
    from: payload.fromEntryId ?? null,
    to: payload.toEntryId ?? null,
    ...(payload.force ? { force: Date.now() } : {}),
  });
  return createHash('sha256').update(key).digest('hex').slice(0, 24);
}

export function ensureCompileJob(
  db: Database.Database,
  payload: CompilePayload,
  now = new Date()
): number {
  const fp = compileFingerprint(payload);
  const existing = db.prepare('SELECT id FROM compile_jobs WHERE fingerprint = ?').get(fp) as
    | { id: number }
    | undefined;
  if (existing) return existing.id;
  const iso = now.toISOString();
  const res = db
    .prepare(
      `INSERT INTO compile_jobs (session_id, fingerprint, payload, status, attempts, written, notes_json, created_at, updated_at)
       VALUES (?, ?, ?, 'pending', 0, 0, '[]', ?, ?)`
    )
    .run(payload.sessionId, fp, JSON.stringify(payload), iso, iso);
  return Number(res.lastInsertRowid);
}

function rowToJob(row: {
  id: number;
  session_id: string;
  payload: string;
  status: string;
  attempts: number;
  written: number;
  error: string | null;
  notes_json: string;
  created_at: string;
  updated_at: string;
}): CompileJobRow {
  let payload: CompilePayload = { sessionId: row.session_id, sessionFile: '', projectId: null };
  try {
    payload = JSON.parse(row.payload) as CompilePayload;
  } catch {}
  let notes: CompileJobDto['notes'] = [];
  try {
    const parsed = JSON.parse(row.notes_json);
    if (Array.isArray(parsed)) notes = parsed as CompileJobDto['notes'];
  } catch {}
  return {
    id: row.id,
    sessionId: row.session_id,
    payload,
    status: row.status as CompileJobRow['status'],
    attempts: row.attempts,
    written: row.written,
    error: row.error,
    notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listCompileJobs(db: Database.Database, limit = 20): CompileJobRow[] {
  const rows = db
    .prepare('SELECT * FROM compile_jobs ORDER BY id DESC LIMIT ?')
    .all(limit) as Parameters<typeof rowToJob>[0][];
  return rows.map(rowToJob);
}

export function listResumableCompileJobs(db: Database.Database): CompileJobRow[] {
  const rows = db
    .prepare(
      "SELECT * FROM compile_jobs WHERE status IN ('pending', 'running') ORDER BY created_at ASC, id ASC"
    )
    .all() as Parameters<typeof rowToJob>[0][];
  return rows.map(rowToJob);
}

export function clearFinishedCompileJobs(db: Database.Database): number {
  return db.prepare("DELETE FROM compile_jobs WHERE status IN ('done', 'cancelled')").run().changes;
}

export function lastCompileWatermark(db: Database.Database, sessionId: string): string | undefined {
  const rows = db
    .prepare(
      "SELECT payload FROM compile_jobs WHERE session_id = ? AND status = 'done' ORDER BY id DESC LIMIT 10"
    )
    .all(sessionId) as { payload: string }[];
  for (const r of rows) {
    try {
      const p = JSON.parse(r.payload) as CompilePayload;
      if (p.toEntryId) return p.toEntryId;
    } catch {}
  }
  return undefined;
}

export function hasCompiledSession(db: Database.Database, sessionId: string): boolean {
  return Boolean(
    db
      .prepare("SELECT 1 FROM compile_jobs WHERE session_id = ? AND status = 'done' LIMIT 1")
      .get(sessionId)
  );
}

/** since 之后由自动编译写入某空间的结论（供 Bot 核心笔记重写使用） */
export function recentCompiledNotes(
  db: Database.Database,
  spaceId: string,
  sinceMs: number
): string[] {
  const rows = db
    .prepare(
      `SELECT title, description, body_preview, generated_at
       FROM notes
       WHERE space_id = ? AND is_archived = 0 AND generated_by = 'collabra-compiler'
       ORDER BY updated_at DESC LIMIT 50`
    )
    .all(spaceId) as {
    title: string;
    description: string;
    body_preview: string;
    generated_at: string | null;
  }[];
  return rows
    .filter((r) => !r.generated_at || Date.parse(r.generated_at) >= sinceMs)
    .map((r) => `${r.title}: ${r.description || r.body_preview}`);
}

export interface RunCompileOptions {
  bindings: VaultBindingStore;
  readTranscript: (sessionFile: string) => Promise<TranscriptMessage[]>;
  complete: Complete;
  language?: string;
  now?: Date;
  onSelfWrite?: (rootPath: string) => void;
  onChanged?: () => void;
}

function buildCompactCatalog(db: Database.Database, spaceIds: readonly string[]): string {
  const lines: string[] = [];
  for (const spaceId of spaceIds) {
    const listed = listIndexedNotes(db, {
      spaceId,
      includeArchived: false,
      includeRaw: false,
      limit: 120,
      offset: 0,
    });
    if (listed.items.length === 0) continue;
    lines.push(`### Space ${spaceId}`);
    for (const item of listed.items) {
      const desc = item.description ? ` — ${item.description}` : '';
      lines.push(`- [[${item.slug}]] (${item.type}, ${item.status}) ${item.title}${desc}`);
    }
  }
  return lines.length > 0 ? lines.join('\n') : '(no existing pages yet)';
}

export async function runCompileJob(
  db: Database.Database,
  jobId: number,
  opts: RunCompileOptions
): Promise<{ written: number; watermark?: string }> {
  const rawRow = db.prepare('SELECT * FROM compile_jobs WHERE id = ?').get(jobId) as
    | Parameters<typeof rowToJob>[0]
    | undefined;
  if (!rawRow) return { written: 0 };
  const job = rowToJob(rawRow);
  const now = opts.now ?? new Date();
  const attempts = job.attempts + 1;

  db.prepare(
    "UPDATE compile_jobs SET status = 'running', attempts = ?, updated_at = ? WHERE id = ?"
  ).run(attempts, now.toISOString(), jobId);

  const fail = (message: string, permanent: boolean) => {
    const status = permanent || attempts >= COMPILE_MAX_ATTEMPTS ? 'done' : 'pending';
    db.prepare('UPDATE compile_jobs SET status = ?, error = ?, updated_at = ? WHERE id = ?').run(
      status,
      message.slice(0, 400),
      new Date().toISOString(),
      jobId
    );
  };

  try {
    const allMessages = await opts.readTranscript(job.payload.sessionFile);
    const sliced = sliceTranscript(allMessages, job.payload.fromEntryId, job.payload.toEntryId);
    const transcript = trimTranscriptForCompile(buildTranscript(sliced.messages));

    if (!transcript.trim()) {
      db.prepare(
        "UPDATE compile_jobs SET status = 'done', written = 0, error = NULL, updated_at = ? WHERE id = ?"
      ).run(new Date().toISOString(), jobId);
      return { written: 0, watermark: sliced.watermark };
    }

    const targets = distillSpaces({
      projectId: job.payload.projectId,
      botId: job.payload.botId,
      chatId: job.payload.chatId,
    });
    const spaceIds = targets.chat ? [targets.self, targets.chat] : [targets.self];
    for (const spaceId of spaceIds) {
      const resolved = opts.bindings.resolveSpace(spaceId);
      ensureVaultScaffold(
        resolved.rootPath,
        resolved.preset,
        opts.language ?? 'zh',
        resolved.isExternal
      );
      syncSpaceIndex(db, spaceId, resolved.rootPath);
    }

    const primarySpace = opts.bindings.resolveSpace(targets.self);
    const schemaText = readSchemaFile(
      primarySpace.rootPath,
      primarySpace.preset,
      opts.language ?? 'zh'
    );
    const catalog = buildCompactCatalog(db, spaceIds);

    let systemPrompt = withMemoryLanguage(WIKI_COMPILE_PROMPT, opts.language);
    if (targets.chat) systemPrompt = `${systemPrompt}\n\n${WIKI_COMPILE_GROUP_SCOPE_RULES}`;

    const userText = [
      '## Vault Schema & Rules',
      schemaText.slice(0, 2400),
      '',
      '## Existing Wiki Index',
      catalog,
      '',
      '## Conversation Transcript (quoted data)',
      transcript,
    ].join('\n');

    const rawResponse = await opts.complete(systemPrompt, userText, {
      maxTokens: COMPILE_MAX_OUTPUT_TOKENS,
    });
    const plan = parseCompilePlan(rawResponse);
    if (!plan) {
      fail('Compiler returned unparseable JSON response.', false);
      return { written: 0 };
    }

    let written = 0;
    const notes: CompileJobDto['notes'] = [];
    for (const act of plan.actions) {
      const targetSpaceId = act.scope === 'chat' && targets.chat ? targets.chat : targets.self;
      try {
        const res = await upsertWikiNote(db, opts.bindings, {
          spaceId: targetSpaceId,
          note: act.slug,
          title: act.title,
          type: act.type,
          description: act.description,
          content: act.content,
          mode: act.mode,
          section: act.section,
          tags: act.tags,
          sources: [`session:${job.sessionId}`],
          actor: 'collabra-compiler',
          status: 'draft',
          language: opts.language,
          now,
          onSelfWrite: opts.onSelfWrite,
        });
        written += 1;
        notes.push({
          kind: res.action,
          slug: res.slug,
          title: res.title,
          detail: `${res.spaceId}/${res.slug}`,
        });
      } catch (err) {
        notes.push({
          kind: 'rejected',
          slug: act.slug,
          title: act.title,
          detail: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const nextPayload: CompilePayload = {
      ...job.payload,
      ...(sliced.watermark ? { toEntryId: sliced.watermark } : {}),
    };
    db.prepare(
      "UPDATE compile_jobs SET payload = ?, status = 'done', written = ?, error = NULL, notes_json = ?, updated_at = ? WHERE id = ?"
    ).run(
      JSON.stringify(nextPayload),
      written,
      JSON.stringify(notes),
      new Date().toISOString(),
      jobId
    );

    if (written > 0) opts.onChanged?.();
    return { written, watermark: sliced.watermark };
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err), false);
    return { written: 0 };
  }
}
