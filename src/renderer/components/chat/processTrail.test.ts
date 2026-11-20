import { describe, expect, it } from 'vitest';
import type { TimelineItem } from '@/stores/sessions/timeline';
import {
  collectLiveEnteredKeys,
  isProcessTimelineItem,
  LIVE_ENTER_MS,
  processRowGap,
  shouldShowProcessRail,
} from './processTrail';

const textRow = (key = 'txt-1'): TimelineItem => ({
  kind: 'text',
  key,
  text: 'hello',
  streaming: false,
});

const thinkingRow = (key = 'th-1', nested?: boolean): TimelineItem => ({
  kind: 'thinking',
  key,
  text: 'plan',
  streaming: false,
  durationMs: 1200,
  nested,
});

const toolRow = (key = 'tool-1', nested?: boolean): Extract<TimelineItem, { kind: 'tool' }> => ({
  kind: 'tool',
  key,
  name: 'bash',
  summary: 'ls',
  output: null,
  state: 'ok',
  edits: null,
  writeContent: null,
  todos: null,
  durationMs: 200,
  agentMeta: null,
  nested,
});

const groupRow = (
  key = 'grp-1',
  worklog = false
): Extract<TimelineItem, { kind: 'tool-group' }> => ({
  kind: 'tool-group',
  key,
  expanded: false,
  count: 2,
  stats: { commands: 0, reads: 2, searches: 0, others: 0 },
  exploring: false,
  children: [],
  ...(worklog
    ? {
        worklog: {
          status: 'completed' as const,
          forced: false,
          thinking: 1,
          failed: 0,
          durationMs: 3000,
        },
      }
    : {}),
});

describe('processTrail helpers', () => {
  it('classifies tools, thinking, and non-worklog tool groups as process steps', () => {
    expect(isProcessTimelineItem(toolRow())).toBe(true);
    expect(isProcessTimelineItem(thinkingRow())).toBe(true);
    expect(isProcessTimelineItem(groupRow('g', false))).toBe(true);
    expect(isProcessTimelineItem(groupRow('w', true))).toBe(false);
    expect(isProcessTimelineItem(textRow())).toBe(false);
  });

  it('tightens spacing and connects consecutive top-level process steps with a rail', () => {
    const a = toolRow('a');
    const b = thinkingRow('b');
    const c = textRow('c');
    const nestedChild = toolRow('n', true);
    const todoCard: TimelineItem = {
      ...toolRow('todo'),
      todos: [{ content: 'x', status: 'pending' }],
    };
    const browserGroup: TimelineItem = {
      ...groupRow('bg', false),
      browser: { count: 2, thinkingMs: null, failed: 0, warnings: 0 },
    };

    expect(processRowGap(a, b)).toBe('pb-1.5');
    expect(shouldShowProcessRail(a, b)).toBe(true);

    expect(processRowGap(a, c)).toBe('pb-4');
    expect(shouldShowProcessRail(a, c)).toBe(false);

    expect(processRowGap(a, nestedChild)).toBe('pb-2');
    expect(shouldShowProcessRail(a, nestedChild)).toBe(false);
    expect(shouldShowProcessRail(nestedChild, b)).toBe(false);

    expect(shouldShowProcessRail(a, todoCard)).toBe(false);
    expect(shouldShowProcessRail(todoCard, b)).toBe(false);
    expect(shouldShowProcessRail(a, browserGroup)).toBe(false);

    expect(processRowGap(groupRow('w', true), a)).toBe('pb-5');
  });

  it('animates only newly appended keys while running, never initial history or expired items', () => {
    const seen = new Set<string>();
    const active = new Map<string, number>();

    // Initial mount (existing history): marks all keys seen without scheduling entrance motion.
    const initial = collectLiveEnteredKeys(seen, ['u-1', 't-1'], true, 1000, active, true);
    expect(initial.size).toBe(0);
    expect([...seen]).toEqual(['u-1', 't-1']);

    // New live step arrives while running: gets entrance timestamp.
    const live = collectLiveEnteredKeys(seen, ['u-1', 't-1', 't-2'], true, 1100, active, false);
    expect(live.has('t-2')).toBe(true);
    expect(live.has('t-1')).toBe(false);

    // Still active within LIVE_ENTER_MS window.
    const stillActive = collectLiveEnteredKeys(
      seen,
      ['u-1', 't-1', 't-2'],
      true,
      1100 + LIVE_ENTER_MS - 50,
      active,
      false
    );
    expect(stillActive.has('t-2')).toBe(true);

    // Expires once window elapses; new keys when not running do not animate.
    const expired = collectLiveEnteredKeys(
      seen,
      ['u-1', 't-1', 't-2', 'hist-0'],
      false,
      1100 + LIVE_ENTER_MS + 10,
      active,
      false
    );
    expect(expired.size).toBe(0);
  });

  it('marks suppressed keys as seen without scheduling a redundant entrance animation', () => {
    const seen = new Set<string>(['u-1', 't-1']);
    const active = new Map<string, number>();
    const live = collectLiveEnteredKeys(
      seen,
      ['u-1', 'group-t-1', 't-3'],
      true,
      2000,
      active,
      false,
      new Set(['group-t-1'])
    );
    expect(seen.has('group-t-1')).toBe(true);
    expect(live.has('group-t-1')).toBe(false);
    expect(live.has('t-3')).toBe(true);
  });
});
