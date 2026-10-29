import { describe, expect, it } from 'vitest';
import { cachedPartializeSessions } from './persistSnapshot';

const conv = (id: string, extra: { title?: string; text?: string } = {}) => ({
  id,
  projectId: 'p',
  title: extra.title ?? id,
  started: true,
  spawning: false,
  createdAt: 1,
  sessionFile: '/tmp/a.jsonl',
  historyLoading: true,
  status: 'running' as const,
  messages: [
    { timestamp: 10, role: 'assistant', content: [{ type: 'text', text: extra.text ?? 'x' }] },
  ],
  commands: [{ name: 'x' }],
  customEntries: [1],
  lastSeq: 99,
  lastOutputAt: 8,
});

describe('cachedPartializeSessions', () => {
  it('隐藏协作者标签只活在内存，不改变成员持久化', () => {
    const persisted = cachedPartializeSessions({
      conversations: { a: { ...conv('a'), coworkerIds: ['child'], hiddenCoworkerIds: ['child'] } },
      order: ['a'],
      activeId: 'a',
    });
    expect(persisted.conversations.a.hiddenCoworkerIds).toBeUndefined();
    expect(persisted.conversations.a.coworkerIds).toEqual(['child']);
  });
  it('preserves empty worktree drafts and their names across serialization', () => {
    const worktree = {
      conversationId: 'a',
      projectId: 'p',
      repoPath: '/repo',
      path: '/managed/a',
      branch: 'enso/a',
      baseBranch: 'main',
      baseCommit: 'abc',
      createdAt: 1,
      name: 'Feature',
    };
    const persisted = cachedPartializeSessions({
      conversations: {
        a: {
          ...conv('a'),
          title: '',
          started: false,
          sessionFile: undefined,
          messages: [],
          worktree,
        },
      },
      order: ['a'],
      activeId: 'a',
    });
    const restored = JSON.parse(JSON.stringify(persisted));
    expect(restored.conversations.a.worktree).toEqual(worktree);
    expect(restored.conversations.a.messages).toEqual([]);
    expect(restored.order).toEqual(['a']);
    expect(restored.activeId).toBe('a');
  });
  it('strips messages and returns the same object when only transcript changes', () => {
    const first = cachedPartializeSessions({
      conversations: { a: conv('a', { text: 'one' }) },
      order: ['a'],
      activeId: 'a',
    });
    const second = cachedPartializeSessions({
      conversations: { a: conv('a', { text: 'two' }) },
      order: ['a'],
      activeId: 'a',
    });
    expect(first).toBe(second);
    expect(first.conversations.a.messages).toEqual([]);
    expect(first.conversations.a.lastActiveAt).toBe(10);
    expect(first.conversations.a.status).toBe('idle');
    expect(first.conversations.a.toolOutputs).toEqual({});
    expect(first.conversations.a.toolStartedAt).toEqual({});
    expect(first.conversations.a.historyLoading).toBeUndefined();
  });

  it('rebuilds when a persisted field changes', () => {
    const first = cachedPartializeSessions({
      conversations: { a: conv('a') },
      order: ['a'],
      activeId: 'a',
    });
    const next = cachedPartializeSessions({
      conversations: { a: conv('a', { title: 'renamed' }) },
      order: ['a'],
      activeId: 'a',
    });
    expect(next).not.toBe(first);
    expect(next.conversations.a.title).toBe('renamed');
  });

  it('reuses untouched conversations when another one changes', () => {
    const b = conv('b');
    const first = cachedPartializeSessions({
      conversations: { a: conv('a'), b },
      order: ['a', 'b'],
      activeId: 'a',
    });
    const next = cachedPartializeSessions({
      conversations: { a: conv('a', { title: 'renamed' }), b },
      order: ['a', 'b'],
      activeId: 'a',
    });
    expect(next).not.toBe(first);
    expect(next.conversations.b).toBe(first.conversations.b);
  });

  it('rebuilds when order or active conversation changes', () => {
    const a = conv('a');
    const b = conv('b');
    const first = cachedPartializeSessions({
      conversations: { a, b },
      order: ['a', 'b'],
      activeId: 'a',
    });
    const reordered = cachedPartializeSessions({
      conversations: { a, b },
      order: ['b', 'a'],
      activeId: 'a',
    });
    expect(reordered).not.toBe(first);
    expect(reordered.order).toEqual(['b', 'a']);
    const switched = cachedPartializeSessions({
      conversations: { a, b },
      order: ['b', 'a'],
      activeId: 'b',
    });
    expect(switched).not.toBe(reordered);
    expect(switched.activeId).toBe('b');
  });

  it('omits btw conversations from persistence', () => {
    const persisted = cachedPartializeSessions({
      conversations: {
        a: conv('a'),
        btw: { ...conv('btw'), btwParentId: 'a', btwRolePrompt: 'secret' },
      },
      order: ['a', 'btw'],
      activeId: 'btw',
    });
    expect(persisted.conversations.btw).toBeUndefined();
    expect(persisted.conversations.a).toBeDefined();
    expect(persisted.order).toEqual(['a']);
    expect(persisted.activeId).toBe('a');
  });

  it('preserves child records and parent links but lists only roots and selects the parent', () => {
    const persisted = cachedPartializeSessions({
      conversations: {
        first: conv('first'),
        parent: { ...conv('parent'), coworkerIds: ['child'] },
        child: { ...conv('child'), parentId: 'parent' },
      },
      order: ['child', 'first', 'parent', 'missing'],
      activeId: 'child',
    });
    const restored = JSON.parse(JSON.stringify(persisted));
    expect(restored.conversations.child.parentId).toBe('parent');
    expect(restored.conversations.parent.coworkerIds).toEqual(['child']);
    expect(restored.order).toEqual(['first', 'parent']);
    expect(restored.activeId).toBe('parent');
  });

  it.each(['orphan', 'missing', 'btw', 'nested', null])(
    'falls back to the first root for invalid active id %s',
    (activeId) => {
      const persisted = cachedPartializeSessions({
        conversations: {
          root: conv('root'),
          orphan: { ...conv('orphan'), parentId: 'missing' },
          btw: { ...conv('btw'), btwParentId: 'root' },
          nested: { ...conv('nested'), parentId: 'orphan' },
        },
        order: ['orphan', 'btw', 'missing', 'nested', 'root'],
        activeId,
      });
      expect(persisted.order).toEqual(['root']);
      expect(persisted.activeId).toBe('root');
      expect(persisted.conversations.orphan.parentId).toBe('missing');
    }
  );

  it('uses null when no listed root remains', () => {
    const persisted = cachedPartializeSessions({
      conversations: { child: { ...conv('child'), parentId: 'missing' } },
      order: ['child', 'missing'],
      activeId: 'child',
    });
    expect(persisted.order).toEqual([]);
    expect(persisted.activeId).toBeNull();
    expect(persisted.conversations.child.parentId).toBe('missing');
  });
});
