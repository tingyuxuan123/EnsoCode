import { zhTranslations } from '@shared/i18n';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ApprovalBar, REVIEW_FALLBACK_LABELS } from './ApprovalBar';
import { APPROVAL_REVIEW_REASON_LABELS } from './ApprovalReviewBar';

vi.mock('@/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
const request = { requestId: 'r', tool: 'bash', kind: 'command' as const, summary: 'ls' };
const render = (extra = {}) =>
  renderToStaticMarkup(
    createElement(ApprovalBar, { approvals: [{ ...request, ...extra }], onRespond: () => {} })
  );
describe('human approval fallback', () => {
  it('all fallback and impact labels have Chinese translations', () => {
    for (const label of [
      ...Object.values(REVIEW_FALLBACK_LABELS),
      ...Object.values(APPROVAL_REVIEW_REASON_LABELS),
      'Reason',
    ]) {
      expect(zhTranslations[label]).toMatch(/[\u4e00-\u9fff]/);
    }
  });
  it('explains classifier failures and still exposes the human choices', () => {
    expect(render({ reviewFallback: 'timeout' })).toContain(
      'Auto-managed review timed out. Please decide.'
    );
    expect(render({ reviewFallback: 'invalid' })).toContain(
      'Auto-managed review returned no valid decision. Please decide.'
    );
    expect(render({ reviewFallback: 'error' })).toContain(
      'Auto-managed review failed. Please decide.'
    );
    expect(render({ reviewFallback: 'too-large' })).toContain(
      'Tool arguments are too large to review safely. Please decide.'
    );
    expect(render()).not.toContain('Auto-managed');
  });
  it('keeps protected decisions one-shot and hides human controls while reviewing', () => {
    expect(render({ protected: 'secret' })).not.toContain('Always allow this session');
    expect(render({ phase: 'reviewing' })).not.toContain('Always allow this session');
  });
});
