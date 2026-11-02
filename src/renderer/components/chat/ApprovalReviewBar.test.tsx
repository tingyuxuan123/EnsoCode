import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ApprovalReviewBar } from './ApprovalReviewBar';

vi.mock('@/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
const render = (value: unknown) =>
  renderToStaticMarkup(createElement(ApprovalReviewBar, { value }));
const base = {
  model: 'jev-latest',
  actionHash: 'a'.repeat(64),
  allow: 0.67,
  ask: 0.1,
  block: 0.23,
};
describe('managed approval audit footer', () => {
  it('displays denial and reason without raw argument or credential fields', () => {
    const html = render({
      ...base,
      verdict: 'deny',
      reason: 'unclear_target',
      apiKey: 'secret-key',
    });
    expect(html).toContain('Auto-managed · denied');
    expect(html).toContain('allow 0.67');
    expect(html).toContain('Unclear target or intent');
    expect(html).not.toContain('secret-key');
  });
  it('shows allow and human fallback, rejects malformed distributions', () => {
    expect(render({ ...base, verdict: 'allow', allow: 0.95, ask: 0.05, block: 0 })).toContain(
      'Auto-managed · allowed'
    );
    expect(
      render({
        verdict: 'fallback',
        model: 'jev-latest',
        actionHash: base.actionHash,
        fallback: 'timeout',
      })
    ).toContain('Auto-managed · asks you');
    expect(render({ ...base, verdict: 'allow', allow: 1 })).toBe('');
    expect(render(undefined)).toBe('');
  });
});
