import { parseHTML } from 'linkedom';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { ReplyHeader, TimelineRow } from '@/components/chat/TimelineRow';

vi.mock('@/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('@/stores/settings', () => ({
  useSettingsStore: (select: (state: object) => unknown) => select({}),
}));
vi.mock('@/stores/sessions', () => ({ useSessionsStore: () => null }));
vi.mock('@/components/chat/Markdown', () => ({ Markdown: () => null }));
vi.mock('@/components/chat/EditDiff', () => ({ EditDiff: () => null }));
vi.mock('@/components/chat/ReadFileView', () => ({ ReadFileView: () => null }));

it.each(['这个页面缺少返回啊 我一返回直接退出了', '/compact 保留这轮的结论'])(
  'keeps one explicit text bubble independent from image position: %s',
  (text) => {
    const html = renderToStaticMarkup(
      createElement(TimelineRow, {
        item: {
          kind: 'user',
          key: '0',
          text,
          images: [{ mimeType: 'image/png', data: 'fixture' }],
        },
      })
    );
    const { document } = parseHTML(html);
    const bubble = document.querySelector('[data-user-bubble]');
    expect(bubble).not.toBeNull();
    expect(document.querySelectorAll('[data-user-bubble]')).toHaveLength(1);
    expect(bubble?.querySelector('img')).toBeNull();
    expect(bubble?.textContent).toContain(text.includes('/compact') ? '保留这轮的结论' : text);
    expect(document.querySelector('[data-user-meta]')).not.toBeNull();
  }
);

it('exposes separate reply identity, model and time slots without depending on their order', () => {
  const html = renderToStaticMarkup(
    createElement(ReplyHeader, {
      model: 'gonshi/gpt-6.1-sol-long-provider-model-name',
      at: 1700000000000,
    })
  );
  const { document } = parseHTML(html);
  expect(document.querySelector('[data-reply-header] [data-reply-name]')?.textContent).toBe(
    'Collabra'
  );
  expect(document.querySelector('[data-reply-model]')?.textContent).toBe(
    'gonshi/gpt-6.1-sol-long-provider-model-name'
  );
  expect(document.querySelector('[data-reply-time]')?.textContent).toMatch(/^\d\d:\d\d$/);
});
