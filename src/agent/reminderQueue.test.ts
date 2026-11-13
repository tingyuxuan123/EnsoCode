import { describe, expect, it } from 'vitest';
import { enqueueReminder } from './reminderQueue';

describe('enqueueReminder', () => {
  it('未满时追加，不驱逐', () => {
    const queue = ['a'];
    expect(enqueueReminder(queue, 'b', 3)).toBe(false);
    expect(queue).toEqual(['a', 'b']);
  });

  it('满了留一格溢出告知，丢弃数包含为告知腾出的位置，新通知保留', () => {
    const queue = ['a', 'b', 'c'];
    expect(enqueueReminder(queue, 'd', 3)).toBe(true);
    expect(queue).toHaveLength(3);
    expect(queue.slice(1)).toEqual(['c', 'd']);
    expect(queue[0]).toMatch(/^\[Queue overflow\] 2 earlier background notifications were dropped/);
    expect(queue[0]).toContain('tasks were not stopped');
  });

  it('重复溢出累加通知丢弃数，告知本身不算一条丢弃任务', () => {
    const queue = ['a', 'b', 'c'];
    enqueueReminder(queue, 'd', 3);
    expect(enqueueReminder(queue, 'e', 3)).toBe(true);
    expect(queue.slice(1)).toEqual(['d', 'e']);
    expect(queue[0]).toMatch(/^\[Queue overflow\] 3 earlier /);
    expect(queue.filter((text) => text.startsWith('[Queue overflow]'))).toHaveLength(1);
  });

  it('容量为二时也保留最新结果，已消费告知后新一批从头计数', () => {
    const queue = ['a', 'b'];
    enqueueReminder(queue, 'c', 2);
    expect(queue).toHaveLength(2);
    expect(queue[1]).toBe('c');
    expect(queue[0]).toMatch(/^\[Queue overflow\] 2 earlier /);
    queue.splice(0);
    enqueueReminder(queue, 'd', 2);
    expect(queue).toEqual(['d']);
  });

  it('投递失败后旧批次与已溢出的新队列合并，不把告知当成普通结果丢弃', () => {
    const current = ['a', 'b', 'c'];
    enqueueReminder(current, 'd', 3);
    const requeued: string[] = [];
    for (const text of ['undelivered', ...current]) enqueueReminder(requeued, text, 3);
    expect(requeued.slice(1)).toEqual(['c', 'd']);
    expect(requeued[0]).toMatch(/^\[Queue overflow\] 3 earlier /);
  });

  it('两批都溢出后重排，累计两个丢弃数且只留一条告知', () => {
    const first = ['a', 'b', 'c'];
    const second = ['d', 'e', 'f'];
    enqueueReminder(first, 'g', 3);
    enqueueReminder(second, 'h', 3);
    const combined: string[] = [];
    for (const text of [...first, ...second]) enqueueReminder(combined, text, 3);
    expect(combined.slice(1)).toEqual(['f', 'h']);
    expect(combined[0]).toMatch(/^\[Queue overflow\] 6 earlier /);
    expect(combined).toHaveLength(3);
  });

  it.each([0, 1, -1, 2.5, Number.NaN, Number.POSITIVE_INFINITY])(
    '坏容量 %s 不修改队列',
    (limit) => {
      const queue = ['a'];
      expect(() => enqueueReminder(queue, 'b', limit)).toThrow(RangeError);
      expect(queue).toEqual(['a']);
    }
  );
});
