/** @vitest-environment happy-dom */
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { ApprovalBar } from '@/components/chat/ApprovalBar';
import { AskBar } from '@/components/chat/AskBar';

vi.mock('@/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
afterEach(() => {
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

it('phone choices are selected first and only sent by the answer action', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.body.appendChild(document.createElement('div'));
  const root = createRoot(host);
  const answer = vi.fn();
  await act(async () =>
    root.render(
      createElement(AskBar, {
        appearance: 'phone',
        asks: [{ requestId: 'q', question: '选哪种？', options: ['最小修复', '统一事件'] }],
        onAnswer: answer,
        autoFocus: false,
      })
    )
  );
  const option = host.querySelector<HTMLButtonElement>('[role="radio"]');
  expect(option).not.toBeNull();
  await act(async () => option?.click());
  expect(answer).not.toHaveBeenCalled();
  expect(option?.getAttribute('aria-checked')).toBe('true');
  await act(async () => host.querySelector<HTMLButtonElement>('[data-ask-submit]')?.click());
  expect(answer).toHaveBeenCalledExactlyOnceWith('q', '最小修复');
  await act(async () => root.unmount());
});

it('protected phone approvals retain a single allow decision and never session-wide permission', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.body.appendChild(document.createElement('div'));
  const root = createRoot(host);
  const respond = vi.fn();
  await act(async () =>
    root.render(
      createElement(ApprovalBar, {
        appearance: 'phone',
        approvals: [
          { requestId: 'a', tool: 'bash', kind: 'command', summary: '', protected: 'delete' },
        ],
        onRespond: respond,
      })
    )
  );
  expect(host.querySelector('[data-approval-decision="allowSession"]')).toBeNull();
  const allow = host.querySelector<HTMLButtonElement>('[data-approval-decision="allow"]');
  expect(allow).not.toBeNull();
  await act(async () => allow?.click());
  expect(respond).toHaveBeenCalledExactlyOnceWith('a', 'allow');
  await act(async () => root.unmount());
});

it('does not send a previous free-text draft into a new selection-only request', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.body.appendChild(document.createElement('div'));
  const root = createRoot(host);
  const answer = vi.fn();
  await act(async () =>
    root.render(
      createElement(AskBar, {
        appearance: 'phone',
        asks: [{ requestId: 'old', question: '自由回答' }],
        onAnswer: answer,
        autoFocus: false,
      })
    )
  );
  const input = host.querySelector<HTMLInputElement>('input');
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
      input,
      '旧草稿'
    );
    input?.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(host.querySelector<HTMLButtonElement>('[data-ask-submit]')?.disabled).toBe(false);
  await act(async () =>
    root.render(
      createElement(AskBar, {
        appearance: 'phone',
        asks: [
          { requestId: 'new', question: '只选一项', selectionOnly: true, options: ['新选项'] },
        ],
        onAnswer: answer,
        autoFocus: false,
      })
    )
  );
  expect(host.querySelector<HTMLButtonElement>('[data-ask-submit]')?.disabled).toBe(true);
  await act(async () => host.querySelector<HTMLButtonElement>('[role="radio"]')?.click());
  await act(async () => host.querySelector<HTMLButtonElement>('[data-ask-submit]')?.click());
  expect(answer).toHaveBeenCalledExactlyOnceWith('new', '新选项');
  await act(async () => root.unmount());
});
