// @vitest-environment happy-dom
import type { BackgroundTaskInfo, SubagentInfo, TodoItem } from '@shared/types/agent';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { agentDockSummary, bashDockSummary, PhoneTaskBar, todoDockState } from './PhoneTaskBar';
import { usePhoneBack } from './usePhoneBack';

// 只校对 hook 的 active 入参（不可见 guard 会吞掉系统返回），不改变其余行为
vi.mock('./usePhoneBack', () => ({ usePhoneBack: vi.fn() }));
const back = vi.mocked(usePhoneBack);

// 复用桌面 Markdown：PWA 运行时用桩替换 store / i18n，测试里做同样的最小替换
vi.mock('@/stores/settings', () => {
  const store = Object.assign(
    (selector: (state: Record<string, unknown>) => unknown) => selector({}),
    {
      getState: () => ({}),
      subscribe: () => () => {},
    }
  );
  return { useSettingsStore: store };
});
vi.mock('@/stores/sessions', () => {
  const store = Object.assign(
    (selector: (state: Record<string, unknown>) => unknown) => selector({}),
    {
      getState: () => ({}),
      subscribe: () => () => {},
    }
  );
  return { useSessionsStore: store };
});
vi.mock('@/i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
  useTranslation: () => (key: string) => key,
}));

// React 19：测试里用 act 包裹状态更新，避免“environment not configured”告警
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const tasks: BackgroundTaskInfo[] = [
  {
    taskId: 't1',
    command: 'pnpm test -- sessionReducer',
    status: 'running',
    tail: 'RUN v4',
    startedAt: 1,
  },
  {
    taskId: 't2',
    command: 'pnpm build',
    status: 'failed',
    tail: 'boom',
    startedAt: 1,
    exitCode: 1,
  },
];

const agents: SubagentInfo[] = [
  {
    id: 'a1',
    description: '补验远程历史',
    status: 'running',
    steps: 3,
    currentActivity: 'read',
    startedAt: 1,
    activityLog: ['读文件'],
  },
];

const todos: TodoItem[] = [
  { content: '改 reducer', status: 'completed' },
  { content: '补测试', status: 'in_progress' },
  { content: '跑回归', status: 'pending' },
];

let host: HTMLDivElement | null = null;
let root: ReturnType<typeof createRoot> | null = null;
const stopTask = vi.fn(() => Promise.resolve({ ok: true as const }));
const stopSubagent = vi.fn(() => Promise.resolve({ ok: true as const }));

const mount = async (props: Partial<Parameters<typeof PhoneTaskBar>[0]> = {}) => {
  if (root) await act(async () => root?.unmount());
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(
      createElement(PhoneTaskBar, {
        sessionId: 's1',
        tasks,
        subagents: agents,
        todos: { id: 's1', todos },
        ...props,
      })
    );
  });
  return root;
};

const click = async (selector: string) => {
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) throw new Error(`missing ${selector}`);
  await act(async () => el.click());
  return el;
};

const rerender = async (props: Partial<Parameters<typeof PhoneTaskBar>[0]>) => {
  await act(async () => {
    root?.render(
      createElement(PhoneTaskBar, {
        sessionId: 's1',
        tasks,
        subagents: agents,
        todos: { id: 's1', todos },
        ...props,
      })
    );
  });
};

const clickByText = async (text: string) => {
  const el = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes(text));
  if (!el) throw new Error(`missing button ${text}`);
  await act(async () => el.click());
  return el;
};

beforeEach(() => {
  stopTask.mockClear();
  stopSubagent.mockClear();
  (window as { electronAPI?: unknown }).electronAPI = { agent: { stopTask, stopSubagent } };
});
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  delete (window as { electronAPI?: unknown }).electronAPI;
  host?.remove();
  host = null;
});

describe('PhoneTaskBar summary', () => {
  it('命令与 Agent 分开统计运行/失败，全空时整条隐藏', () => {
    expect(bashDockSummary(tasks)).toEqual({ total: 2, running: 1, failed: 1 });
    expect(agentDockSummary(agents)).toEqual({ total: 1, running: 1, failed: 0 });
    expect(bashDockSummary([])).toBeNull();
    expect(agentDockSummary([])).toBeNull();
    expect(todoDockState(null)).toBeNull();
    expect(todoDockState({ id: 'x', todos })).toEqual({ done: 1, total: 3, active: true });
  });

  it('浅层渲染就有三枚入口，进度带完成数，不越界（单行可换行容器）', async () => {
    await mount();
    expect(host!.textContent).toContain('后台命令');
    expect(host!.textContent).toContain('后台 Agent');
    expect(host!.textContent).toContain('1/3');
    expect(host!.querySelector('[data-phone-task-bar]')?.className).toContain('flex-wrap');
  });
});

describe('PhoneTaskBar sheet', () => {
  it('点命令入口在底部面板展示真实命令，展开可看全文输出', async () => {
    await mount();
    await clickByText('后台命令');
    expect(document.body.textContent).toContain('pnpm test -- sessionReducer');
    expect(document.body.textContent).toContain('exit 1');
    await click('[aria-label="展开 pnpm build"]');
    expect(document.body.textContent).toContain('boom');
  });

  it('运行中的命令可停止，回传 sessionId + taskId', async () => {
    await mount();
    await clickByText('后台命令');
    await click('[aria-label="停止 pnpm test -- sessionReducer"]');
    expect(stopTask).toHaveBeenCalledWith('s1', 't1');
  });

  it('只读或离线时不给停止入口', async () => {
    await mount({ readOnly: true });
    await clickByText('后台命令');
    expect(document.querySelector('[aria-label="停止 pnpm test -- sessionReducer"]')).toBeNull();
    await mount({ online: false });
    await clickByText('后台命令');
    expect(document.querySelector('[aria-label="停止 pnpm test -- sessionReducer"]')).toBeNull();
  });

  it('Agent 入口展示状态并可取消', async () => {
    await mount();
    await clickByText('后台 Agent');
    expect(document.body.textContent).toContain('补验远程历史');
    await click('[aria-label="取消 Agent 补验远程历史"]');
    expect(stopSubagent).toHaveBeenCalledWith('s1', 'a1');
  });

  it('进度入口展示完成数与完整清单', async () => {
    await mount();
    await clickByText('当前进度');
    expect(document.body.textContent).toContain('改 reducer');
    expect(document.body.textContent).toContain('跑回归');
    expect(document.body.textContent).toContain('1/3');
  });

  it('面板头部有明确可见的关闭按钮，点了就收起', async () => {
    await mount();
    await clickByText('后台命令');
    const closeButton = document.querySelector('[aria-label="关闭后台面板"]');
    expect(closeButton).not.toBeNull();
    await act(async () => {
      (closeButton as HTMLElement).click();
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
    expect(document.querySelector('[aria-label="关闭后台面板"]')).toBeNull();
  });

  it('Agent 工具项保留已下发的参数文本', async () => {
    await mount({
      subagents: [
        {
          id: 'a1',
          description: '补验远程历史',
          status: 'running',
          steps: 2,
          currentActivity: 'read',
          startedAt: 1,
          activities: [
            {
              id: 'act1',
              type: 'tool',
              toolName: 'read',
              argumentsText: '{"path":"src/reducer.ts"}',
              status: 'done',
              outputText: '文件内容',
            },
          ],
        },
      ],
    });
    await clickByText('后台 Agent');
    await click('[aria-label="展开 Agent 补验远程历史"]');
    expect(document.body.textContent).toContain('src/reducer.ts');
    expect(document.body.textContent).toContain('文件内容');
  });

  it('结果报告走 Markdown，链接可点而不是纯文本', async () => {
    await mount({
      subagents: [
        {
          id: 'a1',
          description: '补验远程历史',
          status: 'done',
          steps: 2,
          currentActivity: 'write',
          startedAt: 1,
          resultText: '都跑完了，证据见 [回归报告](https://example.com/evidence)。',
        },
      ],
    });
    await clickByText('后台 Agent');
    await click('[aria-label="展开 Agent 补验远程历史"]');
    const link = document.querySelector('a[href="https://example.com/evidence"]');
    expect(link?.textContent).toBe('回归报告');
  });

  it('数据归零后面板消失，返回守卫不再 active', async () => {
    await mount();
    await clickByText('后台命令');
    expect(back.mock.lastCall?.[0]).toBe(true);
    await rerender({ tasks: [], subagents: [], todos: null });
    expect(back.mock.lastCall?.[0]).toBe(false);
    expect(document.querySelector('[aria-label="关闭后台面板"]')).toBeNull();
  });

  it('打开面板不自动抢焦点', async () => {
    await mount();
    await clickByText('后台命令');
    expect(document.activeElement === document.body || document.activeElement === null).toBe(true);
  });
});
