import type { PairBotMember, PairGroupEntry } from '@enso/pair';
import { describe, expect, it } from 'vitest';
import { commsAgo, commsRows } from './commsRows';

const NOW = 1_700_000_000_000;

const bots = new Map<string, PairBotMember>([
  ['l1', { id: 'l1', name: '林经理' } as PairBotMember],
  ['a1', { id: 'a1', name: '阿全' } as PairBotMember],
]);

const delegation = (
  delegationId: string,
  from: string,
  to: string,
  at: number,
  state: 'running' | 'completed' | 'failed' = 'completed',
  summary?: string
): PairGroupEntry =>
  ({
    kind: 'delegation',
    seq: 1,
    at,
    delegationId,
    from,
    to,
    state,
    ...(summary === undefined ? {} : { summary }),
  }) as PairGroupEntry;

describe('commsRows', () => {
  it('把委派条目转成「谁让谁做什么」，倒序排列', () => {
    const rows = commsRows(
      [
        delegation('d1', 'l1', 'a1', NOW - 3600_000, 'completed', '补验 #6'),
        delegation('d2', 'l1', 'a1', NOW - 600_000, 'running', '整理验收记录'),
      ],
      bots,
      NOW
    );
    expect(rows.map((row) => row.key)).toEqual(['d2', 'd1']);
    expect(rows[0]).toMatchObject({
      fromName: '林经理',
      toName: '阿全',
      task: '整理验收记录',
      live: true,
    });
  });

  it('同一委派出现多条时保留最新一条', () => {
    const rows = commsRows(
      [
        delegation('d1', 'l1', 'a1', NOW - 3600_000, 'completed', '第一次'),
        delegation('d1', 'l1', 'a1', NOW - 60_000, 'completed', '重试后'),
      ],
      bots,
      NOW
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.task).toBe('重试后');
  });

  it('没有任务说明时给明确占位，不丢这条记录', () => {
    const rows = commsRows([delegation('d1', 'l1', 'a1', NOW, 'completed')], bots, NOW);
    expect(rows[0]?.task).toBe('（没有附任务说明）');
  });

  it('成员名解析不到时退回 id，便于发现异常而不是静默丢弃', () => {
    const rows = commsRows([delegation('d1', 'unknown', 'a1', NOW, 'completed', 'x')], bots, NOW);
    expect(rows[0]?.fromName).toBe('unknown');
  });

  it('非委派条目一律不出现', () => {
    const entries = [
      { kind: 'human', seq: 1, at: NOW, text: '你好', mentions: [] },
      { kind: 'system', seq: 2, at: NOW, text: '系统' },
    ] as PairGroupEntry[];
    expect(commsRows(entries, bots, NOW)).toEqual([]);
  });
});

describe('commsAgo', () => {
  it('一分钟内显示刚刚', () => {
    expect(commsAgo(NOW - 30_000, NOW)).toBe('刚刚');
  });

  it('一小时内按分钟', () => {
    expect(commsAgo(NOW - 12 * 60_000, NOW)).toBe('12 分钟');
  });

  it('一天内按小时', () => {
    expect(commsAgo(NOW - 2 * 3600_000, NOW)).toBe('2 小时');
  });

  it('超过一天给日期时间，不受当前时区影响地稳定输出', () => {
    expect(commsAgo(NOW - 30 * 3600_000, NOW)).toMatch(/^昨天 \d{2}:\d{2}$/);
  });
});
