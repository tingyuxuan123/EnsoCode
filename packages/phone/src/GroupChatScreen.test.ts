import type { PairBotChatSummary, PairGroupEntry } from '@enso/pair';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { GroupChatScreen } from './GroupChatScreen';

vi.mock('@/components/chat/ApprovalBar', () => ({ ApprovalBar: () => null }));
vi.mock('@/components/chat/AskBar', () => ({ AskBar: () => null }));
vi.mock('@/components/chat/Markdown', () => ({ Markdown: ({ text }: { text: string }) => text }));
vi.mock('@/components/chat/VoiceInputButton', () => ({
  VoiceInputButton: () =>
    createElement('button', {
      type: 'button',
      'aria-label': '语音输入',
    }),
}));

const chat: PairBotChatSummary = {
  id: 'chat',
  kind: 'group',
  title: 'Team',
  members: [],
  bossBotId: null,
  updatedAt: 0,
  lastSeq: 4,
  sessions: {},
  status: 'idle',
  epochSeq: 2,
};
const entries: PairGroupEntry[] = [
  { id: 'old', seq: 1, at: 1, kind: 'human', text: 'OLD_SECRET', mentions: [] },
  { id: 'epoch', seq: 2, at: 2, kind: 'system', text: '新对话', newConversation: true },
  { id: 'new', seq: 3, at: 3, kind: 'human', text: 'CURRENT_TASK', mentions: [] },
  {
    id: 'failure',
    seq: 4,
    at: 4,
    kind: 'system',
    text: '回复失败：503',
    failure: { botId: 'bot', mode: 'resume', conversationId: 'conv' },
  },
];
const noop = () => {};
const render = (patch: Partial<Parameters<typeof GroupChatScreen>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(GroupChatScreen, {
      chat,
      bots: new Map(),
      timeline: { entries, lastSeq: 4, hasOlder: false },
      state: undefined,
      pending: [],
      activities: [],
      clockOffset: 0,
      connState: 'online',
      stateLabel: 'online',
      notice: null,
      onOpenDrawer: noop,
      onLoadOlder: noop,
      onSend: noop,
      onStop: noop,
      onOpenProcess: noop,
      onApproval: noop,
      onAsk: noop,
      onRetry: noop,
      ...patch,
    })
  );

describe('phone group recovery and folding UI', () => {
  // 设计稿 `bot-menu`：一个会话只有一个 ⋯ 入口，新建会话不再直接露在顶栏
  it('opens session actions from one menu entry instead of a top-bar button', () => {
    const html = render({ onNewSession: noop, canCreate: true });
    expect(html).toContain('aria-label="会话菜单"');
    expect(html).not.toContain('aria-label="新建会话"');
    expect(html).not.toContain('aria-label="新话题"');
  });
  it('folds old messages by default while keeping the current task and recovery button', () => {
    const html = render();
    expect(html).not.toContain('OLD_SECRET');
    expect(html).toContain('CURRENT_TASK');
    expect(html).toContain('更早的对话');
    expect(html).toContain('>重试</button>');
  });
  it('does not offer write actions to read-only devices or retry obsolete failures', () => {
    expect(render({ deviceReadOnly: true })).not.toContain('>重试</button>');
    expect(
      render({
        timeline: {
          entries: [
            ...entries,
            { id: 'next', seq: 5, at: 5, kind: 'human', text: 'new', mentions: [] },
          ],
          lastSeq: 5,
          hasOlder: false,
        },
      })
    ).not.toContain('>重试</button>');
  });
  it('offers a path back to latest when the history window has been trimmed', () => {
    expect(
      render({ timeline: { entries, lastSeq: 900, hasOlder: true, history: true } })
    ).toContain('回到最新消息');
  });
  // 设计稿「消息分层」L3：progress 不再是独立一行，而是并进本轮的活动行（N 步）
  it('folds progress into the turn activity line; old phones skip unknown kinds without crashing', () => {
    const progress = {
      id: 'p',
      seq: 5,
      at: 5,
      kind: 'progress',
      botId: 'bot',
      taskId: 't',
      taskSeq: 3,
      delegationId: 'd',
      phase: 'started',
      text: '开工 #3『登录页』',
    } as PairGroupEntry;
    // 同一轮里既有进度也有成员的正文：正文留下，进度并进活动行
    const say = {
      id: 'say',
      seq: 6,
      at: 6,
      kind: 'bot',
      botId: 'bot',
      text: 'RUN_RESULT',
      conversationId: 'conv',
      turnId: 'turn',
    } as PairGroupEntry;
    const html = render({
      bots: new Map([
        ['bot', { id: 'bot', name: 'Bob', title: '', avatarColor: '#000000', status: 'idle' }],
      ]),
      timeline: { entries: [...entries, progress, say], lastSeq: 6, hasOlder: false },
    });
    expect(html).toContain('Bob');
    expect(html.replace(/<[^>]+>/g, '')).toContain('RUN_RESULT');
    // 过程文案不再出现在主线程，只留「N 步」
    expect(html.replace(/<[^>]+>/g, '')).not.toContain('开工 #3『登录页』');
    expect(html).toMatch(/\d+ 步/);
    const future = { ...progress, kind: 'from-the-future' } as unknown as PairGroupEntry;
    const old = render({
      timeline: { entries: [...entries, future], lastSeq: 5, hasOlder: false },
    });
    expect(old).toContain('CURRENT_TASK');
    expect(old).not.toContain('开工 #3');
  });

  // 过程与委派结果不再单独成行，统一并进本轮活动行（见 groupRows.test.ts）
  it('folds progress and delegation results into one activity line per turn', () => {
    const delegation = (seq: number, taskId?: string) =>
      ({
        id: `d${seq}`,
        seq,
        at: seq,
        kind: 'delegation',
        delegationId: `d${seq}`,
        from: 'boss',
        to: 'bot',
        state: 'completed',
        summary: `RESULT_${seq}`,
        ...(taskId ? { taskId } : {}),
      }) as PairGroupEntry;
    const progress = {
      id: 'p',
      seq: 7,
      at: 7,
      kind: 'progress',
      botId: 'bot',
      taskId: 't',
      taskSeq: 3,
      delegationId: 'd5',
      phase: 'delivered',
      text: '交付 #3：登录页做完了',
    } as PairGroupEntry;
    const say = {
      id: 'say',
      seq: 8,
      at: 8,
      kind: 'bot',
      botId: 'bot',
      text: 'TURN_SAY',
      conversationId: 'conv',
      turnId: 'turn',
    } as PairGroupEntry;
    const html = render({
      timeline: {
        entries: [...entries, delegation(5, 't'), delegation(6), progress, say],
        lastSeq: 8,
        hasOlder: false,
      },
    });
    const text = html.replace(/<[^>]+>/g, '');
    // 委派结果文案不再刷屏，只在活动行里数次数
    expect(text).not.toContain('RESULT_5');
    expect(text).not.toContain('交付 #3：登录页做完了');
    expect(text).toMatch(/委派 \d+ 次/);
  });

  it('shows the mic button only when voice is provided', () => {
    expect(render()).not.toContain('aria-label="语音输入"');
    expect(render({ voice: noop as never })).toContain('aria-label="语音输入"');
  });
  it('uses a single stop action while running and keeps the routing hint above the input', () => {
    const html = render({ chat: { ...chat, status: 'running' } });
    expect(html).toContain('aria-label="停止"');
    expect(html).not.toContain('aria-label="发送"');
    expect(html).toContain('不 @ 时，会挑最合适的成员回复');
  });
  it('shows the topic switcher only when the desktop supports threads', () => {
    expect(render({ onNewSession: noop, canCreate: true })).not.toContain('aria-label="切换话题"');
    const threads = {
      entries: [
        { id: 'chat', title: '主话题', activityAt: 1, unread: false, running: false },
        { id: 't1', title: '发布清单', activityAt: 2, unread: false, running: true },
      ],
      currentId: 't1',
      rootId: 'chat',
      onSelect: noop,
      onCreate: noop,
    };
    const html = render({ onNewSession: noop, canCreate: true, threads });
    const trigger = html.match(/<button[^>]*aria-label="切换话题"[^>]*>[\s\S]*?<\/button>/)?.[0];
    expect(trigger).toContain('发布清单');
    expect(trigger).not.toContain('disabled=""');
    // 「新话题」不再直接露在顶栏，收进 ⋯ 菜单；顶栏只留一个入口
    expect(html).not.toContain('aria-label="新话题"');
    expect(html).toContain('aria-label="会话菜单"');
    expect(html).not.toContain('aria-label="新建会话"');
    // 只读也能看列表
    expect(
      render({ threads: { ...threads, disabledHint: 'x' } }).match(
        /<button[^>]*aria-label="切换话题"[^>]*>/
      )?.[0]
    ).not.toContain('disabled=""');
  });
});
