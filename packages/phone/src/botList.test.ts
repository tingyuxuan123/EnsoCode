import type {
  PairBotActivity,
  PairBotChatSummary,
  PairBotInboxItem,
  PairBotMember,
} from '@enso/pair';
import { describe, expect, it } from 'vitest';
import { botListRows, waitingChatIds } from './botList';

const member = (id: string, name: string, extra: Partial<PairBotMember> = {}): PairBotMember => ({
  id,
  name,
  title: '',
  avatarColor: '#7c5cff',
  status: 'idle',
  ...extra,
});

const chat = (
  id: string,
  kind: 'direct' | 'group',
  updatedAt: number,
  extra: Partial<PairBotChatSummary> = {}
): PairBotChatSummary => ({
  id,
  kind,
  title: id,
  members: kind === 'direct' ? ['a'] : ['a', 'b'],
  bossBotId: kind === 'group' ? 'a' : null,
  updatedAt,
  lastSeq: 0,
  sessions: {},
  status: 'idle',
  ...extra,
});

const activity = (chatId: string, botId: string, extra: Partial<PairBotActivity> = {}) =>
  ({
    conversationId: `${chatId}:${botId}`,
    botId,
    chatId,
    state: 'tool',
    steps: [{ name: 'bash', detail: 'pnpm test', status: 'running' }],
    more: 0,
    ...extra,
  }) as PairBotActivity;

describe('Bot 列表：人和群合成一张表', () => {
  const bots = [
    member('a', '林经理', { title: '项目经理' }),
    member('b', '小设', { title: '设计' }),
    member('c', '旧成员', { title: '全栈', archived: true }),
  ];

  it('按最后活跃排，置顶优先；私聊带职位、群聊带标题', () => {
    const rows = botListRows(
      [
        chat('d-a', 'direct', 5, { members: ['a'] }),
        chat('g', 'group', 9, { title: '优化讨论' }),
        chat('d-b', 'direct', 7, { members: ['b'] }),
        chat('pinned', 'group', 1, { title: '置顶群', pinned: true }),
      ],
      bots
    );
    expect(rows.map((row) => row.chatId)).toEqual(['pinned', 'g', 'd-b', 'd-a']);
    expect(rows[1]).toMatchObject({ kind: 'group', title: '优化讨论' });
    expect(rows[2]).toMatchObject({ kind: 'direct', title: '小设', role: '设计' });
  });

  it('子话题不单独成行；已归档的群和已归档成员的私聊不出现', () => {
    const rows = botListRows(
      [
        chat('root', 'group', 3),
        chat('thread', 'group', 4, { parentId: 'root' }),
        chat('gone', 'group', 9, { archived: true }),
        chat('d-c', 'direct', 9, { members: ['c'] }),
      ],
      bots
    );
    expect(rows.map((row) => row.chatId)).toEqual(['root']);
  });

  it('第二行是最后一句：群聊带说话人，私聊直接是内容', () => {
    const rows = botListRows(
      [
        chat('g', 'group', 2, {
          last: { kind: 'bot', botId: 'a', text: '部署好了', at: 2 },
        }),
        chat('d', 'direct', 1, {
          members: ['b'],
          last: { kind: 'bot', text: '第一版出了', at: 1 },
        }),
      ],
      bots
    );
    expect(rows[0].preview).toBe('林经理：部署好了');
    expect(rows[1].preview).toBe('第一版出了');
  });

  it('成员正在干活时第二行换成当前这一步，并标为运行中', () => {
    const rows = botListRows([chat('g', 'group', 2, { members: ['a', 'b'] })], bots, [
      activity('g', 'b'),
    ]);
    expect(rows[0].preview).toBe('小设：bash pnpm test');
    expect(rows[0].running).toBe(true);
  });

  it('收件箱里有待办的那一行标成「等你」；静默提示不算', () => {
    const inbox: PairBotInboxItem[] = [
      { key: 'k1', kind: 'approval', chatId: 'g', createdAt: 1, dismissible: false },
      { key: 'k2', kind: 'silence', chatId: 'd', createdAt: 1, dismissible: true },
    ];
    expect([...waitingChatIds(inbox)]).toEqual(['g']);
    const rows = botListRows([chat('g', 'group', 2), chat('d', 'direct', 1)], bots, [], inbox);
    expect(rows.find((row) => row.chatId === 'g')?.waiting).toBe(true);
    expect(rows.find((row) => row.chatId === 'd')?.waiting).toBe(false);
  });

  it('「来自 X」只在调用方给得出委派来源时才填，不凭空造', () => {
    const rows = botListRows([chat('d', 'direct', 1, { members: ['b'] })], bots);
    expect(rows[0].via).toBeUndefined();
    expect(
      botListRows([chat('d', 'direct', 1, { members: ['b'] })], bots, [], [], () => '林经理')[0].via
    ).toBe('林经理');
  });
});
