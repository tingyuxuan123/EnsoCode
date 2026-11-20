import { describe, expect, it } from 'vitest';
import type { TimelineItem } from '@/stores/sessions/timeline';
import {
  buildTypeSchedule,
  computeCycleTimings,
  cuedMusings,
  evaluateMusingFrame,
  extractCommandLabel,
  generalMusings,
  isCompactingTurn,
  isReviewingTurn,
  MUSING_TIMING,
  musingCueFor,
  pickNextPhrase,
  stripTrailingEllipsis,
} from './workingMusings';

const user = (key = 'u-1'): Extract<TimelineItem, { kind: 'user' }> => ({
  kind: 'user',
  key,
  text: 'do the thing',
  images: [],
});

const tool = (
  overrides: Partial<Extract<TimelineItem, { kind: 'tool' }>>
): Extract<TimelineItem, { kind: 'tool' }> => ({
  kind: 'tool',
  key: 'tool-1',
  name: 'bash',
  summary: '',
  output: null,
  state: 'ok',
  edits: null,
  writeContent: null,
  todos: null,
  durationMs: null,
  agentMeta: null,
  ...overrides,
});

describe('extractCommandLabel', () => {
  it('extracts program and subcommand across cd chains, env vars, sudo, and pipes', () => {
    expect(extractCommandLabel('cd packages/app && NODE_ENV=test pnpm test | tail -n 20')).toBe(
      'pnpm test'
    );
    expect(extractCommandLabel('sudo /usr/bin/git status --short')).toBe('git status');
    expect(extractCommandLabel('cd /tmp && ls -la')).toBe('ls');
    expect(extractCommandLabel('python3 scripts/build.py')).toBe('python3');
  });

  it('returns empty string for blank input, pure cd, or raw json payloads', () => {
    expect(extractCommandLabel('')).toBe('');
    expect(extractCommandLabel('   cd /Users/foo  ')).toBe('');
    expect(extractCommandLabel('{"taskId":"task-1"}')).toBe('');
  });

  it('truncates overly long command labels', () => {
    const label = extractCommandLabel('superlongcommandname-that-exceeds-limit check');
    expect(label.length).toBeLessThanOrEqual(22);
    expect(label.endsWith('…')).toBe(true);
  });
});

describe('musingCueFor', () => {
  it('returns null right after a user turn so previous turns never bleed over', () => {
    const prevEdit = tool({ key: 't-old', name: 'edit', summary: 'src/old.ts', state: 'ok' });
    expect(musingCueFor([user('u-1'), prevEdit, user('u-2')])).toBeNull();
    expect(musingCueFor([])).toBeNull();
  });

  it('derives command, commandRunning, and commandFailed cues from shell tools', () => {
    expect(
      musingCueFor([user(), tool({ name: 'bash', summary: 'pnpm vitest run', state: 'ok' })])
    ).toEqual({ topic: 'command', name: 'pnpm vitest' });

    expect(
      musingCueFor([user(), tool({ name: 'bash', summary: 'pnpm test', state: 'running' })])
    ).toEqual({ topic: 'commandRunning', name: 'pnpm test' });

    expect(
      musingCueFor([
        user(),
        tool({ name: 'powershell', summary: 'cargo build --release', state: 'error' }),
      ])
    ).toEqual({ topic: 'commandFailed', name: 'cargo build' });
  });

  it('ignores raw JSON summaries such as task_output payloads', () => {
    expect(
      musingCueFor([
        user(),
        tool({ name: 'task_output', summary: '{"taskId":"task-10-mwooqme1","timeout":5000}' }),
      ])
    ).toBeNull();
  });

  it('derives read, edit, search, folder, web, agent, mcp, browser, image, and sandbox cues', () => {
    expect(
      musingCueFor([
        user(),
        tool({ name: 'read', summary: 'src/renderer/components/chat/WorkingStatus.tsx:1-90' }),
      ])
    ).toEqual({ topic: 'read', name: 'WorkingStatus.tsx' });

    expect(
      musingCueFor([user(), tool({ name: 'edit', summary: 'src/renderer/styles/shared.css' })])
    ).toEqual({ topic: 'edit', name: 'shared.css' });

    expect(
      musingCueFor([
        user(),
        tool({
          name: 'apply_patch',
          summary: '2 files',
          fileChanges: [
            { path: 'src/a.ts', type: 'update', oldText: 'a', newText: 'a2' },
            { path: 'src/b.ts', type: 'update', oldText: 'b', newText: 'b2' },
          ],
        }),
      ])
    ).toEqual({ topic: 'edit', name: 'a.ts' });

    expect(musingCueFor([user(), tool({ name: 'code_search', summary: 'WorkingStatus' })])).toEqual(
      { topic: 'search', name: 'WorkingStatus' }
    );

    expect(
      musingCueFor([user(), tool({ name: 'ls', summary: 'src/renderer/components/chat' })])
    ).toEqual({ topic: 'folder', name: 'chat' });

    expect(musingCueFor([user(), tool({ name: 'ls', summary: '.' })])).toBeNull();

    expect(
      musingCueFor([
        user(),
        tool({ name: 'web_fetch', summary: 'https://www.react.dev/reference/react' }),
      ])
    ).toEqual({ topic: 'web', name: 'react.dev' });

    expect(
      musingCueFor([user(), tool({ name: 'subagent', summary: 'Codebase Researcher' })])
    ).toEqual({ topic: 'agent', name: 'Codebase Researcher' });

    expect(
      musingCueFor([user(), tool({ name: 'mcp__github__list_pull_requests', summary: '' })])
    ).toEqual({ topic: 'mcp', name: 'list_pull_requests' });

    expect(musingCueFor([user(), tool({ name: 'browser_snapshot', summary: '' })])).toEqual({
      topic: 'browser',
      name: '',
    });

    expect(musingCueFor([user(), tool({ name: 'generate_image', summary: 'sunset' })])).toEqual({
      topic: 'image',
      name: '',
    });

    expect(musingCueFor([user(), tool({ name: 'codemode', summary: 'bash x2' })])).toEqual({
      topic: 'sandbox',
      name: '',
    });
  });

  it('looks back past a live thinking item to the preceding tool in the same turn, but stops at text', () => {
    const readTool = tool({ name: 'read', summary: 'src/App.tsx', state: 'ok' });
    const thinking: Extract<TimelineItem, { kind: 'thinking' }> = {
      kind: 'thinking',
      key: 'th-1',
      text: 'hmm',
      streaming: true,
      durationMs: null,
    };
    expect(musingCueFor([user(), readTool, thinking])).toEqual({
      topic: 'read',
      name: 'App.tsx',
    });

    const textItem: Extract<TimelineItem, { kind: 'text' }> = {
      kind: 'text',
      key: 'txt-1',
      text: 'Done',
      streaming: true,
    };
    expect(musingCueFor([user(), readTool, textItem])).toBeNull();
  });

  it('unwraps folded tool-group children to find the latest completed tool', () => {
    const group: Extract<TimelineItem, { kind: 'tool-group' }> = {
      kind: 'tool-group',
      key: 'g-1',
      expanded: false,
      count: 2,
      stats: { reads: 2, searches: 0, commands: 0, others: 0 },
      exploring: false,
      children: [
        tool({ key: 't-1', name: 'read', summary: 'src/a.ts' }),
        tool({ key: 't-2', name: 'read', summary: 'src/b.ts' }),
      ],
    };
    expect(musingCueFor([user(), group])).toEqual({ topic: 'read', name: 'b.ts' });
  });
});

describe('turn status predicates and phrase selection', () => {
  it('detects compacting and reviewing states cleanly', () => {
    expect(
      isCompactingTurn([user(), { kind: 'compaction-progress', key: 'c-1', state: 'running' }])
    ).toBe(true);
    expect(isCompactingTurn([user(), tool({ name: 'read', summary: 'a.ts' })])).toBe(false);

    expect(isReviewingTurn([user(), tool({ name: 'bash', state: 'reviewing' })])).toBe(true);
    expect(isReviewingTurn([user(), tool({ name: 'bash', state: 'running' })])).toBe(false);
  });

  it('strips trailing ascii or unicode ellipsis from fixed labels', () => {
    expect(stripTrailingEllipsis('Loading…')).toBe('Loading');
    expect(stripTrailingEllipsis('加载中...')).toBe('加载中');
    expect(stripTrailingEllipsis('等你处理')).toBe('等你处理');
  });

  it('provides non-empty bilingual general and cued phrases without trailing ellipses', () => {
    for (const locale of ['zh', 'en'] as const) {
      const general = generalMusings(locale);
      expect(general.length).toBeGreaterThanOrEqual(15);
      for (const phrase of general) {
        expect(phrase.trim()).toBe(phrase);
        expect(phrase.endsWith('…')).toBe(false);
        expect(phrase.endsWith('...')).toBe(false);
      }
      const cued = cuedMusings({ topic: 'commandFailed', name: 'pnpm test' }, locale);
      expect(cued.length).toBeGreaterThanOrEqual(2);
      expect(cued.every((phrase) => phrase.includes('pnpm test'))).toBe(true);
    }

    // Defensive fallback when locale is omitted in partial i18n mocks
    expect(generalMusings(undefined)).toEqual(generalMusings('en'));
    expect(cuedMusings({ topic: 'read', name: 'App.tsx' }, undefined)).toEqual(
      cuedMusings({ topic: 'read', name: 'App.tsx' }, 'en')
    );
  });

  it('prefers cued phrases according to weight and avoids immediate repetition', () => {
    const general = ['A', 'B'];
    const cued = ['C1', 'C2'];
    // First rng roll < 0.7 -> picks from cued, second roll picks index 0 -> 'C1'
    const rolls = [0.2, 0.0, 0.2, 0.0];
    let idx = 0;
    const rng = () => rolls[idx++] ?? 0;

    const first = pickNextPhrase({ general, cued, random: rng });
    expect(first).toBe('C1');
    // Avoiding 'C1' from 2-item cued pool forces 'C2'
    const second = pickNextPhrase({ general, cued, avoid: first, random: rng });
    expect(second).toBe('C2');
  });
});

describe('typing, caret, and dot frame timeline', () => {
  it('types glyphs, glides caret, counts breathing dots, and fades out for rolling phrases', () => {
    const chars = Array.from('融会贯通');
    const typedAt = buildTypeSchedule(chars, () => 0.5);
    expect(typedAt).toHaveLength(4);
    expect(typedAt[0]).toBe(MUSING_TIMING.leadMs);
    expect(typedAt[1]! - typedAt[0]!).toBeGreaterThanOrEqual(32);

    const timings = computeCycleTimings(typedAt, true);

    // During initial lead: no characters visible yet, caret visible at index -1
    const atLead = evaluateMusingFrame(20, typedAt, true);
    expect(atLead.letterOpacities.every((o) => o === 0)).toBe(true);
    expect(atLead.showCaret).toBe(true);
    expect(atLead.caretSegmentIndex).toBe(-1);
    expect(atLead.dotOpacities).toEqual([0, 0, 0]);

    // After typing finishes and during caret rest: all characters fully visible, caret resting
    const atRest = evaluateMusingFrame(timings.dotsAt - 200, typedAt, true);
    expect(atRest.letterOpacities).toEqual([1, 1, 1, 1]);
    expect(atRest.showCaret).toBe(true);
    expect(atRest.dotOpacities).toEqual([0, 0, 0]);

    // Mid dot round: caret gone, first dot visible, third dot not yet visible
    const atDot1 = evaluateMusingFrame(
      timings.dotsAt + MUSING_TIMING.dotStepMs + 200,
      typedAt,
      true
    );
    expect(atDot1.showCaret).toBe(false);
    expect(atDot1.dotOpacities[0]).toBe(1);
    expect(atDot1.dotOpacities[2]).toBe(0);

    // Mid clear fade: whole phrase fading out
    const atClear = evaluateMusingFrame(timings.clearAt + MUSING_TIMING.clearMs / 2, typedAt, true);
    expect(atClear.fade).toBeCloseTo(0.5, 2);
  });

  it('keeps fixed labels solid on subsequent dot loops when typedAt is empty', () => {
    const timings = computeCycleTimings([], false);
    expect(timings.dotsAt).toBe(0);
    expect(timings.cycleMs).toBe(MUSING_TIMING.dotRoundMs * MUSING_TIMING.dotRounds);

    const frame = evaluateMusingFrame(MUSING_TIMING.dotStepMs * 2 + 200, [], false, 3);
    expect(frame.fade).toBe(1);
    expect(frame.showCaret).toBe(false);
    expect(frame.letterOpacities).toEqual([1, 1, 1]);
    expect(frame.dotOpacities[0]).toBe(1);
    expect(frame.dotOpacities[1]).toBe(1);
    expect(frame.dotOpacities[2]).toBe(0);
  });
});
