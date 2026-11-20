import { describe, expect, it } from 'vitest';
import type { TimelineItem } from '@/stores/sessions/timeline';
import {
  findSuppressedEnterKeys,
  isUserScrollUp,
  nextSmoothScrollTop,
  SMOOTH_FOLLOW_MAX_GLIDE_PX,
} from './smoothScrollFollow';

const tool = (key: string): Extract<TimelineItem, { kind: 'tool' }> => ({
  kind: 'tool',
  key,
  name: 'grep',
  summary: 'foo',
  output: null,
  state: 'ok',
  edits: null,
  writeContent: null,
  todos: null,
  durationMs: 100,
  agentMeta: null,
});

describe('nextSmoothScrollTop', () => {
  it('glides monotonically toward target without overshooting and settles cleanly', () => {
    let pos = 100;
    const target = 220;
    let steps = 0;
    let done = false;
    while (!done && steps < 100) {
      const result = nextSmoothScrollTop(pos, target, 16);
      expect(result.next).toBeGreaterThanOrEqual(pos);
      expect(result.next).toBeLessThanOrEqual(target);
      pos = result.next;
      done = result.done;
      steps += 1;
    }
    expect(done).toBe(true);
    expect(pos).toBe(target);
    expect(steps).toBeGreaterThan(3);
    expect(steps).toBeLessThan(35);
  });

  it('produces identical physical travel at 120Hz (2x8ms) and 60Hz (1x16ms)', () => {
    const step60 = nextSmoothScrollTop(0, 200, 16);
    const half1 = nextSmoothScrollTop(0, 200, 8);
    const half2 = nextSmoothScrollTop(half1.next, 200, 8);
    expect(half2.next).toBeCloseTo(step60.next, 6);
  });

  it('pre-advances oversized gaps so huge dumps never lag far behind while keeping a smooth landing', () => {
    const target = SMOOTH_FOLLOW_MAX_GLIDE_PX + 600;
    const step = nextSmoothScrollTop(0, target, 16);
    expect(step.done).toBe(false);
    expect(target - step.next).toBeLessThan(260);
    expect(target - step.next).toBeGreaterThan(100);
  });

  it('snaps immediately under reduced motion or when already at/past target', () => {
    expect(nextSmoothScrollTop(100, 260, 16, true)).toEqual({ next: 260, done: true });
    expect(nextSmoothScrollTop(260, 260, 16)).toEqual({ next: 260, done: true });
    expect(nextSmoothScrollTop(260, 250, 16)).toEqual({ next: 260, done: true });
  });
});

describe('isUserScrollUp', () => {
  it('flags upward movement exceeding tolerance and ignores downward or stationary scroll', () => {
    expect(isUserScrollUp(400, 390)).toBe(true);
    expect(isUserScrollUp(400, 399)).toBe(false);
    expect(isUserScrollUp(400, 400)).toBe(false);
    expect(isUserScrollUp(400, 440)).toBe(false);
  });
});

describe('findSuppressedEnterKeys', () => {
  it('suppresses in-place compact tool-group upgrades and worklog wrappers for already-seen items', () => {
    const seen = new Set(['u-1', 't-1']);
    const folded: TimelineItem[] = [
      { kind: 'user', key: 'u-1', text: 'hi', images: [] },
      {
        kind: 'tool-group',
        key: 'worklog-u-1',
        expanded: true,
        count: 2,
        stats: { reads: 0, searches: 2, commands: 0, others: 0 },
        exploring: false,
        worklog: { status: 'running', forced: true, thinking: 0, failed: 0 },
        children: [],
      },
      {
        kind: 'tool-group',
        key: 'group-t-1',
        expanded: false,
        count: 2,
        stats: { reads: 0, searches: 2, commands: 0, others: 0 },
        exploring: false,
        children: [tool('t-1'), tool('t-2')],
      },
      tool('t-3'),
      {
        kind: 'tool-group',
        key: 'group-t-4',
        expanded: false,
        count: 2,
        stats: { reads: 0, searches: 2, commands: 0, others: 0 },
        exploring: false,
        children: [tool('t-4'), tool('t-5')],
      },
    ];

    const suppressed = findSuppressedEnterKeys(folded, seen);
    expect(suppressed.has('worklog-u-1')).toBe(true);
    expect(suppressed.has('group-t-1')).toBe(true);
    // Genuinely new rows and groups with unseen children still glide in.
    expect(suppressed.has('t-3')).toBe(false);
    expect(suppressed.has('group-t-4')).toBe(false);
  });
});
