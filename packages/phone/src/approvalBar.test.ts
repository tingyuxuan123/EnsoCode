import { applyGuestEvent, emptyGuestView } from '@shared/pair/guestProjection';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ApprovalBar } from '@/components/chat/ApprovalBar';

vi.mock('@/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));

describe('phone shared approval card', () => {
  it('renders actionable fallback after a reviewing event for the same request', () => {
    const request = { requestId: 'apr', tool: 'bash', kind: 'command', summary: 'action' };
    const reviewing = applyGuestEvent(emptyGuestView(), {
      type: 'approval-request',
      request: { ...request, phase: 'reviewing' },
    }).view;
    const fallback = applyGuestEvent(reviewing, {
      type: 'approval-request',
      request: { ...request, reviewFallback: 'too-large' },
    }).view;
    expect(fallback.approvals).toHaveLength(1);
    const html = renderToStaticMarkup(
      createElement(ApprovalBar, { approvals: fallback.approvals, onRespond: () => {} })
    );
    expect(html).toContain('Tool arguments are too large to review safely. Please decide.');
    expect(html).toContain('Deny');
    expect(html).toContain('Allow');
    expect(html).not.toContain('disabled=""');
  });
  it('shows the human fallback reason and protected marker without session-wide permission', () => {
    const html = renderToStaticMarkup(
      createElement(ApprovalBar, {
        approvals: [
          {
            requestId: 'apr',
            tool: 'bash',
            kind: 'command',
            summary: 'delete',
            reviewFallback: 'too-large',
            protected: 'delete',
          },
        ],
        onRespond: () => {},
      })
    );
    expect(html).toContain('Tool arguments are too large to review safely. Please decide.');
    expect(html).toContain('Protected: delete');
    expect(html).not.toContain('Always allow this session');
    expect(html).toContain('Deny');
  });
});
