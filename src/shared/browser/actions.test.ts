import { describe, expect, it } from 'vitest';
import { actionChanges, findActionTarget, parseBrowserActions } from './actions';
import type { SnapshotEntry } from './snapshot';

const button = (ref: string, name: string): SnapshotEntry => ({
  ref,
  name,
  role: 'button',
  kind: 'click',
  depth: 0,
});

describe('bounded browser actions', () => {
  it('accepts a typed sequence including targets discovered by later steps', () => {
    expect(
      parseBrowserActions({
        steps: [
          { action: 'click', target: 'Search', role: 'button' },
          { action: 'type', target: 'Query', text: 'hello', submit: true },
          { action: 'wait', text: 'Results', timeoutMs: 2000 },
        ],
      })
    ).toHaveLength(3);
  });

  it('validates the ENTIRE sequence before any step can execute', () => {
    for (const steps of [
      [],
      Array.from({ length: 11 }, () => ({ action: 'press', key: 'Tab' })),
      [
        { action: 'press', key: 'Tab' },
        { action: 'cdp', method: 'Input.insertText' },
      ],
      [{ action: 'click', ref: 'e1', tabId: 'other' }],
      [{ action: 'click', ref: 'e1', target: 'Delete' }],
      [{ action: 'type', target: 'Query' }],
      [{ action: 'wait', text: 'ready', timeoutMs: -1 }],
      [{ action: 'wait', text: 'ready', timeoutMs: 30001 }],
      [{ action: 'navigate', url: 'javascript:alert(1)' }],
      [{ action: 'type', ref: 'e1', text: 'x'.repeat(32001) }],
    ])
      expect(() => parseBrowserActions({ steps })).toThrow();
    expect(() =>
      parseBrowserActions({ steps: [{ action: 'press', key: 'Tab' }], file: '/tmp/x' })
    ).toThrow();
  });

  it('rejects unsafe navigation, bad keys, invalid waits and oversized values up front', () => {
    for (const step of [
      { action: 'navigate', url: 'javascript:alert(1)' },
      { action: 'press', key: 'UnknownModifier+A' },
      { action: 'wait', text: 'Ready', timeoutMs: 10001 },
      { action: 'scroll', amount: -20 },
      { action: 'type', ref: 'e1', target: 'Query', text: 'x' },
      { action: 'select', ref: 'e1', values: [null] },
      { action: 'click', target: 'Save', nth: 0 },
    ])
      expect(() =>
        parseBrowserActions({ steps: [{ action: 'press', key: 'Tab' }, step] })
      ).toThrow();
  });
});

describe('action targets and compact feedback', () => {
  it('识别中文按钮的排版空格，但仍优先完整精确名称并拒绝歧义', () => {
    expect(findActionTarget([button('e1', '登 录')], { target: '登录' })).toBe('e1');
    expect(
      findActionTarget([button('e1', '登 录'), button('e2', '登录')], { target: '登录' })
    ).toBe('e2');
    expect(() =>
      findActionTarget([button('e1', '登 录'), button('e2', '登　录')], { target: '登录' })
    ).toThrow(/ambiguous/i);
    expect(findActionTarget([button('e1', 'Sign in')], { target: 'Signin' })).toBeUndefined();
  });

  it('prefers exact visible labels and refuses ambiguous matches', () => {
    const entries = [button('e1', 'Save'), button('e2', 'Save as')];
    expect(findActionTarget(entries, { target: 'Save' })).toBe('e1');
    expect(findActionTarget(entries, { target: 'save as', role: 'button' })).toBe('e2');
    expect(findActionTarget(entries, { target: 'Missing' })).toBeUndefined();
    expect(() => findActionTarget([...entries, button('e3', 'Save')], { target: 'Save' })).toThrow(
      /ambiguous/i
    );
    expect(findActionTarget([...entries, button('e3', 'Save')], { target: 'Save', nth: 2 })).toBe(
      'e3'
    );
  });

  it('returns newly actionable refs and changed values instead of another full snapshot', () => {
    const before = [button('e1', 'Open')];
    const after = [
      button('e1', 'Close'),
      button('e2', 'Submit'),
      { role: 'text', name: 'Ready', depth: 0 },
    ];
    const feedback = actionChanges(before, after);
    expect(feedback.text).toContain('Changed:');
    expect(feedback.text).toContain('Appeared:');
    expect(feedback.text).toContain('e2');
    expect(feedback.text).toContain('Ready');
    expect(feedback.refs).toContain('e2');
    expect(actionChanges(after, after).text).toMatch(/nothing changed/i);
  });

  it('bounds noisy output and does not grant refs omitted from the feedback', () => {
    const feedback = actionChanges(
      [],
      Array.from({ length: 400 }, (_, i) => button(`e${i + 1}`, 'X'.repeat(500)))
    );
    expect(feedback.text.length).toBeLessThanOrEqual(12000);
    expect(feedback.refs.length).toBeLessThanOrEqual(40);
    expect(feedback.refs).not.toContain('e400');
    expect(feedback.text).toMatch(/browser_snapshot/);
  });
});
