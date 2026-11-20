import type { CompileJobDto, MemoryJobsSnapshot } from '@shared/memory/dto';
import { describe, expect, it } from 'vitest';
import { toJobRows } from './memoryJobRows';

function compileJob(over: Partial<CompileJobDto> = {}): CompileJobDto {
  return {
    id: 1,
    sessionId: 'abcdef123456',
    sessionTitle: null,
    projectId: null,
    status: 'done',
    attempts: 1,
    written: 2,
    error: null,
    notes: [],
    createdAt: '2026-11-20T00:00:00.000Z',
    updatedAt: '2026-11-20T00:00:00.000Z',
    ...over,
  };
}

const snapshot = (compile: CompileJobDto[] = []): MemoryJobsSnapshot => ({ compile });

describe('toJobRows', () => {
  it('shows session title or short id fallback and compiled note count', () => {
    const rows = toJobRows(
      snapshot([
        compileJob({ id: 1, sessionTitle: 'Fix retry loop', written: 2 }),
        compileJob({ id: 2, sessionTitle: null, written: 0 }),
      ])
    );
    expect(rows[0].target).toBe('Fix retry loop');
    expect(rows[0].detail).toBe('2 updated');
    expect(rows[1].target).toBe('abcdef12');
    expect(rows[1].detail).toBe('0 updated');
  });

  it('surfaces per-note actions and failures cleanly', () => {
    const rows = toJobRows(
      snapshot([
        compileJob({
          id: 1,
          notes: [
            {
              kind: 'created',
              slug: 'systems/ipc',
              title: 'IPC 规范',
              detail: 'proj:1/systems/ipc',
            },
            { kind: 'rejected', slug: 'bad', title: 'Bad', detail: 'unsafe_content' },
          ],
        }),
      ])
    );
    expect(rows[0].notes).toEqual([
      'IPC 规范 — created — proj:1/systems/ipc',
      'Bad — rejected — unsafe_content',
    ]);
  });

  it('separates failure, cancellation, and retry states and orders running → failed → done', () => {
    const rows = toJobRows(
      snapshot([
        compileJob({ id: 1, status: 'done', updatedAt: '2026-11-18T00:00:00.000Z' }),
        compileJob({ id: 2, status: 'done', error: 'provider down' }),
        compileJob({ id: 3, status: 'pending', attempts: 3 }),
        compileJob({ id: 4, status: 'cancelled', error: 'ignored' }),
        compileJob({ id: 5, status: 'done', updatedAt: '2026-11-20T00:00:00.000Z' }),
      ])
    );
    expect(rows.map((r) => r.key)).toEqual([
      'compile:3',
      'compile:2',
      'compile:5',
      'compile:1',
      'compile:4',
    ]);
    expect(rows[0].detail).toBe('retry 3');
    expect(rows[1].state).toBe('failed');
    expect(rows[1].detail).toBe('provider down');
    expect(rows[4].state).toBe('cancelled');
    expect(rows[4].detail).toBe('superseded');
  });

  it('is empty when nothing ran', () => {
    expect(toJobRows(snapshot())).toEqual([]);
  });
});
