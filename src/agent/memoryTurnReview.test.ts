import { describe, expect, it, vi } from 'vitest';
import {
  isReviewHiddenMessage,
  MEMORY_REVIEW_MESSAGE,
  memoryTurnReviewExtension,
  parseMemoryUpsertReceipt,
  reviewHiddenKeys,
} from './memoryTurnReview';
import { projectMessage } from './projection';

function harness() {
  const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
  const enabled = vi.fn(() => true);
  const fail = vi.fn();
  const start = vi.fn();
  const ctx = {
    signal: new AbortController().signal,
    hasPendingMessages: () => false,
    abort: vi.fn(),
  };
  memoryTurnReviewExtension(enabled, { start, fail }).factory({
    on: (k: string, fn: (event: unknown, ctx: unknown) => unknown) => handlers.set(k, fn),
  } as never);
  const fire = (k: string, event: unknown) => handlers.get(k)?.(event, ctx);
  const user = () => fire('message_start', { message: { role: 'user' } });
  const finish = (text = '总结完成', outcome = 'completed') =>
    fire('agent_before_settle', {
      outcome,
      continue: false,
      entries: [],
      context: {
        pendingMessages: [],
        contextMessages: [
          { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text }] },
        ],
      },
    });
  const write = (written: boolean) =>
    fire('tool_result', {
      toolName: 'memory_upsert',
      isError: false,
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            written,
            status: written ? 'updated' : 'pending_review',
            relPath: 'wiki/decisions/test.md',
          }),
        },
      ],
    });
  user();
  return { ctx, enabled, fail, start, fire, finish, write, user };
}

describe('same-session wiki review', () => {
  it('continues once after a real answer; requires a write receipt or an explicit empty decision', () => {
    const h = harness();
    expect(h.finish()).toMatchObject({
      continue: true,
      entries: [{ type: 'custom_message', display: false }],
    });
    expect(h.start).toHaveBeenCalledTimes(1);
    expect(h.finish('已写入 Wiki')).toBeUndefined();
    expect(h.fail).toHaveBeenCalledOnce();
    h.user();
    expect(h.finish()).toMatchObject({ continue: true });
    h.finish('本轮无新增项目记忆。');
    expect(h.fail).toHaveBeenCalledTimes(1);
  });

  it('does not duplicate a real write or turn a failed write into no updates', () => {
    const h = harness();
    h.write(true);
    expect(h.finish()).toBeUndefined();
    h.user();
    h.finish();
    h.write(false);
    h.finish('本轮无新增项目记忆。');
    expect(h.fail).toHaveBeenCalledOnce();
  });

  it('accepts the machine receipt despite text reminders, and never labels a failed lookup as no change', () => {
    const h = harness();
    h.fire('tool_result', {
      toolName: 'memory_upsert',
      content: [{ type: 'text', text: '<system-reminder>...</system-reminder>\n{}' }],
      details: { written: true, status: 'updated', relPath: 'wiki/page.md' },
    });
    expect(h.finish()).toBeUndefined();
    h.user();
    h.finish();
    h.fire('tool_result', { toolName: 'memory_index', content: [], isError: true });
    h.finish('本轮无新增项目记忆。');
    expect(h.fail).toHaveBeenCalledOnce();
  });

  it('keeps review project-scoped, blocks unrelated tools, releases restrictions for a follow-up', () => {
    const h = harness();
    h.finish();
    const call = (toolName: string, input: Record<string, unknown>) =>
      h.fire('tool_call', { toolName, input });
    expect(call('bash', {})).toMatchObject({ block: true });
    expect(call('memory_archive', {})).toMatchObject({ block: true });
    expect(call('memory_upsert', { spaceId: 'global' })).toMatchObject({ block: true });
    expect(call('memory_upsert', { spaceId: 'project' })).toBeUndefined();
    h.enabled.mockReturnValue(false);
    expect(call('memory_upsert', { spaceId: 'project' })).toMatchObject({ block: true });
    h.user();
    expect(call('bash', {})).toBeUndefined();
  });

  it('never continues stopped, failed, disabled, or empty replies', () => {
    const h = harness();
    expect(h.finish('partial', 'aborted')).toBeUndefined();
    expect(h.finish('partial', 'error')).toBeUndefined();
    expect(h.finish('')).toBeUndefined();
    h.enabled.mockReturnValue(false);
    expect(h.finish()).toBeUndefined();
  });

  it('does not project the internal review instruction as another chat message', () => {
    const h = harness();
    const r = h.finish() as {
      entries: { customType: string; content: string; display: boolean }[];
    };
    expect(projectMessage({ role: 'custom', ...r.entries[0] })).toBeNull();
    const marker = { role: 'custom', ...r.entries[0] };
    h.user();
    expect(h.fire('context', { messages: [marker, { role: 'user', content: 'next' }] })).toEqual({
      messages: [{ role: 'user', content: 'next' }],
    });
  });
});

describe('review transcript suppression', () => {
  const entry = (role: string, timestamp: number) => ({
    type: 'message',
    message: { role, timestamp },
  });
  const marker = { type: 'custom_message', customType: MEMORY_REVIEW_MESSAGE };

  it('hides everything after the instruction up to the next user message, across reloads', () => {
    const branch = [
      entry('user', 1),
      entry('assistant', 2),
      marker,
      entry('assistant', 3),
      { type: 'message', message: { role: 'toolResult', timestamp: 4 } },
      entry('user', 5),
      entry('assistant', 6),
    ];
    const hidden = reviewHiddenKeys(branch);
    expect([...hidden].sort()).toEqual(['assistant:3', 'toolResult:4']);
    expect(hidden.has('assistant:2')).toBe(false);
    expect(hidden.has('assistant:6')).toBe(false);
  });

  it('keeps the real answer visible and never hides a user message in the live phase', () => {
    expect(isReviewHiddenMessage(true, { role: 'assistant', timestamp: 3 })).toBe(true);
    expect(isReviewHiddenMessage(true, { role: 'toolResult', timestamp: 4 })).toBe(true);
    expect(isReviewHiddenMessage(true, { role: 'user', timestamp: 5 })).toBe(false);
    expect(isReviewHiddenMessage(false, { role: 'assistant', timestamp: 6 })).toBe(false);
  });
});

describe('memory upsert receipts', () => {
  it('keeps only landed writes and tolerates reminders before the JSON', () => {
    expect(
      parseMemoryUpsertReceipt(
        '<system-reminder>x</system-reminder>\n{"status":"updated","written":true,"relPath":"wiki/a.md","spaceId":"proj:p","title":"A"}'
      )
    ).toEqual({ spaceId: 'proj:p', relPath: 'wiki/a.md', title: 'A', status: 'updated' });
    expect(
      parseMemoryUpsertReceipt({ status: 'pending_review', written: false, relPath: 'wiki/a.md', spaceId: 'proj:p' })
    ).toBeNull();
    expect(parseMemoryUpsertReceipt({ status: 'created', written: true })).toBeNull();
    // 真实回执里 truncated 是 false，曾因只认 true 把整段 diff 丢掉
    expect(
      parseMemoryUpsertReceipt({
        status: 'updated',
        written: true,
        spaceId: 'proj:p',
        relPath: 'wiki/a.md',
        diff: { patch: '-a\n+b', added: 1, removed: 1, truncated: false },
      })?.diff
    ).toEqual({ patch: '-a\n+b', added: 1, removed: 1, truncated: false });
  });
});
