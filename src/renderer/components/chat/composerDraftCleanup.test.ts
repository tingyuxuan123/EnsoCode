import { describe, expect, it, vi } from 'vitest';
import { bindComposerDraftCleanup } from './composerDraftCleanup';

describe('draft deletion follows metadata deletion, not history eviction', () => {
  it('cleans parent and child deletions only, and unsubscribes', () => {
    let listener!: (
      state: { conversations: Record<string, object> },
      previous: { conversations: Record<string, object> }
    ) => void;
    const unsubscribe = vi.fn();
    const remove = vi.fn();
    const stop = bindComposerDraftCleanup((fn) => {
      listener = fn;
      return unsubscribe;
    }, remove);
    const before = { conversations: { a: { messages: ['old'] }, child: {}, b: {} } };
    listener({ conversations: { a: { messages: [] }, child: {}, b: {} } }, before);
    expect(remove).not.toHaveBeenCalled();
    listener({ conversations: { b: {} } }, before);
    expect(remove.mock.calls).toEqual([['a'], ['child']]);
    stop();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
