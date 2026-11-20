// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MessageTimeline } from './MessageTimeline';

vi.mock('@/i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string | number>) =>
      key.replace(/\{\{(\w+)\}\}/g, (_, token: string) => String(params?.[token] ?? '')),
    locale: 'en' as const,
  }),
}));

vi.mock('@/stores/settings', () => ({
  useSettingsStore: (select: (state: object) => unknown) =>
    select({
      autoCollapseTurns: false,
      collapseCompletedActivity: false,
      compactReadOnlyTools: false,
    }),
}));

vi.mock('./NavRail', () => ({ NavRail: () => null }));
vi.mock('./TimelineRow', () => ({
  isNestedRow: () => false,
  ReplyHeader: () => null,
  RetryTurnButton: () => null,
  TimelineRow: () => null,
}));
vi.mock('react-virtuoso', () => ({
  Virtuoso: () => null,
}));

describe('MessageTimeline empty welcome state', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it('项目空会话显示居中品牌标识、项目面包屑与四张可点击建议卡', async () => {
    const onSuggestion = vi.fn();
    await act(async () =>
      root.render(
        createElement(MessageTimeline, {
          items: [],
          busy: false,
          running: false,
          emptyTitle: 'EnsoCode',
          onSuggestion,
        })
      )
    );

    const panel = container.querySelector('[data-slot="welcome-panel"]');
    expect(panel).not.toBeNull();
    expect(panel?.querySelector('[data-slot="welcome-breadcrumb"]')?.textContent).toContain(
      'EnsoCode'
    );
    expect(panel?.querySelector('[data-slot="welcome-breadcrumb"]')?.textContent).toContain(
      'New conversation'
    );
    expect(panel?.querySelector('h2')?.textContent).toBe('Start a new task');
    expect(panel?.textContent).toContain(
      'Describe the work to complete in EnsoCode. Choose a model and approval mode below.'
    );

    const cards = Array.from(
      panel?.querySelectorAll<HTMLButtonElement>('[data-slot="welcome-suggestion"]') ?? []
    );
    expect(cards).toHaveLength(4);
    await act(async () => cards[0]?.click());
    expect(onSuggestion).toHaveBeenCalledWith(
      "Walk me through this project's structure: entry points, module layout and key dependencies."
    );
  });

  it('无建议卡入口的非项目空状态不误显示项目路径面包屑，并尊重空说明', async () => {
    await act(async () =>
      root.render(
        createElement(MessageTimeline, {
          items: [],
          busy: false,
          running: false,
          emptyTitle: 'No recorded output yet',
          emptyDescription: '',
        })
      )
    );

    const panel = container.querySelector('[data-slot="welcome-panel"]');
    expect(panel?.querySelector('[data-slot="welcome-breadcrumb"]')).toBeNull();
    expect(panel?.querySelector('h2')?.textContent).toBe('No recorded output yet');
    expect(panel?.querySelector('[data-slot="welcome-suggestion"]')).toBeNull();
    expect(panel?.textContent).not.toContain('Ask the agent…');
  });

  it('空会话恢复失败时展示错误与重试按钮', async () => {
    const onRetryResume = vi.fn();
    await act(async () =>
      root.render(
        createElement(MessageTimeline, {
          items: [],
          busy: false,
          running: false,
          emptyTitle: 'EnsoCode',
          error: 'Session failed to resume',
          onSuggestion: vi.fn(),
          onRetryResume,
        })
      )
    );

    const panel = container.querySelector('[data-slot="welcome-panel"]');
    expect(panel?.textContent).toContain('Session failed to resume');
    expect(panel?.querySelector('[data-slot="welcome-suggestion"]')).toBeNull();
    const retry = Array.from(panel?.querySelectorAll('button') ?? []).find(
      (btn) => btn.textContent === 'Retry resume'
    );
    expect(retry).toBeDefined();
    await act(async () => retry?.click());
    expect(onRetryResume).toHaveBeenCalledOnce();
  });
});
