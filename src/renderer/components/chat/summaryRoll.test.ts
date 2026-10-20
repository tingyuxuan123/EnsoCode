import { describe, expect, it } from 'vitest';
import {
  enqueueSummary,
  resolveSummaryPlaybackQueue,
  type SummarySnapshot,
  shouldRefreshSummaryInPlace,
} from './summaryRoll';

const snap = (
  key: string,
  trailing?: string,
  refreshVersion?: string
): SummarySnapshot<string> => ({
  key,
  primary: key,
  trailing,
  refreshVersion,
});

describe('摘要滚动队列', () => {
  it('计时正常时按顺序播放', () => {
    expect(resolveSummaryPlaybackQueue(['a', 'b'], 10)).toEqual(['a', 'b']);
  });

  it('主线程卡顿导致计时晚到时只播最新一条', () => {
    expect(resolveSummaryPlaybackQueue(['a', 'b'], 400)).toEqual(['b']);
    expect(resolveSummaryPlaybackQueue(['a'], 400)).toEqual(['a']);
  });

  it('队列最多两格：第一条保留，新摘要替换第二格', () => {
    let queue = enqueueSummary<string>([], snap('a'));
    queue = enqueueSummary(queue, snap('b'));
    queue = enqueueSummary(queue, snap('c'));
    expect(queue.map((item) => item.key)).toEqual(['a', 'c']);
  });

  it('同 key 原位替换，不新增滚动项', () => {
    let queue = enqueueSummary<string>([], snap('a', '+1'));
    queue = enqueueSummary(queue, snap('a', '+5'));
    expect(queue).toEqual([snap('a', '+5')]);
  });

  it('同 key 只在尾部或版本变化时原位刷新', () => {
    expect(shouldRefreshSummaryInPlace(snap('a', '+1'), snap('a', '+2'))).toBe(true);
    expect(shouldRefreshSummaryInPlace(snap('a', undefined, '1'), snap('a', undefined, '2'))).toBe(
      true
    );
    expect(shouldRefreshSummaryInPlace(snap('a', '+1'), snap('a', '+1'))).toBe(false);
    expect(shouldRefreshSummaryInPlace(snap('a'), snap('b'))).toBe(false);
  });
});
