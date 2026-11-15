import type { CatalogEntry } from '@enso/pair';
import { describe, expect, it } from 'vitest';
import {
  countWaiting,
  cycleStatusFilter,
  filterSessionsByStatus,
  STATUS_FILTER_LABEL,
} from './drawerStatusFilter';

const session = (over: Partial<CatalogEntry>): CatalogEntry => ({
  id: 's',
  title: '会话',
  projectName: 'p',
  projectId: 'p',
  status: 'idle',
  ...over,
});

describe('cycleStatusFilter', () => {
  it('walks all → waiting → running → error → all', () => {
    expect(cycleStatusFilter('all')).toBe('waiting');
    expect(cycleStatusFilter('waiting')).toBe('running');
    expect(cycleStatusFilter('running')).toBe('error');
    expect(cycleStatusFilter('error')).toBe('all');
  });
});

describe('countWaiting', () => {
  it('counts sessions that need the user, ignoring archived ones', () => {
    const catalog = [
      session({ id: 'a', pendingAskCount: 1 }),
      session({ id: 'b', pendingApprovalCount: 2 }),
      session({ id: 'c', status: 'running' }),
      session({ id: 'd', pendingAskCount: 1, archived: true }),
    ];
    expect(countWaiting(catalog)).toBe(2);
  });
});

describe('filterSessionsByStatus', () => {
  const catalog = [
    session({ id: 'wait', pendingAskCount: 1 }),
    session({ id: 'run', status: 'running' }),
    session({ id: 'fail', status: 'failed' }),
    session({ id: 'idle', status: 'idle' }),
  ];

  it('keeps everything in the all view', () => {
    expect(filterSessionsByStatus(catalog, 'all').map((s) => s.id)).toEqual([
      'wait',
      'run',
      'fail',
      'idle',
    ]);
  });

  it('keeps only the matching tone', () => {
    expect(filterSessionsByStatus(catalog, 'waiting').map((s) => s.id)).toEqual(['wait']);
    expect(filterSessionsByStatus(catalog, 'running').map((s) => s.id)).toEqual(['run']);
    expect(filterSessionsByStatus(catalog, 'error').map((s) => s.id)).toEqual(['fail']);
  });

  it('labels the active filter for the trigger button', () => {
    expect(STATUS_FILTER_LABEL.all).toBe('全部会话');
    expect(STATUS_FILTER_LABEL.error).toBe('只看出错');
  });
});
