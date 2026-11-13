import type { BotChat, BotProfile, Delegation } from '@shared/types/bot';
import { parseHTML } from 'linkedom';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyProjection } from '@/stores/sessions/reducer';
import { BotSidebar } from './BotSidebar';

const store = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  code: { conversations: {} as Record<string, unknown> },
}));
vi.mock('@/stores/sessions', () => ({
  useSessionsStore: (select: (state: unknown) => unknown) => select(store.code),
}));
vi.mock('@/stores/bots', () => ({
  useBotsStore: (select: (state: unknown) => unknown) => select(store.state),
  useBotPendingCount: () => 0,
}));
vi.mock('@/i18n', () => ({
  useI18n: () => ({ t: (key: string) => key, locale: 'en' }),
}));
vi.mock('./BotSearchDialog', () => ({ BotSearchButton: () => null }));
vi.mock('./CloneGroupDialog', () => ({ CloneGroupDialog: () => null }));

const bot = (id: string): BotProfile => ({
  id,
  name: id,
  title: '',
  scope: '',
  avatar: { color: '#888' },
  approvalMode: 'full',
  tools: 'all',
  skillIds: [],
  mcpServerIds: [],
  delegation: { canDelegateTo: 'any', acceptFrom: 'any' },
  memory: { enabled: true },
  createdAt: 1,
  updatedAt: 1,
  version: 1,
});
const chat = (id: string, kind: BotChat['kind'], members: string[]): BotChat => ({
  id,
  kind,
  title: id,
  members,
  bossBotId: null,
  workspace: { kind: 'member-home' },
  routing: { mode: 'boss', maxHops: 4, maxTurnsPerBot: 2 },
  pinned: false,
  sessions: Object.fromEntries(
    members.map((id) => [id, { conversationId: `${kind}-${id}`, cursor: 0 }])
  ),
  createdAt: 1,
  updatedAt: 1,
  version: 1,
});
const delegation = (patch: Partial<Delegation> = {}): Delegation => ({
  id: 'task',
  chatId: 'Group',
  parentBotId: 'Parent',
  targetBotId: 'Target',
  parentConversationId: 'group-Parent',
  childConversationId: 'child',
  task: 'work',
  context: '',
  state: 'running',
  depth: 1,
  createdAt: 1,
  ...patch,
});
const renderDocument = () => {
  const noop = () => {};
  const { document } = parseHTML(
    renderToStaticMarkup(
      <BotSidebar
        width={280}
        onCollapse={noop}
        onNewMember={noop}
        onNewGroup={noop}
        onNewTeam={noop}
        onStartFromGoal={noop}
      />
    )
  );
  return document;
};
const renderRows = () =>
  Object.fromEntries(
    [...renderDocument().querySelectorAll('[role="button"]')].map((row) => [
      row.getAttribute('aria-label'),
      Boolean(row.querySelector('.animate-pulse.bg-success')),
    ])
  );

describe('BotSidebar running dots', () => {
  beforeEach(() => {
    store.code = { conversations: {} };
    store.state = {
      bots: ['Parent', 'Target', 'Other'].map(bot),
      chats: [
        chat('Group', 'group', ['Parent', 'Target']),
        chat('Elsewhere', 'group', ['Other']),
        chat('ParentDM', 'direct', ['Parent']),
        chat('TargetDM', 'direct', ['Target']),
      ],
      sessions: {},
      delegations: [],
      queue: [],
      timelines: {},
      reads: {},
      view: null,
    };
  });

  const codeChild = (patch: Record<string, unknown> = {}) => ({
    parentId: 'code-parent',
    status: 'running',
    child: {
      parentId: 'code-parent',
      agentTypeKey: 'bot:Target',
      agentInstanceName: 'plugin-core-port',
      mode: 'coworker',
    },
    ...patch,
  });

  it.each(['coworker', 'task'])('Code 中的 %s 只点亮实际执行成员并显示工作中', (mode) => {
    const child = codeChild();
    store.code.conversations = {
      'code-parent': {},
      child: { ...child, child: { ...child.child, mode } },
    };
    expect(renderRows()).toMatchObject({ Target: true, Parent: false, Group: false });
    const row = renderDocument().querySelector('[aria-label="Target"]');
    expect(row?.textContent).toContain('Working');
  });

  it('成员没有私聊时，也展示 Code 协作者的工作状态', () => {
    store.code.conversations = {
      'code-parent': {},
      child: codeChild({ child: { parentId: 'code-parent', agentTypeKey: 'bot:Other' } }),
    };
    expect(renderRows()).toMatchObject({ Other: true, Target: false });
    expect(renderDocument().querySelector('[aria-label="Other"]')?.textContent).toContain(
      'Working'
    );
  });

  it.each([
    { status: 'idle' },
    { status: 'failed' },
    { status: 'idle', spawning: true },
    { ended: true },
    { historyOnly: true },
    { child: { parentId: 'another-parent', agentTypeKey: 'bot:Target' } },
    { child: { parentId: 'code-parent', agentTypeKey: 'builtin:worker' } },
    { child: undefined, coworkerName: 'Target' },
  ])('待命、已结束或非成员子会话不误报工作中：%j', (patch) => {
    store.code.conversations = { 'code-parent': {}, child: codeChild(patch) };
    expect(renderRows()).toMatchObject({ Target: false, Parent: false, Group: false });
  });

  it('Code 中同一成员只要还有运行实例就保持工作中，全部结束后恢复原状态', () => {
    store.code.conversations = {
      'code-parent': {},
      first: codeChild({ status: 'idle' }),
      second: codeChild(),
    };
    expect(renderRows().Target).toBe(true);
    store.code.conversations.second = codeChild({ status: 'idle' });
    expect(renderRows().Target).toBe(false);
    expect(renderDocument().querySelector('[aria-label="Target"]')?.textContent).not.toContain(
      'Working'
    );
  });

  it('已搁置的成员也显示 Code 中的工作状态', () => {
    store.state.chats = [{ ...chat('TargetDM', 'direct', ['Target']), settledAt: 2 }];
    store.code.conversations = { 'code-parent': {}, child: codeChild() };
    expect(renderRows().Target).toBe(true);
  });

  it.each(['queued', 'running'] as const)(
    '%s 委派点亮所属群和执行者，不点亮发起人或其他群',
    (state) => {
      store.state.delegations = [delegation({ state })];
      expect(renderRows()).toMatchObject({
        Group: true,
        Target: true,
        Parent: false,
        Elsewhere: false,
        Other: false,
      });
    }
  );

  it('执行者尚无私聊或委派没有聊天归属时也亮', () => {
    store.state.delegations = [delegation({ targetBotId: 'Other', chatId: undefined })];
    expect(renderRows()).toMatchObject({ Group: false, Target: false, Parent: false, Other: true });
  });

  it('私聊里发出的委派只点亮执行者，不点亮发起人的私聊', () => {
    store.state.delegations = [delegation({ chatId: 'ParentDM' })];
    expect(renderRows()).toMatchObject({ Group: false, Target: true, Parent: false });
  });

  it('已搁置的群和成员行也包含进行中的委派', () => {
    store.state.chats = [
      { ...chat('Group', 'group', ['Parent', 'Target']), settledAt: 2 },
      { ...chat('TargetDM', 'direct', ['Target']), settledAt: 2 },
    ];
    store.state.delegations = [delegation()];
    expect(renderRows()).toMatchObject({ Group: true, Target: true, Parent: false });
  });

  it.each(['completed', 'failed', 'canceled'] as const)(
    '%s 后熄灭，即使子会话仍有运行态残留',
    (state) => {
      store.state.delegations = [delegation()];
      expect(renderRows()).toMatchObject({ Group: true, Target: true });
      store.state.delegations = [delegation({ state })];
      store.state.sessions = { child: { ...emptyProjection, status: 'running' } };
      expect(renderRows()).toMatchObject({ Group: false, Target: false, Parent: false });
    }
  );

  it('保留群内自身会话和成员私聊运行态，不把群内会话算成成员私聊', () => {
    store.state.sessions = {
      'group-Parent': { ...emptyProjection, status: 'running' },
      'direct-Target': { ...emptyProjection, status: 'running' },
    };
    expect(renderRows()).toMatchObject({
      Group: true,
      Target: true,
      Parent: false,
      Elsewhere: false,
    });
  });

  it('同一成员有多个委派时，只要还有进行中任务就保持亮', () => {
    store.state.delegations = [
      delegation({ state: 'completed' }),
      delegation({ id: 'second', state: 'queued' }),
    ];
    expect(renderRows()).toMatchObject({ Group: true, Target: true, Parent: false });
  });

  it('正在看主话题时，后台话题的新消息仍显示群未读且不多出群行', () => {
    const parent = chat('Group', 'group', ['Parent', 'Target']);
    const thread = { ...parent, id: 'Topic', parentId: parent.id };
    store.state.chats = [parent, thread];
    store.state.view = { kind: 'chat', chatId: parent.id };
    store.state.timelines = {
      Topic: { entries: [{ seq: 1, kind: 'human', text: 'Background reply', at: 10 }], lastSeq: 1 },
    };
    const rows = [...renderDocument().querySelectorAll('[role="button"]')];
    const groups = rows.filter((row) => row.querySelector('.font-medium')?.textContent === 'Group');
    expect(groups).toHaveLength(1);
    expect(groups[0].textContent).toContain('Background reply');
    expect(groups[0].querySelector('.bg-info')).not.toBeNull();
    expect(renderRows()).not.toHaveProperty('Topic');
  });
});
