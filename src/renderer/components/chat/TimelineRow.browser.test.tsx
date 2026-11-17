import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { buildTimeline, type TimelineItem } from '@/stores/sessions/timeline';
import { TimelineRow } from './TimelineRow';

vi.mock('@/i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string | number>) =>
      key.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(params?.[name] ?? '')),
  }),
}));
vi.mock('@/stores/settings', () => ({
  useSettingsStore: (select: (s: object) => unknown) =>
    select({ compactReadOnlyTools: true, expandLiveEdits: false, expandLiveReasoning: false }),
}));
vi.mock('@/stores/sessions', () => ({ useSessionsStore: () => null }));
vi.mock('./Markdown', () => ({ Markdown: () => null }));
vi.mock('./EditDiff', () => ({ EditDiff: () => null }));
vi.mock('./ReadFileView', () => ({ ReadFileView: () => null }));
vi.mock('./ApprovalReviewBar', () => ({
  ApprovalReviewBar: () =>
    createElement('span', { 'data-approval-review-preserved': '' }, 'Review retained'),
}));

function row(
  name = 'browser_read',
  args: Record<string, unknown> = {},
  output = '{}',
  error = false
) {
  return buildTimeline(
    [
      { role: 'assistant', content: [{ type: 'toolCall', id: 'a', name, arguments: args }] },
      {
        role: 'toolResult',
        toolName: name,
        toolCallId: 'a',
        isError: error,
        content: [{ type: 'text', text: output }],
      },
    ],
    false
  )[0];
}
const render = (item: TimelineItem) => renderToStaticMarkup(createElement(TimelineRow, { item }));

describe('browser steps are not debugging output', () => {
  it('keeps an approval audit visible without restoring the raw JSON result card', () => {
    const item = row('browser_navigate', { description: '打开登录页' }, '{"tabId":"internal-tab"}');
    if (item.kind !== 'tool') throw new Error('missing tool');
    item.approvalReview = {
      verdict: 'allow',
      allow: 0.95,
      ask: 0.04,
      block: 0.01,
      model: 'reviewer',
      actionHash: 'a'.repeat(64),
    };
    const html = render(item);
    expect(html).toContain('data-approval-review-preserved');
    expect(html).not.toContain('internal-tab');
  });
  it('does not show a dangling separator or invented thinking time in a browser group', () => {
    const html = render({
      kind: 'tool-group',
      key: 'g',
      count: 2,
      expanded: false,
      stats: { commands: 0, reads: 0, searches: 0, others: 2 },
      exploring: false,
      children: [],
      browser: { count: 2, thinkingMs: null, failed: 0, warnings: 0 },
    });
    expect(html).toContain('Used browser 2 times');
    expect(html).not.toContain('>·</span>');
    expect(html).not.toContain('Thought for');
  });
  it('renders a readable action, not the tool name, JSON, internal refs or hidden output', () => {
    const html = render(
      row(
        'browser_read',
        { kind: 'text', scope: 'viewport', description: '核对登录状态' },
        '{"tabId":"internal-tab","snapshotId":"internal-snapshot","text":"private page"}'
      )
    );
    expect(html).toContain('核对登录状态');
    expect(html).toContain('lucide-globe');
    expect(html).not.toMatch(
      /browser_read|internal-tab|internal-snapshot|private page|viewport|tool-details/
    );
  });
  it('still shows real connection errors without expanding a JSON card', () => {
    const html = render(
      row('browser_navigate', { description: '进入登录页' }, 'ERR_CONNECTION_REFUSED', true)
    );
    expect(html).toContain('进入登录页');
    expect(html).toContain('ERR_CONNECTION_REFUSED');
    expect(html).toContain('text-destructive');
  });
  it('renders batch actions as a list of business steps and never the password value', () => {
    const html = render(
      row(
        'browser_act',
        {
          steps: [
            { action: 'click', target: '账号密码登录' },
            { action: 'fill', target: '密码', text: 'sensitive-password' },
          ],
        },
        '{"completed":2}'
      )
    );
    expect(html).toContain('账号密码登录');
    expect(html).toContain('密码');
    expect(html).not.toMatch(/sensitive-password|browser_act|completed|steps&quot;/);
  });
});
