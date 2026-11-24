import { expect, it } from 'vitest';
import { createDelegationTools, normalizeDelegationParams } from './delegation';
import { DelegationInvoker } from './delegationInvoker';

it('normalizes optional nulls and boolean text before full typed schema validation', () => {
  expect(normalizeDelegationParams({ id: null, cancel: 'false' })).toEqual({ cancel: false });
  expect(normalizeDelegationParams({ to: 'Bob', task: 't', taskId: 3 })).toEqual({
    to: 'Bob',
    task: 't',
    taskId: '3',
  });
  expect(normalizeDelegationParams({ to: 'Bob', task: 't', taskId: null })).toEqual({
    to: 'Bob',
    task: 't',
  });
  expect(normalizeDelegationParams({ to: 'Bob', task: 't', deadlineMinutes: '30' })).toEqual({
    to: 'Bob',
    task: 't',
    deadlineMinutes: 30,
  });
  expect(
    normalizeDelegationParams({ to: 'Bob', task: 't', deadlineMinutes: null, keep: null })
  ).toEqual({
    to: 'Bob',
    task: 't',
  });
  expect(normalizeDelegationParams({ to: 'Bob', task: 't', keep: 'true' })).toEqual({
    to: 'Bob',
    task: 't',
    keep: true,
  });
  expect(normalizeDelegationParams({ deadlineMinutes: 'soon' })).toEqual({
    deadlineMinutes: 'soon',
  });
  expect(normalizeDelegationParams({ to: 'Bob', task: 't', check: 'XYZ_PASS' })).toEqual({
    to: 'Bob',
    task: 't',
    check: { kind: 'output-contains', text: 'XYZ_PASS' },
  });
  expect(normalizeDelegationParams({ to: 'Bob', task: 't', check: null })).toEqual({
    to: 'Bob',
    task: 't',
  });
  const tools = createDelegationTools(
    new DelegationInvoker({ sessionId: 's', generation: 'g' }, () => {})
  );
  expect(tools.map((tool) => tool.name)).toEqual(['delegate', 'check_delegation']);
  expect(Object.keys((tools[0].parameters as { properties: object }).properties)).toEqual([
    'to',
    'task',
    'context',
    'deadlineMinutes',
    'keep',
    'check',
  ]);
  for (const tool of tools) {
    const schema = tool.parameters as unknown as {
      type: string;
      properties: Record<string, unknown>;
    };
    expect(schema.type).toBe('object');
    expect(tool.prepareArguments).toBeDefined();
    for (const property of Object.values(schema.properties))
      expect(property).toHaveProperty('type');
  }
});

it('describes auto-created board tasks only for group sessions', () => {
  const describe = (groupTasks: boolean) =>
    createDelegationTools(new DelegationInvoker({ sessionId: 's', generation: 'g' }, () => {}), {
      groupTasks,
    }).find((tool) => tool.name === 'delegate')?.description ?? '';
  expect(describe(true)).toContain('Without taskId, a new board task is created');
  expect(describe(true)).toContain('the task becomes blocked (run failed) with the same assignee');
  expect(describe(true)).toContain('status="blocked"');
  expect(describe(true)).toContain('appends to that run instead of starting a new one');
  expect(describe(true)).not.toContain('on failure/cancel it returns to todo');
  expect(describe(false)).not.toContain('board task');
  expect(describe(false)).not.toContain('appends to that run');
});

it('report_blocked 只挂在看板任务的委派会话，schema 带完整类型，waitFor: null 归一化掉', () => {
  const names = (delegationTask: boolean) =>
    createDelegationTools(new DelegationInvoker({ sessionId: 's', generation: 'g' }, () => {}), {
      delegationTask,
    }).map((tool) => tool.name);
  expect(names(false)).not.toContain('report_blocked');
  expect(names(true)).toContain('report_blocked');
  const tool = createDelegationTools(
    new DelegationInvoker({ sessionId: 's', generation: 'g' }, () => {}),
    { delegationTask: true }
  ).find((item) => item.name === 'report_blocked')!;
  expect(tool.parameters).toMatchObject({
    type: 'object',
    properties: {
      need: { type: 'string', minLength: 1, maxLength: 300 },
      waitFor: { type: 'string', enum: ['parent', 'human'] },
    },
    required: ['need'],
  });
  expect(tool.description).toContain('does not count as blocked');
  expect(normalizeDelegationParams({ need: 'x', waitFor: null })).toEqual({ need: 'x' });
});
