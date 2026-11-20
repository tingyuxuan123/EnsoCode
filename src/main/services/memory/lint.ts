import { LINT_OVERSIZED_LINES, LINT_STALE_DRAFT_DAYS } from '@shared/memory/constants';
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
 */
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
      `SELECT space_id, rel_path, slug, title, description, status, generated_at, stale_after, line_count, updated_at,
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
    status: string;
    generated_at: string | null;
    stale_after: string | null;
    line_count: number;
    updated_at: string;
    out_resolved: number;
    in_resolved: number;
  }[];

  const spaceNoteCount = new Map<string, number>();
  for (const n of notes) {
    spaceNoteCount.set(n.space_id, (spaceNoteCount.get(n.space_id) ?? 0) + 1);
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
    if (
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
  }

  return {
    issues,
    checkedNotes: notes.length,
    checkedAt: now.toISOString(),
  };
}
