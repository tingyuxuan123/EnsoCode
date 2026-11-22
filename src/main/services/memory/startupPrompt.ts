export const MEMORY_STARTUP_MAX_STATUS_CHARS = 4000;

export interface MemoryStartupStatus {
  slug: string;
  title: string;
  body: string;
  updatedAt: string;
}

export interface MemoryStartupInput {
  noteCount: number;
  status: MemoryStartupStatus | null;
  /** 空间里最新一篇活跃笔记的更新时间，用来和代码新鲜度对比 */
  memoryUpdatedAt?: string | null;
  /** 仓库最新一次提交时间；未知或非 git 项目传 null */
  codeUpdatedAt?: string | null;
}

function dayOf(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString().slice(0, 10);
}

/**
 * 会话启动时追加到系统提示词的一小段记忆上下文。
 * 目标是让“先查记忆”成为默认动作，而不是靠模型自己想起来还有这套工具。
 * 这里刻意只放便宜信息：条数、工具用法、状态页正文；正式内容仍然要 memory_read。
 */
export function buildMemoryStartupBlock(input: MemoryStartupInput): string | null {
  const noteCount = Math.max(0, Math.trunc(input.noteCount));
  const statusBody = input.status?.body.trim() ?? '';
  const statusSlug = input.status?.slug?.trim() || 'status';

  const lines = ['## Project memory (Markdown wiki)'];
  lines.push(
    noteCount > 0
      ? `${noteCount} durable note${noteCount === 1 ? '' : 's'} live in this workspace's memory vault (Markdown, [[wikilink]]-connected).`
      : 'This workspace keeps a Markdown memory vault. It currently has no notes yet.'
  );
  lines.push('');
  lines.push(
    'If the user explicitly asks you to remember a lasting convention, decision, or preference, use memory_search or memory_index in the intended vault, then use memory_upsert in the same turn. Read and update a matching page instead of duplicating it. ' +
      'Report the actual result and page; never say it was saved if approval is pending or the write failed. Do not save routine Q&A.',
    'Before non-trivial work, and whenever the user refers to an earlier decision, incident, convention or plan, call memory_index for the catalog and memory_search for the topic; read a note with memory_read before relying on it.'
  );
  if (noteCount === 0) {
    lines.push(
      'When the user confirms a decision, or an investigation reaches its root cause, record it with memory_upsert — one topic per page, and rewrite the page in place instead of appending.'
    );
  }
  lines.push(
    'A note is only as current as its last update. When code and a note disagree, the code wins — and a note that no longer holds should be rewritten, not appended to.'
  );

  const memoryDay = dayOf(input.memoryUpdatedAt);
  const codeDay = dayOf(input.codeUpdatedAt);
  if (memoryDay && codeDay && codeDay > memoryDay) {
    lines.push(
      `The repository has commits newer than this memory (code ${codeDay}, memory ${memoryDay}). Verify a note against the code before relying on it, and rewrite the note when it no longer holds.`
    );
  }

  lines.push(
    'When this session changes what is in progress, the next step, or a blocker, overwrite the status page with memory_upsert (type=status, mode=replace, at most 60 lines, first line "As of <YYYY-MM-DD>").'
  );

  if (statusBody) {
    const asOf = input.status?.updatedAt?.slice(0, 10) ?? '';
    lines.push('');
    lines.push(`### Current status ([[${statusSlug}]]${asOf ? `, updated ${asOf}` : ''})`);
    lines.push('');
    lines.push(
      statusBody.length > MEMORY_STARTUP_MAX_STATUS_CHARS
        ? `${statusBody.slice(0, MEMORY_STARTUP_MAX_STATUS_CHARS).trimEnd()}\n… (status truncated; open [[${statusSlug}]] with memory_read for the rest)`
        : statusBody
    );
  }

  return lines.join('\n');
}
