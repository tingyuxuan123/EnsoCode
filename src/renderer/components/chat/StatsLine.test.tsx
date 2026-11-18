import { parseHTML } from 'linkedom';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyProjection } from '@/stores/sessions/reducer';
import { StatsLine } from './StatsLine';

const harness = vi.hoisted(() => ({
  conversation: {} as object,
  segments: undefined as unknown,
  projects: [] as object[],
  statuses: {} as Record<string, { exists: boolean; dirty: boolean; ahead: number }>,
}));
vi.mock('@/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('@/stores/sessions', () => ({
  useSessionsStore: (select: (state: object) => unknown) =>
    select({
      conversations: { fixture: harness.conversation },
      worktreeStatuses: harness.statuses,
    }),
}));
vi.mock('@/stores/settings', () => ({
  useSettingsStore: (select: (state: object) => unknown) =>
    select({
      virtualModels: [],
      projects: harness.projects,
      statusLineSegments: harness.segments,
    }),
}));
vi.mock('@/stores/modelDirectory/useProviders', () => ({ useMaterializedProviders: () => [] }));
vi.mock('./ContextInspector', () => ({ ContextInspector: () => null }));
vi.mock('./StatusLineSettings', () => ({ StatusLineSettings: () => null }));
vi.mock('@/hooks/useAccountUsage', () => ({
  fetchAccountUsage: vi.fn(),
  USAGE_CACHE_TTL_MS: 60_000,
  usageCache: new Map(),
}));

const fixture = () => ({
  ...emptyProjection,
  id: 'fixture',
  projectId: '',
  title: '',
  started: true,
  spawning: false,
  createdAt: 1,
  lastModelId: 'test-model',
  occupancy: { used: 32_000, contextWindow: 200_000 },
  messages: [
    {
      id: 'assistant',
      role: 'assistant',
      content: [],
      timestamp: 1,
      usage: { input: 784_000, output: 28_000, cacheRead: 4_116_000, cacheWrite: 0 },
    },
  ],
});
const render = () =>
  parseHTML(renderToStaticMarkup(createElement(StatsLine, { conversationId: 'fixture' }))).document;
const segments = (document: ReturnType<typeof render>) => [
  ...document.querySelectorAll('[data-status-line-segment]'),
];

beforeEach(() => {
  harness.conversation = fixture();
  harness.segments = undefined;
  harness.projects = [];
  harness.statuses = {};
});

describe('输入框下方的会话用量摘要', () => {
  it('默认三组展示真实用量、缓存和上下文，不重复模型名称', () => {
    const document = render();
    expect(segments(document).map((e) => e.getAttribute('data-status-line-segment'))).toEqual([
      'tokens',
      'cache',
      'context',
    ]);
    expect(document.querySelector('[data-slot="stats-line"]')?.textContent).toContain('↑4.9M ↓28K');
    expect(document.querySelector('[data-slot="stats-line"]')?.textContent).toContain('84%');
    expect(document.querySelector('[data-slot="stats-line"]')?.textContent).toContain('16%');
    expect(document.querySelector('[data-slot="stats-line"]')?.textContent).not.toContain(
      'test-model'
    );
  });

  it('用户启用的项目保序且稳定显示，不随悬停增加或挤动其它项目', () => {
    harness.segments = ['model', 'sessionTime', 'cache', 'tokens', 'context'];
    const nodes = segments(render());
    expect(nodes.map((e) => e.getAttribute('data-status-line-segment'))).toEqual(harness.segments);
    expect(nodes.every((e) => !e.classList.contains('hidden'))).toBe(true);
    expect(nodes.some((e) => /group-(hover|focus-within)/.test(e.className))).toBe(false);
  });

  it('缓存命中率高不是资源耗尽，不显示上下文的警示色', () => {
    const conversation = fixture();
    harness.conversation = {
      ...conversation,
      messages: [
        {
          ...conversation.messages[0],
          usage: { input: 0, output: 28_000, cacheRead: 4_900_000, cacheWrite: 0 },
        },
      ],
    };
    const document = render();
    const cache = document.querySelector('[data-status-line-segment="cache"]');
    expect(cache?.textContent).toBe('100%');
    expect(cache?.querySelector('.text-destructive')).toBeNull();
  });

  it('上下文窗口未知时保留未知标记，不编造百分比或进度', () => {
    harness.conversation = { ...fixture(), occupancy: { used: 32_000 } };
    const document = render();
    expect(document.querySelector('[data-status-line-segment="context"]')?.textContent).toBe(
      '32K·?'
    );
    expect(document.querySelector('[data-slot="context-meter"]')).toBeNull();
  });

  it('新会话无用量时不伪造数据，全关后仍能打开显示设置', () => {
    harness.conversation = { ...fixture(), messages: [], occupancy: undefined };
    expect(segments(render())).toHaveLength(0);
    harness.segments = [];
    expect(render().querySelector('[aria-label="Status line settings"]')).not.toBeNull();
  });
});

describe('托盘左侧的位置', () => {
  const trayText = (document: ReturnType<typeof render>) =>
    document.querySelector('[data-slot="stats-line-place"]')?.textContent ?? '';

  it('是卡片下方独立的一行，不铺底色、也不并进输入框卡片', () => {
    // 以前 StatsLine 就是 composer 之后的自立一行；位置和分组保留，但不该自己长一块灰底。
    harness.projects = [{ id: 'p1', name: 'EnsoCode', path: '/code/EnsoCode', kind: 'local' }];
    harness.conversation = { ...fixture(), projectId: 'p1' };
    const tray = render().querySelector('[data-slot="stats-line"]');
    expect(tray?.className).not.toContain('bg-muted');
    expect(tray?.className).not.toContain('rounded-b-[6px]');
    // 位置组和用量组仍是两个并列分组，结构不变。
    expect(tray?.querySelector('[data-slot="stats-line-place"]')).not.toBeNull();
    expect(tray?.querySelector('[data-slot="stats-line-tray"]')).not.toBeNull();
  });

  it('本地项目只显示项目名：分支由工作区选择器负责，这里不重复', () => {
    harness.projects = [{ id: 'p1', name: 'EnsoCode', path: '/code/EnsoCode', kind: 'local' }];
    harness.conversation = {
      ...fixture(),
      projectId: 'p1',
      worktree: { branch: 'main' } as never,
    };
    harness.statuses = { fixture: { exists: true, dirty: false, ahead: 2 } };
    const document = render();
    expect(trayText(document)).toContain('EnsoCode');
    expect(trayText(document)).not.toContain('main');
    expect(trayText(document)).not.toContain('↑');
    expect(trayText(document)).not.toContain('This Mac');
  });

  it('SSH 项目才提示远端主机，否则不知道自己改的是哪台机器', () => {
    harness.projects = [
      {
        id: 'p1',
        name: 'api',
        path: '/srv/api',
        kind: 'ssh',
        sshConnectionName: 'Prod Box',
      },
    ];
    harness.conversation = { ...fixture(), projectId: 'p1' };
    const document = render();
    expect(trayText(document)).toContain('Prod Box');
    expect(trayText(document)).toContain('api');
  });

  it('临时会话不把承载目录冒充成项目名', () => {
    harness.projects = [{ id: 'p1', name: 'Temporary chats', path: '/tmp/x', kind: 'scratch' }];
    harness.conversation = { ...fixture(), projectId: 'p1' };
    const document = render();
    expect(trayText(document)).toContain('Temporary chats');
    expect(trayText(document)).not.toContain('/tmp/x');
  });

  it('没有分支时不画空箭头', () => {
    harness.projects = [{ id: 'p1', name: 'EnsoCode', path: '/code/EnsoCode', kind: 'local' }];
    harness.conversation = { ...fixture(), projectId: 'p1' };
    const document = render();
    expect(trayText(document)).toContain('EnsoCode');
    expect(trayText(document)).not.toContain('↑');
  });
});
