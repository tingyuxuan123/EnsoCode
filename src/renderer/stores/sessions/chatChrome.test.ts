import { describe, expect, it } from 'vitest';
import { displayedConversationId, selectChatChrome } from './chatChrome';
import type { Conversation } from './index';

const conv = (id: string, extra: Partial<Conversation> = {}): Conversation =>
  ({
    id,
    projectId: 'p',
    title: 't',
    status: 'running',
    spawning: false,
    started: true,
    createdAt: 1,
    messages: [],
    customEntries: [],
    commands: [],
    lastSeq: 0,
    dispatchMainEvents: {},
    activeMs: 0,
    pendingApprovals: [],
    pendingAsks: [],
    backgroundTasks: [],
    subagents: [],
    toolOutputs: {},
    ...extra,
  }) as Conversation;

describe('selectChatChrome', () => {
  it('只改 messages / lastSeq 时切片字段引用不变', () => {
    const parent = conv('parent', {
      messages: [{ role: 'assistant', content: [{ type: 'thinking', text: 'a' }] }],
      lastSeq: 1,
    });
    const first = selectChatChrome({
      activeId: 'parent',
      conversations: { parent },
    });
    const second = selectChatChrome({
      activeId: 'parent',
      conversations: {
        parent: {
          ...parent,
          messages: [{ role: 'assistant', content: [{ type: 'thinking', text: 'ab' }] }],
          lastSeq: 2,
          lastOutputAt: 99,
        },
      },
    });
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    const keys = Object.keys(first!) as (keyof NonNullable<typeof first>)[];
    for (const key of keys) {
      expect(second![key]).toBe(first![key]);
    }
  });
});

describe('displayedConversationId', () => {
  it('选中 coworker 页签时返回 coworker，失效页签回落父会话', () => {
    const parent = conv('parent', { activeTabId: 'cw' });
    const coworker = conv('cw', { parentId: 'parent' });
    expect(
      displayedConversationId({ activeId: 'parent', conversations: { parent, cw: coworker } })
    ).toBe('cw');
    expect(displayedConversationId({ activeId: 'parent', conversations: { parent } })).toBe(
      'parent'
    );
    expect(displayedConversationId({ activeId: null, conversations: {} })).toBeNull();
  });
});
