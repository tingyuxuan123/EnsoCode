import type { CompileJobDto, MemoryJobsSnapshot } from '@shared/memory/dto';

export type JobKind = 'compile';
export type JobState = 'running' | 'done' | 'failed' | 'cancelled';

export interface JobRow {
  key: string;
  kind: JobKind;
  target: string;
  state: JobState;
  detail: string;
  notes: string[];
  updatedAt: string;
}

const shortId = (id: string) => id.slice(0, 8);

function stateOf(status: CompileJobDto['status'], error: string | null): JobState {
  if (status === 'pending' || status === 'running') return 'running';
  if (status === 'cancelled') return 'cancelled';
  return error ? 'failed' : 'done';
}

const NOTE_LABELS: Record<CompileJobDto['notes'][number]['kind'], string> = {
  created: 'created',
  updated: 'updated',
  pending_review: 'queued for review',
  skipped: 'skipped',
  rejected: 'rejected',
};

export function toJobRows(snapshot: MemoryJobsSnapshot): JobRow[] {
  const rows: JobRow[] = [];

  for (const job of snapshot.compile) {
    const state = stateOf(job.status, job.error);
    const pendingCount = (job.notes ?? []).filter((n) => n.kind === 'pending_review').length;
    rows.push({
      key: `compile:${job.id}`,
      kind: 'compile',
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
              : pendingCount > 0
                ? `${pendingCount} suggested`
                : `${job.written} updated`,
      notes: (job.notes ?? []).map((note) =>
        [note.title || note.slug, NOTE_LABELS[note.kind] ?? note.kind, note.detail]
          .filter(Boolean)
          .join(' — ')
      ),
      updatedAt: job.updatedAt,
    });
  }

  const rank = (row: JobRow) =>
    row.state === 'running' ? 0 : row.state === 'failed' ? 1 : row.state === 'done' ? 2 : 3;
  return rows.sort((a, b) => rank(a) - rank(b) || b.updatedAt.localeCompare(a.updatedAt));
}
