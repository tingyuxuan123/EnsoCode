import { describe, expect, it } from 'vitest';
import { NOTE_DIFF_MAX_LINES, noteDiff } from './noteDiff';

describe('noteDiff', () => {
  it('keeps only the changed block with one line of context', () => {
    const diff = noteDiff('a\nold\nb\nc', 'a\nnew\nb\nc');
    expect(diff).toEqual({
      patch: ' a\n-old\n+new\n b',
      added: 1,
      removed: 1,
      truncated: false,
    });
  });

  it('reports creation/removal blocks and skips identical bodies', () => {
    expect(noteDiff('', 'x\ny')).toMatchObject({ added: 2, removed: 0 });
    expect(noteDiff('x', 'x')).toBeNull();
  });

  it('caps long rewrites so the receipt stays small', () => {
    const before = Array.from({ length: 200 }, (_, i) => `old ${i}`).join('\n');
    const after = Array.from({ length: 200 }, (_, i) => `new ${i}`).join('\n');
    const diff = noteDiff(before, after)!;
    expect(diff.patch.split('\n').length).toBeLessThanOrEqual(NOTE_DIFF_MAX_LINES);
    expect(diff.truncated).toBe(true);
  });
});
