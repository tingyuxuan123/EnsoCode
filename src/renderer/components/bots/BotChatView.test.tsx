// @vitest-environment happy-dom
import type { BotChat, BotProfile, Delegation } from '@shared/types/bot';
import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { BotDesignTarget } from '@/features/design/host/bot-canvas';
import { BotChatView } from './BotChatView';

const h = vi.hoisted(() => ({
  state: {
    bots: [] as BotProfile[],
    chats: [],
    sessions: {} as Record<string, unknown>,
    queue: [],
    delegations: [] as Delegation[],
    timelines: {},
    runtime: {},
    reads: {},
    tasks: {},
    browserTabs: {},
    panelOpen: true,
    panelTab: 'info',
    panelWidth: 400,
    markRead: vi.fn(),
    clearFocus: vi.fn(),
    loadLatest: vi.fn(),
    refreshRuntime: vi.fn(),
    setPanelTab: vi.fn(),
    trackSession: vi.fn(),
  },
  canvas: { target: null as BotDesignTarget | null, workspaceKey: null as string | null },
  settings: {
    designEnabled: true,
    skills: [],
    virtualModels: [],
    voiceInputEnabled: false,
    projects: [{ id: 'p', path: '/work' }],
  },
}));
vi.mock('@/stores/bots', () => ({
  useBotsStore: Object.assign((select: (s: unknown) => unknown) => select(h.state), {
    getState: () => h.state,
  }),
}));
vi.mock('@/stores/settings', () => ({
  useSettingsStore: (select: (s: unknown) => unknown) => select(h.settings),
}));
vi.mock('@/features/design/host/bot-canvas', () => ({
  useBotDesignCanvas: (select: (s: unknown) => unknown) => select(h.canvas),
}));
vi.mock('@/features/design/host/translation', () => ({
  useTranslation: () => ({ t: () => '设计稿' }),
}));
vi.mock('@/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('@/stores/modelDirectory/useProviders', () => ({ useMaterializedProviders: () => [] }));
vi.mock('@/hooks/useSpeechStatus', () => ({ useSpeechStatus: () => ({}) }));
vi.mock('@/lib/voiceSession', () => ({ startDesktopVoiceSession: vi.fn() }));
vi.mock('@/stores/bots/selectors', () => ({
  chatSummary: () => ({ key: 'empty', running: false, queued: false }),
  pendingItems: () => [],
}));
vi.mock('@/stores/bots/unread', () => ({ groupReadMark: () => undefined }));
vi.mock('@/stores/bots/delegations', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/stores/bots/delegations')>()),
  activeDelegations: () => [],
  pendingOwners: () => new Map(),
}));
vi.mock('framer-motion', () => ({
  motion: {
    aside: ({ children, ref }: { children: ReactNode; ref: React.Ref<HTMLElement> }) =>
      createElement('aside', { ref }, children),
  },
}));
vi.mock('@/components/chat/ApprovalBar', () => ({ ApprovalBar: () => null }));
vi.mock('@/components/chat/ApprovalModePicker', () => ({ APPROVAL_MODE_META: {} }));
vi.mock('@/components/chat/AskBar', () => ({ AskBar: () => null }));
vi.mock('@/components/chat/MessageTimeline', () => ({ CHAT_COL: '' }));
vi.mock('@/components/chat/ResizeHandle', () => ({ ResizeHandle: () => null }));
vi.mock('./ArtifactCards', () => ({ ArtifactCards: () => null }));
vi.mock('./BotAvatar', () => ({ BotAvatar: () => null, GroupAvatar: () => null }));
vi.mock('./BotBrowserPanel', () => ({ BotBrowserPanel: () => null }));
vi.mock('./BotComposer', () => ({ BotComposer: () => null }));
vi.mock('./BotLiveStatus', () => ({ BotLiveStatus: () => null }));
vi.mock('./BotPresence', () => ({
  MemberBusyBar: ({
    onOpenLive,
  }: {
    onOpenLive: (conversationId: string, botId: string) => void;
  }) =>
    createElement(
      'button',
      { type: 'button', 'data-busy-member': true, onClick: () => onOpenLive('child', 'worker') },
      '阿全 · 排队中 · #15 续做'
    ),
}));
vi.mock('./BotProfilePanel', () => ({ BotProfilePanel: () => null }));
vi.mock('./DelegationCard', () => ({ DelegationCard: () => null }));
vi.mock('./GroupBoard', () => ({ TaskBoard: () => null }));
vi.mock('./GroupInfoPanel', () => ({ GroupInfoPanel: () => null }));
vi.mock('./GroupTimeline', () => ({ GroupTimeline: () => null }));
vi.mock('./LiveSessionTimeline', () => ({
  LiveSessionDialog: ({
    conversationId,
    emptyTitle,
  }: {
    conversationId: string | null;
    emptyTitle?: string;
  }) =>
    conversationId &&
    createElement('div', { 'data-live-session': conversationId, 'data-empty-title': emptyTitle }),
  LiveSessionTimeline: () => null,
}));
vi.mock('./SessionHistoryDialog', () => ({
  SessionHistoryDialog: ({ conversationId }: { conversationId: string | null }) =>
    conversationId && createElement('div', { 'data-history-session': conversationId }),
}));
vi.mock('./SessionSwitcher', () => ({ SessionSwitcher: () => null }));
vi.mock('./SilenceNote', () => ({ SilenceNote: () => null }));
vi.mock('./ThreadSwitcher', () => ({ ThreadSwitcher: () => null }));
vi.mock('./WorkspaceMenu', () => ({ WorkspaceMenu: () => null }));
vi.mock('./BotWorkspaceDesigns', () => ({
  BotWorkspaceDesigns: ({ chat, target }: { chat: BotChat; target: BotDesignTarget | null }) =>
    createElement('div', { 'data-workspace-designs': chat.id, 'data-target': target?.path }),
}));

const chat: BotChat = {
  id: 'empty-topic',
  parentId: 'root-group',
  kind: 'group',
  title: '',
  members: [],
  bossBotId: null,
  workspace: { kind: 'project', projectId: 'p' },
  sessions: {},
  routing: { mode: 'boss', maxHops: 2, maxTurnsPerBot: 2 },
  pinned: false,
  createdAt: 1,
  updatedAt: 1,
  version: 1,
};
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const render = () => act(async () => root.render(createElement(BotChatView, { chat })));
beforeEach(() => {
  vi.clearAllMocks();
  h.state.panelTab = 'info';
  h.state.bots = [];
  h.state.sessions = {};
  h.state.delegations = [];
  h.settings.designEnabled = true;
  h.canvas.target = null;
  h.canvas.workspaceKey = null;
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('electronAPI', { speech: { requestMicAccess: vi.fn() } });
  container = document.createElement('div');
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

it('keeps Design alongside group info, board and browser with no delivery or member sessions', async () => {
  await render();
  const buttons = [...container.querySelectorAll<HTMLButtonElement>('aside button')];
  expect(buttons.map((b) => b.textContent)).toEqual([
    'Group info',
    'Task board',
    'Browser',
    '设计稿',
  ]);
  await act(async () => buttons.at(-1)?.click());
  expect(h.state.setPanelTab).toHaveBeenCalledWith('design');
  h.state.panelTab = 'design';
  await render();
  expect(
    container.querySelector('[data-workspace-designs]')?.getAttribute('data-workspace-designs')
  ).toBe('empty-topic');
  expect(container.querySelector('aside button[aria-pressed="true"]')?.textContent).toBe('设计稿');
});
it('never remounts a stale workspace canvas after the design tab was hidden', async () => {
  h.canvas.target = { chatId: chat.id, cwd: '/old', path: '/old/old.vetd', projectId: 'p' };
  h.canvas.workspaceKey = JSON.stringify([chat.id, chat.workspace, '/old']);
  h.state.panelTab = 'design';
  await render();
  expect(container.querySelector('[data-target]')).toBeNull();
  h.canvas.workspaceKey = JSON.stringify([chat.id, chat.workspace, '/work']);
  await render();
  expect(container.querySelector('[data-target]')?.getAttribute('data-target')).toBe(
    '/old/old.vetd'
  );
});
it('hides the entry and falls back to info only when design is disabled', async () => {
  h.settings.designEnabled = false;
  h.state.panelTab = 'design';
  await render();
  expect(container.querySelector('[data-workspace-designs]')).toBeNull();
  expect(container.querySelector('aside button[aria-pressed="true"]')?.textContent).toBe(
    'Group info'
  );
  expect(container.textContent).not.toContain('设计稿');
});

const delegation = (patch: Partial<Delegation> = {}): Delegation => ({
  id: 'run',
  parentConversationId: 'parent',
  parentBotId: 'boss',
  targetBotId: 'worker',
  chatId: chat.id,
  task: '#15 续做',
  context: '',
  childConversationId: 'child',
  state: 'queued',
  depth: 1,
  createdAt: 100,
  ...patch,
});

const clickBusyMember = () =>
  act(async () => container.querySelector<HTMLButtonElement>('[data-busy-member]')?.click());

it.each(['queued', 'running'] as const)(
  '底部打开尚未缓存的 %s 委派时补载过程，而不是展示空白新对话',
  async (state) => {
    h.state.delegations = [delegation({ state })];
    await render();
    await clickBusyMember();
    expect(container.querySelector('[data-live-session]')?.getAttribute('data-live-session')).toBe(
      'child'
    );
    expect(h.state.trackSession).toHaveBeenCalledWith('child');
    expect(container.querySelector('[data-history-session]')).toBeNull();
  }
);

it.each(['failed', 'completed', 'canceled', 'blocked'] as const)(
  '底部打开已 %s 的委派时与任务看板一样读取历史过程',
  async (state) => {
    h.state.delegations = [delegation({ state })];
    await render();
    await clickBusyMember();
    expect(
      container.querySelector('[data-history-session]')?.getAttribute('data-history-session')
    ).toBe('child');
    expect(container.querySelector('[data-live-session]')).toBeNull();
    expect(h.state.trackSession).not.toHaveBeenCalled();
  }
);

it('成员普通群会话仍打开实时过程，首次查看时补载正文', async () => {
  await render();
  await clickBusyMember();
  expect(container.querySelector('[data-live-session]')?.getAttribute('data-live-session')).toBe(
    'child'
  );
  expect(h.state.trackSession).toHaveBeenCalledWith('child');
});

it('已缓存的委派过程不重新初始化会话投影', async () => {
  h.state.delegations = [delegation({ state: 'running' })];
  h.state.sessions = { child: { messages: ['已有过程'] } };
  await render();
  await clickBusyMember();
  expect(container.querySelector('[data-live-session]')?.getAttribute('data-live-session')).toBe(
    'child'
  );
  expect(h.state.trackSession).not.toHaveBeenCalled();
});

it('worker 退出后续做复用原会话时，按当前排队执行显示占位而非新对话提示', async () => {
  h.state.delegations = [
    delegation({ id: 'old', state: 'failed', createdAt: 50, finishedAt: 90 }),
    delegation(),
  ];
  await render();
  await clickBusyMember();
  expect(container.querySelector('[data-live-session]')?.getAttribute('data-empty-title')).toBe(
    'Queued and has not started yet'
  );
});
