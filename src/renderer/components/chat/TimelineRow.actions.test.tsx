import { parseHTML } from 'linkedom';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TimelineItem } from '@/stores/sessions/timeline';
import { ChatHostContext } from './chatHost';
import { TimelineRow } from './TimelineRow';

const harness = vi.hoisted(() => ({ copy: vi.fn(), fork: vi.fn() }));
const state = {
  activeId: 'c',
  conversations: {
    c: {
      id: 'c',
      started: true,
      status: 'idle',
      messages: [{ role: 'user' }, { role: 'assistant' }],
    },
  },
  forkFromMessage: harness.fork,
};

vi.mock('@/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('@/stores/settings', () => ({
  useSettingsStore: (select: (state: object) => unknown) => select({}),
}));
vi.mock('@/stores/sessions', () => ({
  useSessionsStore: Object.assign((select: (value: object) => unknown) => select(state), {
    getState: () => state,
  }),
}));
vi.mock('./Markdown', () => ({
  Markdown: ({ text }: { text: string }) => <p>{text}</p>,
  LocalFileTrigger: ({ path, children }: { path: string; children: ReactNode }) => (
    <span data-local-file={path}>{children}</span>
  ),
}));
vi.mock('./EditDiff', () => ({ EditDiff: () => null }));
vi.mock('./ReadFileView', () => ({ ReadFileView: () => null }));

let root: Root;
let container: HTMLElement;

beforeEach(() => {
  const dom = parseHTML('<html><body><div id="root"></div></body></html>');
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', dom.document);
  vi.stubGlobal('navigator', { clipboard: { writeText: harness.copy } });
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const element = dom.document.getElementById('root');
  if (!element) throw new Error('Missing test root');
  container = element;
  root = createRoot(container);
  harness.copy.mockReset().mockResolvedValue(undefined);
  harness.fork.mockReset();
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const reply = (overrides: Partial<Extract<TimelineItem, { kind: 'text' }>> = {}): TimelineItem => ({
  kind: 'text',
  key: '1-0',
  text: '先读取组件规范，再继续修改。',
  streaming: false,
  timestamp: 1726700000000,
  turnDurationMs: 4600,
  perf: { runMs: 4600, ttftMs: 3500, tps: 15 },
  ...overrides,
});

const render = (item: TimelineItem) =>
  act(async () => root.render(createElement(TimelineRow, { item })));

describe('回复正文的紧凑操作区', () => {
  it.each([
    [
      '请看 @"C:\\workspace\\中文目录\\a b.pdf" 再总结',
      'C:\\workspace\\中文目录\\a b.pdf',
      'a b.pdf',
    ],
    ['请看\n\n@C:\\workspace\\中文目录\\a.pdf', 'C:\\workspace\\中文目录\\a.pdf', 'a.pdf'],
    ['请看 @src/components/ 再总结', 'src/components/', 'components'],
  ])('新旧文件卡片接入共用 trigger，保留 Proma 气泡：%s', async (text, path, label) => {
    await render({ kind: 'user', key: 'user-mention', text, images: [], timestamp: undefined });
    const trigger = container.querySelector('[data-local-file]');
    expect(trigger?.getAttribute('data-local-file')).toBe(path);
    expect(trigger?.textContent).toBe(label);
    expect(container.innerHTML).toContain('max-w-[86%] rounded-[6px] bg-muted');
  });
  it('不在正文下方显示时间、耗时、TTFT 或生成速度', async () => {
    await render(reply());
    expect(container.textContent).toBe('先读取组件规范，再继续修改。');
  });

  it('保留复制操作；流式生成时不显示操作区', async () => {
    vi.useFakeTimers();
    await render(reply());
    const button = container.querySelector<HTMLButtonElement>('button[title="Copy"]');
    expect(button).not.toBeNull();
    await act(async () => button?.click());
    expect(harness.copy).toHaveBeenCalledWith('先读取组件规范，再继续修改。');
    await act(async () => vi.runOnlyPendingTimers());
    await render(reply({ streaming: true }));
    expect(container.querySelector('button')).toBeNull();
  });

  it('只在轮末保留图标分叉入口，不增加常驻标签', async () => {
    await render(reply());
    expect(container.querySelector('button[aria-label="Conversation branch"]')).toBeNull();
    await render(reply({ turnEnd: true }));
    const button = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Conversation branch"]'
    );
    expect(button).not.toBeNull();
    expect(button?.textContent).toBe('');
    await act(async () => button?.click());
    expect(harness.fork).toHaveBeenCalledWith('c', 0);
  });

  it('只读宿主仍隐藏分叉入口', async () => {
    await act(async () =>
      root.render(
        createElement(
          ChatHostContext.Provider,
          { value: { sessionId: 'remote', canRewind: false, canRetry: false } },
          createElement(TimelineRow, { item: reply({ turnEnd: true }) })
        )
      )
    );
    expect(container.querySelector('button[aria-label="Conversation branch"]')).toBeNull();
    expect(container.querySelector('button[title="Copy"]')).not.toBeNull();
  });
});
