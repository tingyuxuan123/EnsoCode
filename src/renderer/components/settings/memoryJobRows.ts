import type { MemoryJobsSnapshot } from '@shared/memory/dto';

/**
 * 把三类后台任务压平成统一的展示行。抽成纯函数便于断言
 * 「产出/丢弃原因/失败」都被如实呈现，而不是只报一个数字。
 */

export type JobKind = 'distill' | 'kg' | 'reembed';
export type JobState = 'running' | 'done' | 'failed' | 'cancelled';

export interface JobRow {
  key: string;
  kind: JobKind;
  /** 人类可读的对象：会话标题 / 记忆标题 / 模型名 */
  target: string;
  state: JobState;
  /** 一句话结果：写入几条、抽了几个实体、失败原因 */
  detail: string;
  /** 结构化丢弃原因（仅蒸馏），逐条说明为什么没写入 */
  notes: string[];
  updatedAt: string;
}

const shortId = (id: string) => id.slice(0, 8);

function stateOf(status: string, error: string | null, failed = 0): JobState {
  if (status === 'pending' || status === 'running') return 'running';
  if (status === 'cancelled') return 'cancelled';
  return error || failed > 0 ? 'failed' : 'done';
}

const NOTE_LABELS: Record<string, string> = {
  low_importance: 'importance too low',
  candidates_found: 'similar memory already exists',
  deduplicated: 'identical to an existing memory',
  rejected: 'rejected',
};

export function toJobRows(snapshot: MemoryJobsSnapshot): JobRow[] {
  const rows: JobRow[] = [];

  for (const job of snapshot.distill) {
    const state = stateOf(job.status, job.error);
    rows.push({
      key: `distill:${job.id}`,
      kind: 'distill',
      target: job.sessionTitle || shortId(job.sessionId),
      state,
      detail:
        state === 'failed'
          ? (job.error ?? '')
          : state === 'cancelled'
            ? 'superseded'
            : state === 'running'
              ? job.attempts > 1
                ? `retry ${job.attempts}`
                : 'queued'
              : `${job.done} stored`,
      notes: (job.notes ?? []).map((note) =>
        [note.title, NOTE_LABELS[note.kind] ?? note.kind].filter(Boolean).join(' — ')
      ),
      updatedAt: job.updatedAt,
    });
  }

  for (const job of snapshot.kg) {
    const state = stateOf(job.status, job.error, job.failed);
    rows.push({
      key: `kg:${job.id}`,
      kind: 'kg',
      target: job.memoryTitle || shortId(job.memoryId),
      state,
      detail:
        state === 'failed'
          ? (job.error ?? '')
          : state === 'cancelled'
            ? 'memory changed'
            : state === 'running'
              ? 'extracting'
              : // kg 任务复用 total/done 两列存实体数与关系数
                `${job.total} entities · ${job.done} links`,
      notes: [],
      updatedAt: job.updatedAt,
    });
  }

  const reembed = snapshot.reembed;
  if (reembed) {
    const state = stateOf(reembed.status, reembed.error);
    rows.push({
      key: `reembed:${reembed.id}`,
      kind: 'reembed',
      target: reembed.target,
      state,
      detail:
        state === 'failed'
          ? (reembed.error ?? '')
          : state === 'running'
            ? `${reembed.done}/${reembed.total}`
            : `${reembed.done} vectorized${reembed.failed > 0 ? ` · ${reembed.failed} failed` : ''}`,
      notes: [],
      updatedAt: reembed.updatedAt,
    });
  }

  // 进行中的排最前，其余按时间倒序
  const rank = (row: JobRow) => (row.state === 'running' ? 0 : row.state === 'failed' ? 1 : 2);
  return rows.sort((a, b) => rank(a) - rank(b) || b.updatedAt.localeCompare(a.updatedAt));
}
