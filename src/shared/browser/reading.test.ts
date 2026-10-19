import { describe, expect, it } from 'vitest';
import { parseReadRequest, readPageSlice } from './reading';

describe('有界页面读取', () => {
  it('拒绝坏 scope、预算与跨快照游标', () => {
    for (const raw of [{ scope: 'all' }, { maxChars: Infinity }, { limit: -1 }, { cursor: 3 }]) {
      expect(() => parseReadRequest(raw)).toThrow();
    }
    expect(() => readPageSlice({ snapshotId: 's1', text: 'abcd', entries: [], diagnostics: [], truncated: false }, { cursor: 's2:0' }, 'text')).toThrow(/cursor/);
  });

  it('文字严格按字符预算分页，同一快照继续且不重复正文', () => {
    const snapshot = { snapshotId: 's1', text: 'abcdef', entries: [], diagnostics: [], truncated: false };
    const first = readPageSlice(snapshot, { maxChars: 3 }, 'text');
    expect(first).toMatchObject({ text: 'abc', nextCursor: 's1:3' });
    expect(readPageSlice(snapshot, { maxChars: 3, cursor: first.nextCursor }, 'text')).toMatchObject({ text: 'def', nextCursor: undefined });
  });

  it('元素筛选先于分页，不泄露未筛选项', () => {
    const snapshot = { snapshotId: 's1', text: '', entries: [{ ref: 'e1_1', role: 'button', name: 'Save', depth: 0 }, { ref: 'e1_2', role: 'link', name: 'Save docs', depth: 0 }], diagnostics: ['Cross-origin frame skipped'], truncated: false };
    expect(readPageSlice(snapshot, { role: 'button', text: 'sav', limit: 1 }, 'elements')).toMatchObject({ entries: [{ role: 'button', name: 'Save' }], total: 1, diagnostics: ['Cross-origin frame skipped'] });
  });
});
