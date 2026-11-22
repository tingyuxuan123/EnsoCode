import {
  LINT_OVERSIZED_LINES,
  LINT_STALE_DRAFT_DAYS,
  LINT_STATUS_MAX_LINES,
  LINT_STATUS_STALE_DAYS,
  STATUS_NOTE_TYPE,
} from '@shared/memory/constants';
import type { MemoryLintIssue, MemoryLintReport } from '@shared/memory/dto';
import { makeNoteId } from '@shared/memory/markdown';
import type Database from 'better-sqlite3';

export interface VaultLintOptions {
  spaceIds?: readonly string[];
  now?: Date;
  spaceLabel?: (spaceId: string) => string;
}

/**
 * 确定性健康检查（零 LLM 成本）：
 * 1. broken_link — 无法解析的 [[wikilink]]
 * 2. orphan — 孤儿页（空间 ≥ 3 篇 wiki 笔记且入链 + 出链均为 0）
 * 3. stale — 超过 stale_after 期限的活跃页
 * 4. unverified_draft — 超过 14 天未核验的 AI 草稿
 * 5. missing_description — 缺少 description 摘要
 * 6. oversized — 超过 300 行的超长页（建议按概念拆分）
 * 7. revision_marker — 追加式更新标记（"## Update (date)"、变更记录、更新记录）
 * 8. duplicate_title — 同空间内多篇活跃页标题相同（同一事实被写了两份）
 * 9. status_oversized / status_stale / status_duplicate — 状态页超出单屏预算、长期未更新、一个空间多篇
 */

const REVISION_HEADINGS = new Set([
  'update',
  'updates',
  'updated',
  'update log',
  'changelog',
  'change log',
  'changes',
  'revision',
  'revisions',
  'amendments',
  'superseded',
  'history',
  'what changed',
  '更新',
  '更新记录',
  '变更',
  '变更记录',
  '修订',
  '修订记录',
  '历史',
  '旧版',
  '已废弃',
  '补充记录',
]);

const HEADING_DATE_RE = /^(update[sd]?|changelog|revision[s]?)\s*[（(]\s*\d{4}/;
const HEADING_DATE_ZH_RE = /^(更新|变更|修订|补充)\s*[（(]\s*\d{4}/;
const INLINE_DATE_EN_RE = /(^|[\s>*_])update[sd]?\s*[（(]\s*\d{4}-\d{2}-\d{2}/i;
const INLINE_DATE_ZH_RE = /(^|[\s>*_])(更新|变更|修订)\s*[（(]\s*\d{4}-\d{1,2}/;

function isRevisionHeading(text: string): boolean {
  const normalized = text
    .trim()
    .toLowerCase()
    .replace(/[：:。.、*_`]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (REVISION_HEADINGS.has(normalized)) return true;
  return HEADING_DATE_RE.test(normalized) || HEADING_DATE_ZH_RE.test(normalized);
}

/**
 * 找出“追加式更新”痕迹。知识页应描述当前状态，被取代的陈述必须改写删除，
 * 留下 Update (日期) / 变更记录一类标记，后到的读者就无法判断哪句还是真的。
 */
export function findRevisionMarkers(body: string): string[] {
  const hits: string[] = [];
  let inFence = false;
  let fenceChar = '';
  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    const fence = trimmed.match(/^(`{3,}|~{3,})/);
    if (fence) {
      if (!inFence) {
        inFence = true;
        fenceChar = fence[1][0];
      } else if (trimmed[0] === fenceChar) {
        inFence = false;
      }
      continue;
    }
    if (inFence) continue;

    const heading = line.match(/^#{1,6}\s+(.+?)\s*#*\s*$/);
    if (heading) {
      if (isRevisionHeading(heading[1])) hits.push(trimmed.slice(0, 80));
      continue;
    }
    if (INLINE_DATE_EN_RE.test(trimmed) || INLINE_DATE_ZH_RE.test(trimmed)) {
      hits.push(trimmed.slice(0, 80));
    }
  }
  return hits;
}

export function runVaultLint(db: Database.Database, opts: VaultLintOptions = {}): MemoryLintReport {
  const now = opts.now ?? new Date();
  const todayIso = now.toISOString().slice(0, 10);
  const draftCutoffMs = now.getTime() - LINT_STALE_DRAFT_DAYS * 24 * 60 * 60 * 1000;
  const labelOf = opts.spaceLabel ?? ((s: string) => s);

  const conds = ['is_archived = 0', 'is_raw = 0'];
  const params: unknown[] = [];
  if (opts.spaceIds && opts.spaceIds.length > 0) {
    conds.push(`space_id IN (${opts.spaceIds.map(() => '?').join(',')})`);
    params.push(...opts.spaceIds);
  }
  const where = `WHERE ${conds.join(' AND ')}`;

  const notes = db
    .prepare(
      `SELECT space_id, rel_path, slug, title, description, type, status, generated_at, stale_after, line_count, body_text, updated_at,
              (SELECT count(*) FROM links l WHERE l.space_id = notes.space_id AND l.source_path = notes.rel_path AND l.target_path IS NOT NULL) AS out_resolved,
              (SELECT count(*) FROM links l WHERE l.space_id = notes.space_id AND l.target_path = notes.rel_path) AS in_resolved
       FROM notes ${where}
       ORDER BY space_id, slug`
    )
    .all(...params) as {
    space_id: string;
    rel_path: string;
    slug: string;
    title: string;
    description: string;
    type: string;
    status: string;
    generated_at: string | null;
    stale_after: string | null;
    line_count: number;
    body_text: string;
    updated_at: string;
    out_resolved: number;
    in_resolved: number;
  }[];

  const spaceNoteCount = new Map<string, number>();
  const statusSlugs = new Map<string, string[]>();
  for (const n of notes) {
    spaceNoteCount.set(n.space_id, (spaceNoteCount.get(n.space_id) ?? 0) + 1);
    if (n.type === STATUS_NOTE_TYPE) {
      const bucket = statusSlugs.get(n.space_id) ?? [];
      bucket.push(n.slug);
      statusSlugs.set(n.space_id, bucket);
    }
  }

  // 同一空间内标题相同的活跃页：同一事实被写成了两份
  const byTitle = new Map<string, { noteId: string; slug: string }[]>();
  for (const note of notes) {
    const key = `${note.space_id}\u0000${note.title.trim().normalize('NFC').toLowerCase().replace(/\s+/g, ' ')}`;
    if (!note.title.trim()) continue;
    const bucket = byTitle.get(key) ?? [];
    bucket.push({ noteId: makeNoteId(note.space_id, note.rel_path), slug: note.slug });
    byTitle.set(key, bucket);
  }
  const duplicateOf = new Map<string, string[]>();
  for (const bucket of byTitle.values()) {
    if (bucket.length < 2) continue;
    for (const item of bucket) {
      duplicateOf.set(
        item.noteId,
        bucket.filter((other) => other.noteId !== item.noteId).map((other) => other.slug)
      );
    }
  }

  const issues: MemoryLintIssue[] = [];

  // 1. Broken links
  const brokenStmt = db.prepare(
    'SELECT target_raw FROM links WHERE space_id = ? AND source_path = ? AND is_broken = 1'
  );

  for (const note of notes) {
    const noteId = makeNoteId(note.space_id, note.rel_path);
    const spaceLabel = labelOf(note.space_id);

    const broken = brokenStmt.all(note.space_id, note.rel_path) as { target_raw: string }[];
    for (const b of broken) {
      issues.push({
        kind: 'broken_link',
        spaceId: note.space_id,
        spaceLabel,
        noteId,
        slug: note.slug,
        title: note.title,
        detail: `Unresolved wikilink [[${b.target_raw}]]`,
      });
    }

    // 2. Orphans (only when space has at least 3 active wiki notes)
    // 状态页是入口文档，只被读取、不需要入链
    if (
      note.type !== STATUS_NOTE_TYPE &&
      (spaceNoteCount.get(note.space_id) ?? 0) >= 3 &&
      note.out_resolved === 0 &&
      note.in_resolved === 0
    ) {
      issues.push({
        kind: 'orphan',
        spaceId: note.space_id,
        spaceLabel,
        noteId,
        slug: note.slug,
        title: note.title,
        detail: 'No incoming or outgoing wikilinks',
      });
    }

    // 3. Stale
    if (note.stale_after && note.stale_after < todayIso) {
      issues.push({
        kind: 'stale',
        spaceId: note.space_id,
        spaceLabel,
        noteId,
        slug: note.slug,
        title: note.title,
        detail: `Stale since ${note.stale_after}`,
      });
    }

    // 4. Unverified old draft
    if (note.status === 'draft') {
      const ts = Date.parse(note.generated_at ?? note.updated_at);
      if (Number.isFinite(ts) && ts < draftCutoffMs) {
        issues.push({
          kind: 'unverified_draft',
          spaceId: note.space_id,
          spaceLabel,
          noteId,
          slug: note.slug,
          title: note.title,
          detail: `Draft unverified for over ${LINT_STALE_DRAFT_DAYS} days`,
        });
      }
    }

    // 5. Missing description
    if (!note.description.trim()) {
      issues.push({
        kind: 'missing_description',
        spaceId: note.space_id,
        spaceLabel,
        noteId,
        slug: note.slug,
        title: note.title,
        detail: 'Missing one-line description in frontmatter',
      });
    }

    // 6. Oversized
    if (note.line_count > LINT_OVERSIZED_LINES) {
      issues.push({
        kind: 'oversized',
        spaceId: note.space_id,
        spaceLabel,
        noteId,
        slug: note.slug,
        title: note.title,
        detail: `${note.line_count} lines (recommended <= ${LINT_OVERSIZED_LINES})`,
      });
    }

    // 7. Append-style revision markers
    const markers = findRevisionMarkers(note.body_text);
    if (markers.length > 0) {
      issues.push({
        kind: 'revision_marker',
        spaceId: note.space_id,
        spaceLabel,
        noteId,
        slug: note.slug,
        title: note.title,
        detail: `Rewrite the page in place instead of keeping: ${markers.join(' | ')}`,
      });
    }

    // 8. Duplicate title
    const others = duplicateOf.get(noteId);
    if (others && others.length > 0) {
      issues.push({
        kind: 'duplicate_title',
        spaceId: note.space_id,
        spaceLabel,
        noteId,
        slug: note.slug,
        title: note.title,
        detail: `Same title as ${others.join(', ')}`,
      });
    }

    // 9. Status page: one screen, kept fresh, one per space
    if (note.type === STATUS_NOTE_TYPE) {
      const nonEmptyLines = note.body_text.split('\n').filter((line) => line.trim()).length;
      if (nonEmptyLines > LINT_STATUS_MAX_LINES) {
        issues.push({
          kind: 'status_oversized',
          spaceId: note.space_id,
          spaceLabel,
          noteId,
          slug: note.slug,
          title: note.title,
          detail: `${nonEmptyLines} lines (status page budget: ${LINT_STATUS_MAX_LINES})`,
        });
      }

      const updatedMs = Date.parse(note.updated_at);
      if (
        Number.isFinite(updatedMs) &&
        now.getTime() - updatedMs > LINT_STATUS_STALE_DAYS * 24 * 60 * 60 * 1000
      ) {
        issues.push({
          kind: 'status_stale',
          spaceId: note.space_id,
          spaceLabel,
          noteId,
          slug: note.slug,
          title: note.title,
          detail: `Status not updated for over ${LINT_STATUS_STALE_DAYS} days`,
        });
      }

      const otherStatus = (statusSlugs.get(note.space_id) ?? []).filter((s) => s !== note.slug);
      if (otherStatus.length > 0) {
        issues.push({
          kind: 'status_duplicate',
          spaceId: note.space_id,
          spaceLabel,
          noteId,
          slug: note.slug,
          title: note.title,
          detail: `One status page per space; also found ${otherStatus.join(', ')}`,
        });
      }
    }
  }

  return {
    issues,
    checkedNotes: notes.length,
    checkedAt: now.toISOString(),
  };
}
