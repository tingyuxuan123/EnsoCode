import type {
  BackgroundTaskInfo,
  SubagentActivity,
  SubagentInfo,
  TodoItem,
} from '@shared/types/agent';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { SubagentDirectoryEntry } from '@/lib/subagentTargets';
import { AgentActivityView, TaskBar } from './TaskBar';

const directory = vi.hoisted(() => ({ entries: [] as SubagentDirectoryEntry[] }));
vi.mock('@/i18n', () => ({
  useI18n: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      key.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values?.[name] ?? '')),
  }),
}));
vi.mock('./Markdown', () => ({ Markdown: ({ text }: { text: string }) => text }));
vi.mock('@/hooks/useSubagentDirectory', () => ({
  useSubagentDirectory: () => directory.entries,
}));
vi.mock('@/stores/sessions', () => ({ useSessionsStore: { getState: vi.fn() } }));
vi.mock('@/lib/sidePanelDock', () => ({
  addSidePanelSubagent: vi.fn(),
  addSidePanelSubagentDirectory: vi.fn(),
}));
vi.mock('@/stores/settings', () => ({
  useSettingsStore: (select: (state: { virtualModels: never[] }) => unknown) =>
    select({ virtualModels: [] }),
}));

const renderActivity = (activity: SubagentActivity): string =>
  renderToStaticMarkup(createElement(AgentActivityView, { activity }));

const task = (status: BackgroundTaskInfo['status']): BackgroundTaskInfo => ({
  taskId: 'task-1',
  command: 'pnpm dev',
  status,
  tail: '',
  startedAt: 0,
});

const agent = (status: SubagentInfo['status']): SubagentInfo => ({
  id: 'agent-1',
  description: 'scan repo',
  status,
  steps: 0,
  currentActivity: '',
  startedAt: 0,
});

const renderBar = (
  sessionId: string,
  tasks: BackgroundTaskInfo[],
  subagents: SubagentInfo[],
  readOnly?: boolean,
  todos?: { id: string; todos: TodoItem[] } | null
) => renderToStaticMarkup(createElement(TaskBar, { sessionId, tasks, subagents, readOnly, todos }));

const dirEntry = (overrides: Partial<SubagentDirectoryEntry> = {}): SubagentDirectoryEntry => ({
  childConversationId: 'child',
  agentId: 'agent',
  title: 'Reviewer',
  mode: 'task',
  origin: 'agent-tool',
  status: 'running',
  createdAt: 1,
  ended: false,
  closed: false,
  canOpenConversation: true,
  ...overrides,
});

describe('TaskBar 输入框上方的固定按钮条', () => {
  it('没有任何后台命令和子代理时不渲染', () => {
    directory.entries = [];
    expect(renderBar('empty', [], [])).toBe('');
  });

  it('任务再多也只占一行按钮，不再逐任务铺开行', () => {
    directory.entries = [];
    const html = renderBar('many', [task('running'), { ...task('running'), taskId: 't2' }], []);
    expect(html).toContain('data-task-dock-button="bash"');
    expect(html).toContain('Background Bash');
    expect(html).not.toContain('pnpm dev');
  });

  it('按钮直接显示运行数，失败给红点', () => {
    directory.entries = [];
    const html = renderBar('state', [task('running'), { ...task('failed'), taskId: 't2' }], []);
    expect(html).toMatch(/data-task-dock-button="bash"[^>]*>.*Background Bash.*·.*1/s);
    expect(html).toContain('data-task-dock-failed');
  });

  it('重启后恢复的已结束任务也保留入口，可回看', () => {
    directory.entries = [];
    expect(renderBar('restored', [task('done')], [])).toContain('data-task-dock-button="bash"');
  });

  it('子代理按钮来自持久目录：全部结束后仍保留（B 方案）', () => {
    directory.entries = [dirEntry({ status: 'succeeded', ended: true })];
    const html = renderBar('agents', [], [agent('done')]);
    expect(html).toContain('data-task-dock-button="agent"');
    expect(html).toContain('Background Agent');
    expect(html).not.toContain('data-task-dock-button="bash"');
  });

  it('任务清单也是同一排的按钮：显示 当前进度 已完成/总数，不再单独占一条', () => {
    directory.entries = [];
    const html = renderBar('todos', [task('running')], [], false, {
      id: 'list-1',
      todos: [
        { content: '写测试', status: 'completed' },
        { content: '实现', status: 'in_progress' },
        { content: '验收', status: 'pending' },
      ],
    });
    expect(html).toContain('data-task-dock-button="todo"');
    expect(html).toMatch(/data-task-dock-button="todo"[^>]*>.*Current progress.*1\/3/s);
    expect(html).not.toContain('写测试');
    expect(html.indexOf('data-task-dock-button="bash"')).toBeLessThan(
      html.indexOf('data-task-dock-button="todo"')
    );
  });

  it('只有任务清单时也显示按钮条', () => {
    directory.entries = [];
    const html = renderBar('only-todos', [], [], false, {
      id: 'list-2',
      todos: [{ content: 'x', status: 'pending' }],
    });
    expect(html).toContain('data-task-dock-button="todo"');
  });
});

describe('AgentActivityView', () => {
  it('工具默认折叠，只在紧凑行显示名称、路径摘要和可访问状态', () => {
    const html = renderActivity({
      id: 'read-1',
      type: 'tool',
      toolName: 'read',
      argumentsText: '{\n  "path": "src/renderer/App.tsx",\n  "offset": 10\n}',
      outputText: 'FULL_RESULT_ONLY_WHEN_EXPANDED',
      status: 'done',
    });

    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-controls="subagent-tool-read-1"');
    expect(html).toContain('aria-label="done"');
    expect(html).toContain('>read<');
    expect(html).toContain('src/renderer/App.tsx');
    expect(html).not.toContain('&quot;path&quot;');
    expect(html).not.toContain('FULL_RESULT_ONLY_WHEN_EXPANDED');
    expect(html).not.toContain('Arguments');
    expect(html).not.toContain('Result');
  });

  it('运行中的搜索工具显示 pattern 摘要和状态语义', () => {
    const html = renderActivity({
      id: 'grep-1',
      type: 'tool',
      toolName: 'grep',
      argumentsText: '{"path":"src","pattern":"AgentActivityView"}',
      status: 'running',
    });

    expect(html).toContain('AgentActivityView');
    expect(html).toContain('aria-label="running"');
    expect(html).toContain('title="AgentActivityView"');
  });

  it('MCP 工具折叠行只显示工具名，不带 mcp__server__ 前缀', () => {
    const html = renderActivity({
      id: 'mcp-1',
      type: 'tool',
      toolName: 'mcp__fast-context__fast_context_search',
      argumentsText: '{"query":"tool row"}',
      status: 'done',
    });

    expect(html).toContain('>fast_context_search<');
    expect(html).not.toContain('mcp__fast-context');
  });
});
