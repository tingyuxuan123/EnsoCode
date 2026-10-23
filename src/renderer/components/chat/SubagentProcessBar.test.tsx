import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SubagentDirectoryEntry } from '@/lib/subagentTargets';
import { SubagentProcessBar } from './SubagentProcessBar';

const mock = vi.hoisted(() => ({ entries: [] as SubagentDirectoryEntry[] }));
vi.mock('@/hooks/useSubagentDirectory', () => ({ useSubagentDirectory: () => mock.entries }));
vi.mock('@/stores/sessions', () => ({ useSessionsStore: { getState: vi.fn() } }));
vi.mock('@/lib/sidePanelDock', () => ({
  addSidePanelSubagent: vi.fn(),
  addSidePanelSubagentDirectory: vi.fn(),
}));
vi.mock('@/i18n', () => ({
  useI18n: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      key.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values?.[name] ?? '')),
  }),
}));

const entry = (overrides: Partial<SubagentDirectoryEntry> = {}): SubagentDirectoryEntry => ({
  childConversationId: 'child',
  agentId: 'agent',
  title: 'Scout',
  mode: 'coworker',
  origin: 'manual',
  status: 'waiting',
  createdAt: 1,
  ended: false,
  closed: false,
  canOpenConversation: true,
  ...overrides,
});
const render = () =>
  renderToStaticMarkup(createElement(SubagentProcessBar, { sessionId: 'parent' }));
beforeEach(() => {
  mock.entries = [];
});

describe('agent process shortcuts (SSR only)', () => {
  it('待命协作者不冒充正在运行的任务，目录入口统一为 Agents', () => {
    mock.entries = [entry()];
    const html = render();
    expect(html).toContain('Agents');
    expect(html).not.toContain('running');
    expect(html).not.toContain('data-subagent-open');
  });

  it('仅活跃 Run 计数并明确区分任务与协作者', () => {
    mock.entries = [
      entry({
        childConversationId: 'task',
        agentId: 'task-agent',
        mode: 'task',
        status: 'running',
      }),
      entry({ status: 'validating' }),
      entry({ childConversationId: 'idle' }),
    ];
    const html = render();
    expect(html).toContain('2 running');
    expect(html).toContain('One-off task');
    expect(html).toContain('Persistent collaborator');
    expect(html.match(/data-subagent-open=/g)).toHaveLength(2);
    expect(html).toContain('View process');
  });

  it('历史实例即使有迟到 running 状态也不列为运行中', () => {
    mock.entries = [entry({ status: 'running', closed: true, ended: true })];
    expect(render()).not.toContain('data-subagent-open');
  });
});
