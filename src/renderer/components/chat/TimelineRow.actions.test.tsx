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

vi.mock('@/i18n', () => ({
  useI18n: () => ({
    t: (key: string, values?: Record<string, string | number>) =>
      key.replace(/\{\{(\w+)\}\}/g, (match, name: string) => String(values?.[name] ?? match)),
  }),
}));
vi.mock('@/stores/settings', () => ({
  useSettingsStore: (select: (state: object) => unknown) => select({}),
}));
vi.mock('@/stores/sessions', () => ({
  useSessionsStore: Object.assign((select: (value: object) => unknown) => select(state), {
    getState: () => state,
  }),
}));
vi.mock('./Markdown', () => ({
  Markdown: ({ text }: { text: string }) => <p data-markdown>{text}</p>,
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
  it.each(['普通用户正文', '/skill:a /skill:b 技能后的正文'])(
    '聊天排版只缩放用户正文，不连带缩放技能芯片或消息元信息：%s',
    async (text) => {
      await render({ kind: 'user', key: 'user-typography', text, images: [] });
      const body = container.querySelector<HTMLElement>('[data-user-body-typography]');
      expect(body).not.toBeNull();
      expect(body?.getAttribute('style')).toContain('--chat-body-scale');
      expect(body?.getAttribute('style')).toContain('--chat-body-weight');
      expect(body?.style.lineHeight).toContain('--chat-body-scale');
      expect(body?.textContent).toBe(text.startsWith('/skill:') ? '技能后的正文' : text);
      expect(body?.querySelector('svg')).toBeNull();
    }
  );

  it('子代理完成通知用 Markdown 展示报告，把用量放在底栏且不改原文', async () => {
    const report = '## 验证完成\n\n- **所有检查通过**';
    const text = [
      '<agent-notification>',
      'Subagent "测试" (agentId a, runId r) succeeded after 3.5s.',
      report,
      '<usage>subagent_tokens: 1300\ntool_uses: 2\nduration_ms: 3500</usage>',
      'Use subagent report with runId r for the full result.',
      '</agent-notification>',
    ].join('\n');
    const item: TimelineItem = { kind: 'user', key: 'notice', text, images: [] };
    await render(item);
    expect(container.querySelector('[data-subagent-report] [data-markdown]')?.textContent).toBe(
      report
    );
    const footer = container.querySelector('[data-subagent-usage]');
    expect(footer?.textContent).toContain('1.3K tokens');
    expect(footer?.textContent).toContain('2 tool calls');
    expect(footer?.textContent).toContain('3.5s');
    expect(container.textContent).not.toContain('Use subagent report');
    expect(container.textContent).not.toContain('<usage>');
    expect(item.text).toBe(text);
  });

  it('未知子代理通知维持原文展示，不误吞后台任务或普通消息', async () => {
    await render({
      kind: 'user',
      key: 'legacy-notice',
      text: '<agent-notification>旧版本通知：请保留全部内容</agent-notification>',
      images: [],
    });
    expect(container.textContent).toContain('旧版本通知：请保留全部内容');
    expect(container.querySelector('[data-subagent-report]')).toBeNull();
  });

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
