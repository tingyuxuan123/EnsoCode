import type { PairBotMember, PairGroupEntry } from '@enso/pair';
import { describe, expect, it } from 'vitest';
import { dayLeadLabel, groupRows, summaryLeadLabel } from './groupRows';

const bots = new Map<string, PairBotMember>([
  ['a', { id: 'a', name: '阿全', title: '全栈', avatarColor: '#111111', status: 'idle' }],
  ['b', { id: 'b', name: '小设', title: '设计', avatarColor: '#222222', status: 'idle' }],
]);

const at = (seq: number) => new Date(2026, 10, 13, 15, seq).getTime();

const human = (seq: number, text: string): PairGroupEntry => ({
  seq,
  id: `h${seq}`,
  at: at(seq),
  kind: 'human',
  text,
  mentions: [],
});

const say = (seq: number, botId: string, text: string, turnId = `t${seq}`): PairGroupEntry => ({
  seq,
  id: `b${seq}`,
  at: at(seq),
  kind: 'bot',
  botId,
  text,
  conversationId: `c-${botId}`,
  turnId,
});

const progress = (
  seq: number,
  botId: string,
  phase: 'started' | 'delivered' | 'blocked',
  text = 'step'
): PairGroupEntry => ({
  seq,
  id: `p${seq}`,
  at: at(seq),
  kind: 'progress',
  botId,
  taskId: 'task',
  taskSeq: seq,
  delegationId: 'd1',
  phase,
  text,
});

const delegation = (
  seq: number,
  from: string,
  to: string,
  state: 'queued' | 'running' | 'completed' | 'failed'
): PairGroupEntry => ({
  seq,
  id: `d${seq}`,
  at: at(seq),
  kind: 'delegation',
  delegationId: `d${seq}`,
  from,
  to,
  state,
});

describe('群时间线分层', () => {
  const now = new Date(2026, 10, 13, 18, 0).getTime();

  it('同一个人同一轮只留最后一句，中间的进度折进活动行', () => {
    const rows = groupRows(
      [
        human(0, '帮我部署'),
        progress(1, 'a', 'started'),
        say(2, 'a', '先看下环境', 'turn-1'),
        progress(3, 'a', 'delivered'),
        say(4, 'a', '部署完成，就等你验收。', 'turn-1'),
      ],
      bots,
      now
    );
    const says = rows.filter((row) => row.kind === 'say');
    expect(says).toHaveLength(1);
    expect(says[0]).toMatchObject({ name: '阿全', text: '部署完成，就等你验收。' });
    expect(says[0].kind === 'say' && says[0].activity).toEqual({
      steps: 2,
      delegations: 0,
      live: false,
    });
  });

  it('活动行给小节数与委派次数，右侧给验收结果', () => {
    const rows = groupRows(
      [
        say(0, 'a', '做完了', 'turn-x'),
        progress(1, 'a', 'started'),
        delegation(2, 'a', 'b', 'completed'),
        progress(3, 'a', 'delivered'),
      ],
      bots,
      now
    );
    const sayRow = rows.find((row) => row.kind === 'say');
    expect(sayRow?.kind === 'say' && sayRow.activity).toEqual({
      steps: 2,
      delegations: 1,
      state: '已验收',
      live: false,
    });
    expect(rows[0]).toMatchObject({ kind: 'lead' });
  });

  it('委派还在跑就是「进行中」并标 live', () => {
    const rows = groupRows(
      [say(0, 'a', '在跑', 'turn-y'), delegation(1, 'a', 'b', 'running')],
      bots,
      now
    );
    const sayRow = rows.find((row) => row.kind === 'say');
    expect(sayRow?.kind === 'say' && sayRow.activity).toMatchObject({
      state: '进行中',
      live: true,
    });
  });

  it('两个 Bot 各回一句之后补一行「N 条消息，与 M 个 Bot」摘要', () => {
    const rows = groupRows(
      [human(0, '问'), say(1, 'a', '好的', 'ta'), say(2, 'b', '收到', 'tb')],
      bots,
      now
    );
    expect(rows.map((row) => (row.kind === 'lead' ? row.label : row.kind))).toEqual([
      '今天 15:00',
      'human',
      'say',
      'say',
      summaryLeadLabel(2, 2),
    ]);
  });

  it('只有一个 Bot 回复时不补摘要行', () => {
    const rows = groupRows([say(1, 'a', '好的', 'ta')], bots, now);
    expect(rows.filter((row) => row.kind === 'lead')).toHaveLength(1);
  });

  it('换天插入新的段头，人说的话原样保留', () => {
    const yesterday: PairGroupEntry = {
      seq: 9,
      id: 'h9',
      at: new Date(2026, 10, 12, 13, 40).getTime(),
      kind: 'human',
      text: '昨天的事',
      mentions: [],
    };
    const rows = groupRows([yesterday, human(10, '今天的事')], bots, now);
    const leads = rows
      .filter((row) => row.kind === 'lead')
      .map((row) => row.kind === 'lead' && row.label);
    expect(leads).toEqual(['昨天 13:40', '今天 15:10']);
    expect(rows.filter((row) => row.kind === 'human')).toHaveLength(2);
  });

  it('系统条目单独成行，且切断上一轮', () => {
    const system: PairGroupEntry = {
      seq: 5,
      id: 's5',
      at: at(5),
      kind: 'system',
      text: '回复失败：503',
      failure: { botId: 'a', mode: 'resume' },
    };
    const rows = groupRows([say(1, 'a', '一', 't1'), system], bots, now);
    expect(rows.map((row) => row.kind).slice(-2)).toEqual(['say', 'system']);
  });

  it('段头文案按今天/昨天/日期回落', () => {
    expect(dayLeadLabel(new Date(2026, 10, 13, 9, 5).getTime(), now)).toBe('今天 9:05');
    expect(dayLeadLabel(new Date(2026, 10, 12, 9, 5).getTime(), now)).toBe('昨天 9:05');
    expect(dayLeadLabel(new Date(2026, 10, 1, 9, 5).getTime(), now)).toBe('11月1日 9:05');
  });

  it('没有归属轮次的进度条目不伪造行', () => {
    const rows = groupRows([progress(1, 'a', 'started')], bots, now);
    expect(rows.filter((row) => row.kind === 'say')).toHaveLength(0);
  });
});
