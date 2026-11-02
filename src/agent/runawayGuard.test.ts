import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { describe, expect, it } from 'vitest';
import { RunawayGuard, runawayReminderText, withRunawayGuard } from './runawayGuard';

function textTool(
  name: string,
  run: (params: unknown) => { text: string; isError?: boolean }
): ToolDefinition {
  return {
    name,
    label: name,
    description: name,
    parameters: { type: 'object', properties: {} } as ToolDefinition['parameters'],
    async execute(_id, params) {
      const result = run(params);
      return {
        content: [{ type: 'text' as const, text: result.text }],
        details: undefined,
        ...(result.isError ? { isError: true as const } : {}),
      };
    },
  };
}

describe('RunawayGuard', () => {
  it('连续三次相同工具、参数与结果才提醒，只提醒一次', () => {
    const guard = new RunawayGuard();
    const args = { path: 'a.ts' };
    expect(guard.observe('read', args, { text: 'body' })).toBeUndefined();
    expect(guard.observe('read', args, { text: 'body' })).toBeUndefined();
    const reminder = guard.observe('read', args, { text: 'body' });
    expect(reminder).toContain('[runaway guard]');
    expect(reminder).toContain('no observable progress');
    expect(guard.observe('read', args, { text: '4' })).toBeUndefined();
  });

  it('换工具或换参数会打断动作连击', () => {
    const guard = new RunawayGuard();
    const args = { path: 'a.ts' };
    guard.observe('read', args, { text: '1' });
    guard.observe('read', args, { text: '2' });
    guard.observe('grep', { pattern: 'x' }, { text: '3' });
    expect(guard.observe('read', args, { text: '4' })).toBeUndefined();
    expect(guard.observe('read', args, { text: '4' })).toBeUndefined();
    expect(guard.observe('read', args, { text: '4' })).toContain('no observable progress');
  });

  it('同参数结果在变化，或者长输出只有 4096 字符之后在变化，都算进展', () => {
    for (const prefix of ['', 'x'.repeat(10_000)]) {
      const guard = new RunawayGuard();
      for (let i = 0; i < 6; i++)
        expect(
          guard.observe('bash', { command: 'check' }, { text: `${prefix} result ${i}` })
        ).toBeUndefined();
    }
  });

  it('同文件连续六次不同编辑或写入的成功回执相同，不算无进展', () => {
    for (const tool of ['edit', 'write', 'apply_patch', 'bash']) {
      const guard = new RunawayGuard();
      for (let i = 0; i < 6; i++)
        expect(
          guard.observe(tool, { path: 'a.ts', content: `change-${i}` }, { text: 'success' })
        ).toBeUndefined();
    }
  });

  it('参数对象键序不同仍是同一个动作，长参数尾部不同不是同一动作', () => {
    const guard = new RunawayGuard();
    guard.observe('edit', { path: 'a', nested: { x: 1, y: 2 } }, { text: 'ok' });
    guard.observe('edit', { nested: { y: 2, x: 1 }, path: 'a' }, { text: 'ok' });
    expect(
      guard.observe('edit', { path: 'a', nested: { y: 2, x: 1 } }, { text: 'ok' })
    ).toBeTruthy();
    guard.resetTurn();
    for (let i = 0; i < 6; i++)
      expect(
        guard.observe('write', { content: `${'x'.repeat(10_000)}${i}` }, { text: 'ok' })
      ).toBeUndefined();
  });

  it('task_output 长输出尾部推进时不提醒，切换 taskId 重新计数', () => {
    const guard = new RunawayGuard();
    for (let i = 0; i < 6; i++)
      expect(
        guard.observe('task_output', { taskId: 'a' }, { text: `${'x'.repeat(10_000)}${i}` })
      ).toBeUndefined();
    guard.observe('task_output', { taskId: 'a' }, { text: 'same' });
    guard.observe('task_output', { taskId: 'a' }, { text: 'same' });
    expect(guard.observe('task_output', { taskId: 'b' }, { text: 'same' })).toBeUndefined();
  });

  it('computer 相同 code 但截图 hash 变了不算 runaway', () => {
    const guard = new RunawayGuard();
    const args = { code: 'await win.screenshot()' };
    expect(guard.observe('computer', args, { text: 'hash a' })).toBeUndefined();
    expect(guard.observe('computer', args, { text: 'hash b' })).toBeUndefined();
    expect(guard.observe('computer', args, { text: 'hash c' })).toBeUndefined();
  });

  it('computer 三次相同结果文本才算无进展', () => {
    const guard = new RunawayGuard();
    const args = { code: 'await win.screenshot()' };
    const snap = { text: 'w1 10×10 hash deadbeef' };
    expect(guard.observe('computer', args, snap)).toBeUndefined();
    expect(guard.observe('computer', args, snap)).toBeUndefined();
    expect(guard.observe('computer', args, snap)).toContain('no observable progress');
  });

  it('同一错误家族连续三次提醒', () => {
    const guard = new RunawayGuard();
    const args = { command: 'npm test' };
    const err = { text: 'ENOENT: no such file', isError: true };
    expect(guard.observe('bash', args, err)).toBeUndefined();
    expect(guard.observe('bash', { command: 'npm test -- --run' }, err)).toBeUndefined();
    expect(guard.observe('bash', { command: 'pnpm test' }, err)).toContain('same error');
  });

  it('task_output 轮询无进展三次提醒，且禁止写入 Memory', () => {
    const guard = new RunawayGuard();
    const args = { taskId: 'task-1' };
    const snap = { text: '[running] Full log: /tmp/x\n(no output yet)' };
    expect(guard.observe('task_output', args, snap)).toBeUndefined();
    expect(guard.observe('task_output', args, snap)).toBeUndefined();
    const reminder = guard.observe('task_output', args, snap);
    expect(reminder).toContain('task_output');
    expect(reminder).toMatch(/notified automatically/i);
    expect(reminder).toMatch(/Do not save/i);
  });

  it('resetTurn 后可以再提醒', () => {
    const guard = new RunawayGuard();
    const args = { path: 'a.ts' };
    guard.observe('read', args, { text: 'body' });
    guard.observe('read', args, { text: 'body' });
    expect(guard.observe('read', args, { text: 'body' })).toBeTruthy();
    guard.resetTurn();
    guard.observe('read', args, { text: 'body' });
    guard.observe('read', args, { text: 'body' });
    expect(guard.observe('read', args, { text: 'body' })).toContain('no observable progress');
  });

  it('withRunawayGuard 把提醒垫到工具结果顶部', async () => {
    const guard = new RunawayGuard();
    const wrapped = withRunawayGuard(
      textTool('read', () => ({ text: 'body' })),
      guard
    );
    const args = { path: 'a.ts' };
    await wrapped.execute('1', args, undefined, undefined, undefined as never);
    await wrapped.execute('2', args, undefined, undefined, undefined as never);
    const third = await wrapped.execute('3', args, undefined, undefined, undefined as never);
    const text = third.content[0];
    expect(text?.type).toBe('text');
    if (text?.type === 'text') {
      expect(text.text.startsWith(runawayReminderText('unchanged_progress_repeat'))).toBe(true);
      expect(text.text).toContain('body');
    }
    expect(third).not.toHaveProperty('terminate');
  });
});
