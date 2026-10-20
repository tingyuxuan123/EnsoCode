import { describe, expect, it } from 'vitest';
import type { TimelineItem } from '@/stores/sessions/timeline';
import { nextTimelineReveal, revealGroupKeys, TIMELINE_REVEAL_CAP_MS } from './timelineReveal';

describe('nextTimelineReveal', () => {
  it('第一次隐藏按上限计时', () => {
    expect(nextTimelineReveal(1_000, null, true, false)).toEqual({
      hiddenSince: 1_000,
      delayMs: TIMELINE_REVEAL_CAP_MS,
    });
  });

  it('visibility 来回切换不重置起点', () => {
    const started = nextTimelineReveal(1_000, null, true, false);
    const visible = nextTimelineReveal(1_000 + 40, started.hiddenSince, false, false);
    expect(visible).toEqual({ hiddenSince: 1_000, delayMs: null });
    expect(nextTimelineReveal(1_000 + 40, visible.hiddenSince, true, false)).toEqual({
      hiddenSince: 1_000,
      delayMs: TIMELINE_REVEAL_CAP_MS - 40,
    });
  });

  it('超过上限后再被藏起来也立刻显示', () => {
    expect(nextTimelineReveal(2_500, 1_000, true, false)).toEqual({
      hiddenSince: 1_000,
      delayMs: 0,
    });
  });

  it('已经放开或当前可见时不再计时', () => {
    expect(nextTimelineReveal(1_500, 1_000, true, true)).toEqual({
      hiddenSince: 1_000,
      delayMs: null,
    });
    expect(nextTimelineReveal(1_500, null, false, false)).toEqual({
      hiddenSince: null,
      delayMs: null,
    });
  });
});

const text = (key: string): TimelineItem => ({ kind: 'text', key, text: key, streaming: false });
const group = (key: string, children: TimelineItem[], expanded = false): TimelineItem => ({
  kind: 'tool-group',
  key,
  expanded,
  count: 1,
  stats: { commands: 0, reads: 1, searches: 0, others: 0 },
  exploring: false,
  children,
});

describe('revealGroupKeys', () => {
  it('命中在折叠组里时返回由外到内的祖先组 key', () => {
    const items = [text('a'), group('worklog-1', [group('group-x', [text('hit')])])];
    expect(revealGroupKeys(items, 'hit')).toEqual(['worklog-1', 'group-x']);
  });

  it('已经展开的组不重复返回', () => {
    const items = [group('worklog-1', [group('group-x', [text('hit')], true)])];
    expect(revealGroupKeys(items, 'hit')).toEqual(['worklog-1']);
  });

  it('顶层命中或查不到时返回空', () => {
    const items = [text('a'), group('worklog-1', [text('b')])];
    expect(revealGroupKeys(items, 'a')).toEqual([]);
    expect(revealGroupKeys(items, 'missing')).toEqual([]);
  });
});
