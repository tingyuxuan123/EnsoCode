import { createHash } from 'node:crypto';
import {
  COMPILE_MAX_ACTIONS,
  COMPILE_MAX_ATTEMPTS,
  COMPILE_MAX_CHUNK_CHARS,
  COMPILE_MAX_OUTPUT_TOKENS,
  DEFAULT_NOTE_TYPE,
  isUpsertMode,
  MEMORY_VERIFIER_ACTOR,
  type UpsertMode,
  VERIFY_MAX_NOTE_CHARS,
} from '@shared/memory/constants';
import type { CompileJobDto } from '@shared/memory/dto';
import { normalizeNoteSlug, normalizeNoteType, parseMarkdownNote } from '@shared/memory/markdown';
import {
  WIKI_COMPILE_GROUP_SCOPE_RULES,
  WIKI_COMPILE_PROMPT,
  WIKI_REWRITE_PROMPT,
  WIKI_VERIFY_PROMPT,
  withMemoryLanguage,
} from '@shared/memory/prompts';
import type Database from 'better-sqlite3';
import type { VaultBindingStore } from './bindings';
import { contentHash } from './contentHash';
import { listIndexedNotes, syncSpaceIndex } from './indexDb';
import { markNoteVerified, resolveTargetRelPath, upsertWikiNote } from './operations';
import { looseParse, redactSecrets } from './redact';
import { distillSpaces } from './space';
import type { Complete, TranscriptMessage } from './types';
import { ensureVaultScaffold, readNoteFile, readSchemaFile } from './vault';

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

function stripRewriteWrapper(input: string): string | null {
  let text = input.replace(/\r\n?/g, '\n').trim();
  const fenced = text.match(/^(`{3,}|~{3,})[^\n]*\n([\s\S]*?)\n?\1\s*$/);
  if (fenced) text = fenced[2].trim();
  if (text.startsWith('---\n')) {
    const frontmatter = text.match(/^---\n[\s\S]*?\n---(?:\n|$)/);
    if (frontmatter) text = text.slice(frontmatter[0].length).trim();
  }
  return text.trim() ? text.trim() : null;
}

/**
 * 解析“就地重写”结果：模型可能返回裸 Markdown、代码围栏包住的 Markdown、
 * 带 frontmatter 的整页，或 {"content": "..."}。无有效正文时返回 null。
 */
export function parseRewriteBody(raw: string): string | null {
  const trimmed = raw.replace(/\r\n?/g, '\n').trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('{')) {
    const parsed = looseParse(trimmed);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const row = parsed as Record<string, unknown>;
      const body =
        typeof row.content === 'string'
          ? row.content
          : typeof row.body === 'string'
            ? row.body
            : '';
      return body.trim() ? stripRewriteWrapper(body) : null;
    }
    return null;
  }
  return stripRewriteWrapper(trimmed);
}

export interface VerifyVerdict {
  slug: string;
  supported: boolean;
  reason: string;
}

/**
 * 解析核验结果。任何无法确认的情况都按 unsupported 处理：
 * 失败方向必须是“留在 draft 等 lint 提醒”，不是“自动标成已验证”。
 */
export function parseVerifyVerdicts(raw: string): VerifyVerdict[] {
  const parsed = looseParse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
  const list = (parsed as Record<string, unknown>).verdicts;
  if (!Array.isArray(list)) return [];

  const out: VerifyVerdict[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const slug = typeof row.slug === 'string' ? row.slug.trim() : '';
    if (!slug) continue;
    const verdict = typeof row.verdict === 'string' ? row.verdict.trim().toLowerCase() : '';
    out.push({
      slug,
      supported: verdict === 'supported',
      reason: typeof row.reason === 'string' ? row.reason.trim().slice(0, 240) : '',
    });
  }
  return out;
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

/**
 * 已有页面必须“就地重写”：编译时模型只看到目录摘要，看不到正文，
 * 所以把当前正文交给模型重写成整页，再以 replace 落盘，
 * 避免把新结论追加在已过期的结论后面。
 * 任何一步不可靠（路径解析失败、正文过长、模型无输出）都退到“追加”，绝不退到 replace：
 * 此时模型只给了增量结论，直接 replace 会把旧页正文整段抹掉。
 */
async function mergeIntoExistingPage(
  db: Database.Database,
  opts: RunCompileOptions,
  spaceId: string,
  act: CompileAction
): Promise<{ content: string; mode: UpsertMode; expectedBodyHash?: string }> {
  // 已有页面：section 保持局部替换，其余一律追加；replace 只能由下面的成功重写产生。
  const fallback = {
    content: act.content,
    mode: (act.mode === 'section' && act.section ? 'section' : 'append') as UpsertMode,
  };

  let target: { relPath: string; exists: boolean };
  try {
    target = resolveTargetRelPath(db, spaceId, act.slug, act.title, act.type);
  } catch {
    return fallback;
  }
  if (!target.exists) return fallback;

  const space = opts.bindings.resolveSpace(spaceId);
  const existingRaw = readNoteFile(space.rootPath, target.relPath);
  if (!existingRaw) return fallback;
  const existingBody = parseMarkdownNote(existingRaw, act.title).body.trim();
  if (!existingBody || existingBody.length > COMPILE_MAX_CHUNK_CHARS) return fallback;

  try {
    const raw = await opts.complete(
      withMemoryLanguage(WIKI_REWRITE_PROMPT, opts.language),
      [
        `## Existing page (${target.relPath})`,
        existingBody,
        '',
        '## New conclusions from this session',
        act.content.trim(),
      ].join('\n'),
      { maxTokens: COMPILE_MAX_OUTPUT_TOKENS }
    );
    const body = parseRewriteBody(raw);
    return body
      ? { content: body, mode: 'replace', expectedBodyHash: contentHash(existingBody) }
      : fallback;
  } catch {
    return fallback;
  }
}

/**
 * 落盘之后的独立核验：只看“已经写下的文字”和原始证据。
 * 通过则转 verified（用户不需要再点确认），不通过就留在 draft 并说明理由。
 * 核验调用失败不阻塞写入，页面继续保持 draft，由 lint 的 unverified_draft 兜底。
 */
async function auditWrittenNotes(
  opts: RunCompileOptions,
  written: readonly { spaceId: string; relPath: string; slug: string; title: string }[],
  transcript: string
): Promise<Map<string, VerifyVerdict & { bodyHash: string }>> {
  // 按空间分组：不同空间可能有一模一样的 slug，混在一起核验会把 A 的结论盖到 B 上。
  // 正文超过展示上限的笔记不发去核验——没看全就盖章等于谎报。
  const bySpace = new Map<
    string,
    { slug: string; relPath: string; body: string; head: string }[]
  >();
  const seenPerSpace = new Map<string, Set<string>>();
  const ambiguous = new Set<string>();
  for (const note of written) {
    const space = opts.bindings.resolveSpace(note.spaceId);
    const raw = readNoteFile(space.rootPath, note.relPath);
    if (!raw) continue;
    const body = parseMarkdownNote(raw, note.title).body.trim();
    if (!body) continue;
    if (body.length > VERIFY_MAX_NOTE_CHARS) continue;
    // 同一空间下 slug 可能撞车（`x.md` 与 `wiki/x.md`）；撞了就不核验，
    // 否则会把 A 的 verdict/哈希盖到 B 上。
    const seen = seenPerSpace.get(note.spaceId) ?? new Set<string>();
    if (seen.has(note.slug)) {
      ambiguous.add(`${note.spaceId}::${note.slug}`);
      continue;
    }
    seen.add(note.slug);
    seenPerSpace.set(note.spaceId, seen);
    const bucket = bySpace.get(note.spaceId) ?? [];
    bucket.push({
      slug: note.slug,
      relPath: note.relPath,
      body,
      head: [`### [[${note.slug}]] ${note.title}`, body].join('\n'),
    });
    bySpace.set(note.spaceId, bucket);
  }
  if (bySpace.size === 0) return new Map();

  const out = new Map<string, VerifyVerdict & { bodyHash: string }>();
  for (const [spaceId, notes] of bySpace) {
    const auditable = notes.filter((note) => !ambiguous.has(`${spaceId}::${note.slug}`));
    if (auditable.length === 0) continue;
    try {
      const raw = await opts.complete(
        withMemoryLanguage(WIKI_VERIFY_PROMPT, opts.language),
        [
          '## Evidence (quoted data)',
          trimTranscriptForCompile(transcript, COMPILE_MAX_CHUNK_CHARS),
          '',
          '## Notes to audit',
          auditable.map((note) => note.head).join('\n\n'),
        ].join('\n'),
        { maxTokens: COMPILE_MAX_OUTPUT_TOKENS }
      );
      // 只用送审项回填：同 slug 但被跳过（超长/撞车）的笔记不能借用它的路径
      const bySlug = new Map(auditable.map((note) => [note.slug, note] as const));
      for (const verdict of parseVerifyVerdicts(raw)) {
        const target = bySlug.get(verdict.slug);
        if (!target) continue;
        out.set(`${spaceId}::${target.relPath}`, {
          ...verdict,
          bodyHash: contentHash(target.body),
        });
      }
    } catch {
      // 单个空间核验失败不影响其他空间；这些页面保持 draft
    }
  }
  return out;
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
    const auditQueue: {
      spaceId: string;
      relPath: string;
      slug: string;
      title: string;
      entry: number;
    }[] = [];
    for (const act of plan.actions) {
      const targetSpaceId = act.scope === 'chat' && targets.chat ? targets.chat : targets.self;
      try {
        const merged = await mergeIntoExistingPage(db, opts, targetSpaceId, act);
        const res = await upsertWikiNote(db, opts.bindings, {
          spaceId: targetSpaceId,
          note: act.slug,
          title: act.title,
          type: act.type,
          description: act.description,
          content: merged.content,
          mode: merged.mode,
          ...(merged.expectedBodyHash ? { expectedBodyHash: merged.expectedBodyHash } : {}),
          conflictFallbackContent: act.content,
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
          detail: res.downgraded
            ? `${res.spaceId}/${res.slug} · draft: page changed during compile`
            : `${res.spaceId}/${res.slug}`,
        });
        // 降级写入的是“旧正文 + 增量”，没有经过重写，不参与核验
        if (!res.downgraded) {
          auditQueue.push({
            spaceId: res.spaceId,
            relPath: res.relPath,
            slug: res.slug,
            title: res.title,
            entry: notes.length - 1,
          });
        } else {
          // 同一页先成功写入、后被降级：之前排队的核验项会读到最终稿并盖章，必须撤掉
          for (let i = auditQueue.length - 1; i >= 0; i -= 1) {
            const queued = auditQueue[i];
            if (queued.spaceId === res.spaceId && queued.relPath === res.relPath) {
              auditQueue.splice(i, 1);
            }
          }
        }
      } catch (err) {
        notes.push({
          kind: 'rejected',
          slug: act.slug,
          title: act.title,
          detail: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (auditQueue.length > 0) {
      const verdicts = await auditWrittenNotes(opts, auditQueue, transcript);
      for (const item of auditQueue) {
        const verdict = verdicts.get(`${item.spaceId}::${item.relPath}`);
        const verified =
          verdict?.supported === true &&
          (await markNoteVerified(db, opts.bindings, {
            spaceId: item.spaceId,
            relPath: item.relPath,
            by: MEMORY_VERIFIER_ACTOR,
            now,
            onSelfWrite: opts.onSelfWrite,
            expectedBodyHash: verdict.bodyHash,
          }));
        const current = notes[item.entry];
        notes[item.entry] = {
          ...current,
          detail: verified
            ? `${current.detail} · verified`
            : `${current.detail} · draft${verdict?.reason ? `: ${verdict.reason}` : ''}`,
        };
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
