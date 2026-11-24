import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ChatHostContext } from '@/components/chat/chatHost';
import { TimelineRow } from '@/components/chat/TimelineRow';
import { phoneChatHost } from './chatHost';

vi.mock('@/i18n', () => ({
  useI18n: () => ({
    t: (key: string, vars?: Record<string, string>) =>
      key.replace(/\{\{(\w+)\}\}/g, (_, name: string) => vars?.[name] ?? ''),
  }),
}));
vi.mock('@/stores/settings', () => ({
  useSettingsStore: (select: (state: object) => unknown) => select({}),
}));
vi.mock('@/stores/sessions', () => ({ useSessionsStore: () => null }));
vi.mock('@/components/chat/Markdown', () => ({ Markdown: () => null }));

const render = (text: string) =>
  renderToStaticMarkup(
    createElement(
      ChatHostContext.Provider,
      { value: phoneChatHost({ sessionId: 's' }) },
      createElement(TimelineRow, { item: { kind: 'user', key: '0', images: [], text } })
    )
  );

const groupTurn = [
  '<group-state>\n成员 A 正在忙\n</group-state>',
  '<group-message from="林" seq="3">看下手机端</group-message>',
  '<chat-reference id="c1" title="旧讨论" kind="direct">\nRecent messages\n[林]: hi\n</chat-reference>',
  '<routing-note>你被点名</routing-note>',
].join('\n');

describe('phoneChatHost', () => {
  it('普通会话的类似标签按原文显示', () => {
    expect(render(groupTurn)).toContain('&lt;group-message');
  });
});
