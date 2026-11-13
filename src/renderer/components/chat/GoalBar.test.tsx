import { parseHTML } from 'linkedom';
import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Conversation, SessionGoal } from '@/stores/sessions';
import { GoalBar } from './GoalBar';

const mock = vi.hoisted(() => ({
  state: {
    conversations: {} as Record<string, Partial<Conversation>>,
    pauseGoal: vi.fn(),
    resumeGoal: vi.fn(),
    clearGoal: vi.fn(),
    loadOlderHistory: vi.fn(),
  },
}));
vi.mock('@/stores/sessions', () => ({
  useSessionsStore: Object.assign(
    (selector: (state: typeof mock.state) => unknown) => selector(mock.state),
    {
      getState: () => mock.state,
    }
  ),
}));
vi.mock('@/i18n', () => ({
  useI18n: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      key.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values?.[name] ?? '')),
  }),
}));
vi.mock('@/components/ui/dialog', () => {
  const content = ({ children }: { children: ReactNode }) => createElement('div', null, children);
  return {
    Dialog: ({
      children,
      open,
      onOpenChange,
    }: {
      children: ReactNode;
      open: boolean;
      onOpenChange: (open: boolean) => void;
    }) =>
      open
        ? createElement(
            'div',
            { role: 'dialog' },
            children,
            createElement(
              'button',
              { type: 'button', onClick: () => onOpenChange(false), 'aria-label': 'Close' },
              'Close'
            )
          )
        : null,
    DialogContent: content,
    DialogHeader: content,
    DialogPanel: content,
    DialogTitle: content,
    DialogDescription: content,
  };
});
vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    variant: _variant,
    size: _size,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string; size?: string }) =>
    createElement('button', { ...props, type: 'button' }, children),
}));

const goal: SessionGoal = { text: '完成登录', status: 'active', autoTurns: 10, noProgressRuns: 0 };
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('GoalBar 步骤入口', () => {
  it.each(['active', 'paused', 'blocked'] as const)(
    '状态 %s 仍展示自动轮数及明确的步骤入口',
    (status) => {
      const html = renderToStaticMarkup(
        createElement(GoalBar, { conversationId: 'parent', goal: { ...goal, status } })
      );
      expect(html).toContain('Auto runs 10/25');
      expect(html).toContain('aria-label="View goal steps"');
      expect(html).not.toContain('role="dialog"');
    }
  );

  it('点击后能查看实际回复与工具路径、补读历史及关闭，不触发暂停', async () => {
    const dom = parseHTML('<html><body><div id="root"></div></body></html>');
    vi.stubGlobal('window', dom.window);
    vi.stubGlobal('document', dom.document);
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    mock.state.conversations.parent = {
      status: 'idle',
      historyBaseIndex: 80,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: '<goal-continuation>\nSession goal: 完成登录\nContinue working toward it.\n</goal-continuation>',
            },
          ],
        },
        {
          role: 'assistant',
          content: [
            { type: 'toolCall', id: 'read', name: 'read', arguments: { path: 'src/login.ts' } },
            { type: 'text', text: '已实现邮箱登录' },
          ],
        },
      ],
    };
    const container = dom.document.getElementById('root') as unknown as HTMLElement;
    const root = createRoot(container);
    try {
      await act(async () =>
        root.render(createElement(GoalBar, { conversationId: 'parent', goal }))
      );
      await act(async () =>
        container.querySelector<HTMLButtonElement>('button[aria-label="View goal steps"]')!.click()
      );
      const dialog = container.querySelector('[role="dialog"]')!;
      expect(dialog.textContent).toContain('Auto run 10');
      expect(dialog.textContent).toContain('已实现邮箱登录');
      expect(dialog.textContent).toContain('src/login.ts');
      expect(dialog.querySelectorAll('[data-goal-step]')).toHaveLength(1);
      expect(dialog.textContent).toContain('safety limit');
      await act(async () =>
        Array.from(dialog.querySelectorAll('button'))
          .find((button) => button.textContent === 'Load earlier runs')!
          .click()
      );
      expect(mock.state.loadOlderHistory).toHaveBeenCalledWith('parent');
      await act(async () => root.render(createElement(GoalBar, { conversationId: 'other', goal })));
      expect(container.querySelector('[role="dialog"]')).toBeNull();
      await act(async () =>
        root.render(createElement(GoalBar, { conversationId: 'parent', goal }))
      );
      await act(async () =>
        container.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!.click()
      );
      expect(container.querySelector('[role="dialog"]')).toBeNull();
      expect(mock.state.pauseGoal).not.toHaveBeenCalled();
      expect(mock.state.clearGoal).not.toHaveBeenCalled();
    } finally {
      await act(async () => root.unmount());
    }
  });
});
