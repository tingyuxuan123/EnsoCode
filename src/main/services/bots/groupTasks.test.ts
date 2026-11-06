import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Delegation, GroupTask, GroupTaskRun } from '../../../shared/types/bot';
import { BotStore } from './botStore';
import { BotChatStore } from './chatStore';
import { GroupTaskStore } from './groupTaskStore';
import { GroupTaskService, taskAfterDelegation } from './groupTasks';

let root: string;
let bots: BotStore;
let chats: BotChatStore;
let service: GroupTaskService;
let alice: string;
let bob: string;
let chatId: string;
const emit = vi.fn();
const send = vi.fn(async (_chatId: string, _text: string) => ({ ok: true as const }));
const cancelDelegation = vi.fn();
const rework = vi.fn(
  (_input: { chatId: string; delegationId: string; actor: string; reason: string }) =>
    ({ ok: true }) as { ok: true } | { ok: false; error: string }
);
let legacy: Delegation[] = [];
let outputs: Array<{
  role: string;
  toolCallId: string;
  toolName: string;
  isError?: boolean;
  timestamp: number;
  content: Array<{ type: 'text'; text: string }>;
}> = [];
const sessionMessages = vi.fn(async (_chatId: string, _botId: string) => outputs);
const output = (toolCallId: string, text: string, timestamp: number, isError = false) => ({
  role: 'toolResult',
  toolCallId,
  toolName: 'bash',
  isError,
  timestamp,
  content: [{ type: 'text' as const, text }],
});

const progressTexts = (id = chatId) =>
  chats
    .readEntries(id, { limit: 100 })
    .flatMap((entry) => (entry.kind === 'progress' ? [entry.text] : []));
const systemTexts = () =>
  chats
    .readEntries(chatId, { limit: 100 })
    .filter((entry) => entry.kind === 'system')
    .map((entry) => (entry.kind === 'system' ? entry.text : ''));

it('群任务直通保留投递身份交给当前执行去重，不把同一补充变成新任务', async () => {
  const task = added();
  const running: Delegation = {
    id: '11111111-1111-4111-8111-111111111111',
    taskId: task.id,
    chatId,
    parentConversationId: 'parent',
    childConversationId: 'child',
    parentBotId: alice,
    targetBotId: bob,
    task: 'Fix login',
    context: '',
    state: 'running',
    depth: 1,
    createdAt: 1,
  };
  legacy = [running];
  service.sync(running);
  const interject = vi.fn(async () => ({ ok: true as const }));
  service = new GroupTaskService({
    store: new GroupTaskStore(join(root, 'chats')),
    chats,
    bots,
    emit,
    delegations: () => legacy,
    interject,
  });
  expect(
    await service.reply(chatId, task.id, 'Safari only', { deliveryId: 'stable-followup' })
  ).toMatchObject({ ok: true });
  expect(interject).toHaveBeenCalledWith({
    delegationId: running.id,
    text: 'Safari only',
    deliveryId: 'stable-followup',
  });
  expect(service.list(chatId)).toHaveLength(1);
});

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'group-task-service-'));
  bots = new BotStore(join(root, 'bots'));
  chats = new BotChatStore(join(root, 'chats'));
  const a = bots.create({ name: 'Alice' }, []);
  const b = bots.create({ name: 'Bob', tools: 'readonly' }, []);
  if (!a.ok || !b.ok) throw new Error('fixture');
  alice = a.bot.id;
  bob = b.bot.id;
  chatId = chats.create({
    kind: 'group',
    title: 'Team',
    members: [alice, bob],
    bossBotId: alice,
    workspace: { kind: 'project', projectId: 'p' },
  })!.id;
  emit.mockClear();
  send.mockClear();
  cancelDelegation.mockClear();
  rework.mockReset();
  rework.mockReturnValue({ ok: true });
  outputs = [];
  legacy = [];
  sessionMessages.mockClear();
  service = new GroupTaskService({
    store: new GroupTaskStore(join(root, 'chats')),
    chats,
    bots,
    emit,
    send,
    cancelDelegation,
    sessionMessages,
    delegations: () => legacy,
    rework,
  });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const added = (title = 'Login page', actor = 'human') => {
  const result = service.add(chatId, actor, { title });
  if (!result.ok) throw new Error(result.error);
  return result.task;
};

describe('成员动作与权限', () => {
  it('新建 / 认领 / 完成写 system 时间线并推送 tasks 事件；编辑详情不写', () => {
    const task = added();
    expect(service.claim(chatId, bob, '#1')).toMatchObject({
      ok: true,
      task: { status: 'doing', assigneeBotId: bob },
    });
    expect(service.update(chatId, bob, '1', { detail: 'use OAuth' })).toMatchObject({ ok: true });
    expect(service.complete(chatId, bob, task.id, 'shipped')).toMatchObject({
      ok: true,
      task: { status: 'done', result: 'shipped' },
    });
    expect(systemTexts()).toEqual([
      '用户 新建了任务 #1 Login page',
      'Bob 认领了 #1 Login page',
      'Bob 完成了 #1 Login page：shipped',
    ]);
    expect(emit).toHaveBeenCalledWith({ kind: 'tasks', chatId });
  });

  it('并发认领：第二个认领失败并给出明确错误', () => {
    added();
    const first = service.claim(chatId, alice, '#1');
    const second = service.claim(chatId, bob, '#1');
    expect(first.ok).toBe(true);
    expect(second).toEqual({ ok: false, error: 'Task #1 is already claimed by Alice.' });
  });

  it('只有认领人能完成，且必须写 result；非成员与私聊一律拒绝', () => {
    added();
    service.claim(chatId, alice, '#1');
    expect(service.complete(chatId, bob, '#1', 'x')).toEqual({
      ok: false,
      error: 'Only the assignee (Alice) can complete task #1.',
    });
    expect(service.complete(chatId, alice, '#1', ' ')).toMatchObject({ ok: false });
    const carol = bots.create({ name: 'Carol' }, []);
    if (!carol.ok) throw new Error('fixture');
    expect(service.add(chatId, carol.bot.id, { title: 'x' })).toMatchObject({ ok: false });
    const direct = chats.create({
      kind: 'direct',
      title: '',
      members: [alice],
      bossBotId: null,
      workspace: { kind: 'member-home' },
    })!;
    expect(service.add(direct.id, alice, { title: 'x' })).toMatchObject({ ok: false });
  });

  it('成员只能取消自己建的或自己负责的任务；委派中的任务成员不能完成 / 取消，人类取消连带取消委派', () => {
    const task = added('A', alice);
    expect(service.cancel(chatId, bob, '#1')).toMatchObject({ ok: false });
    service.claim(chatId, bob, '#1');
    store().save(chatId, { ...store().find(chatId, task.id)!, delegationId: DELEGATION });
    expect(service.complete(chatId, bob, '#1', 'done')).toMatchObject({
      ok: false,
      error: expect.stringContaining('delegation'),
    });
    expect(service.cancel(chatId, bob, '#1')).toMatchObject({ ok: false });
    expect(cancelDelegation).not.toHaveBeenCalled();
    expect(service.cancel(chatId, 'human', '#1')).toMatchObject({
      ok: true,
      task: { status: 'canceled' },
    });
    expect(cancelDelegation).toHaveBeenCalledWith(DELEGATION);
    expect(service.claim(chatId, alice, '#1')).toEqual({
      ok: false,
      error: 'Task #1 was canceled.',
    });
  });

  it('tool 入口：list 返回名字而非 id，未知 action 报错', () => {
    added();
    service.claim(chatId, bob, '#1');
    expect(service.tool(chatId, alice, { action: 'list' })).toEqual({
      ok: true,
      tasks: [
        expect.objectContaining({
          id: '#1',
          title: 'Login page',
          status: 'doing',
          assignee: 'Bob',
        }),
      ],
    });
    expect(service.tool(chatId, alice, { action: 'add' })).toMatchObject({ ok: false });
    expect(service.tool(chatId, alice, { action: 'nuke' })).toMatchObject({ ok: false });
  });
});

describe('验收条件 check', () => {
  const check = { kind: 'output-contains' as const, text: 'XYZ_PASS' };
  let now = 1000;
  beforeEach(() => {
    now = 1000;
    service = new GroupTaskService({
      store: new GroupTaskStore(join(root, 'chats')),
      chats,
      bots,
      emit,
      send,
      cancelDelegation,
      sessionMessages,
      now: () => now,
    });
  });

  it('成员 complete 需在认领之后的最终工具结果里看到文本，否则拒绝', async () => {
    expect(service.add(chatId, alice, { title: 'Build', check })).toMatchObject({
      ok: true,
      task: { check },
    });
    outputs = [output('old', 'XYZ_PASS', 500)];
    now = 2000;
    expect(service.claim(chatId, bob, '#1')).toMatchObject({ ok: true, task: { claimedAt: 2000 } });
    outputs.push(output('a', 'XYZ_PASS', 2100), output('a', 'XYZ_PASS', 2200, true));
    const rejected = await service.tool(chatId, bob, {
      action: 'complete',
      id: '#1',
      result: 'ok',
    });
    expect(rejected).toEqual({
      ok: false,
      error: expect.stringContaining('Acceptance check failed'),
    });
    expect(sessionMessages).toHaveBeenCalledWith(chatId, bob);
    expect(store().find(chatId, '#1')).toMatchObject({ status: 'doing' });
    expect(service.complete(chatId, bob, '#1', 'ok')).toMatchObject({ ok: false });
    outputs.push(output('b', 'built: XYZ_PASS', 2300));
    expect(
      await service.tool(chatId, bob, { action: 'complete', id: '#1', result: 'ok' })
    ).toMatchObject({ ok: true, task: { status: 'done', check: 'XYZ_PASS', checkPassed: true } });
    expect(store().find(chatId, '#1')?.check).toEqual({ ...check, passed: true });
  });

  it('人类可直接完成；只有创建者能改验收条件，人类可清除', async () => {
    service.add(chatId, alice, { title: 'Build', check });
    expect(service.update(chatId, bob, '#1', { check: { ...check, text: 'X' } })).toMatchObject({
      ok: false,
    });
    expect(
      service.tool(chatId, alice, {
        action: 'update',
        id: '#1',
        check: { kind: 'output-contains', text: 'NEW' },
      })
    ).toMatchObject({ ok: true, task: { check: 'NEW' } });
    expect(service.update(chatId, 'human', '#1', { check: null })).toMatchObject({ ok: true });
    expect(store().find(chatId, '#1')).not.toHaveProperty('check');
    service.update(chatId, 'human', '#1', { check });
    expect(service.complete(chatId, 'human', '#1')).toMatchObject({
      ok: true,
      task: { status: 'done' },
    });
    expect(sessionMessages).not.toHaveBeenCalled();
  });

  it('读不到会话记录按未通过；指派也记认领时间', async () => {
    service.add(chatId, 'human', { title: 'Build', check });
    now = 3000;
    await service.assign(chatId, '#1', bob);
    expect(store().find(chatId, '#1')?.claimedAt).toBe(3000);
    sessionMessages.mockRejectedValueOnce(new Error('gone'));
    expect(
      await service.tool(chatId, bob, { action: 'complete', id: '#1', result: 'ok' })
    ).toMatchObject({ ok: false });
  });

  it('关联委派随验收流转：通过 → review 记通过；未通过 → 仍由执行人负责，result 记原因', () => {
    const task = { ...todo, check };
    const linked = taskAfterDelegation(task, delegation({ check }), 5)!;
    expect(
      taskAfterDelegation(
        linked,
        delegation({ state: 'completed', result: 'ok', check: { ...check, passed: true } }),
        9
      )
    ).toMatchObject({ status: 'review', check: { ...check, passed: true } });
    const back = taskAfterDelegation(
      linked,
      delegation({
        state: 'failed',
        failure: 'check',
        error: '验收未通过：未在工具输出中看到「XYZ_PASS」',
        result: 'I tried',
        check: { ...check, passed: false },
      }),
      9
    )!;
    expect(back).toMatchObject({
      status: 'blocked',
      blockedReason: 'failed',
      assigneeBotId: delegation().targetBotId,
      delegationId: DELEGATION,
      result: '验收未通过：未在工具输出中看到「XYZ_PASS」',
      check: { ...check, passed: false },
    });
    const stuck = { ...back, runs: [failedRun()] };
    expect(
      taskAfterDelegation(stuck, delegation({ id: 'next', check, trigger: 'retry' }), 10)?.check
    ).toEqual(check);
  });

  it('gate 带出任务的验收条件', () => {
    const created = service.add(chatId, 'human', { title: 'Build', check });
    expect(service.gate(chatId, '#1', alice)).toEqual({
      ok: true,
      taskId: created.ok ? created.task.id : '',
      seq: 1,
      check,
    });
  });
});

describe('人类指派与成员离开', () => {
  it('指派 = 置 doing 并以人类身份 @ 成员；投递失败回滚', async () => {
    added();
    expect(await service.assign(chatId, '#1', bob)).toMatchObject({
      ok: true,
      task: { status: 'doing', assigneeBotId: bob },
    });
    expect(send).toHaveBeenCalledWith(chatId, '@Bob 请处理任务 #1：Login page', {
      task: expect.any(String),
    });
    added('API');
    send.mockResolvedValueOnce({ ok: false, error: 'chat-stopping' } as never);
    expect(await service.assign(chatId, '#2', alice)).toEqual({
      ok: false,
      error: 'chat-stopping',
    });
    expect(store().find(chatId, '#2')).toMatchObject({ status: 'todo' });
    expect(store().find(chatId, '#2')).not.toHaveProperty('assigneeBotId');
  });

  it('删除成员：其认领中的任务退回 todo', () => {
    added();
    added('Done one');
    service.claim(chatId, bob, '#1');
    service.claim(chatId, bob, '#2');
    service.complete(chatId, bob, '#2', 'ok');
    service.releaseBot(bob);
    expect(store().find(chatId, '#1')).toMatchObject({ status: 'todo' });
    expect(store().find(chatId, '#1')).not.toHaveProperty('assigneeBotId');
    expect(store().find(chatId, '#2')).toMatchObject({ status: 'done', assigneeBotId: bob });
  });
});

describe('群话题', () => {
  const texts = (id: string) =>
    chats
      .readEntries(id, { limit: 100 })
      .map((entry) => (entry.kind === 'system' ? entry.text : ''));

  it('看板归根群：话题里的成员与根群共用一份；成员动作写本话题，人类动作写当前话题', async () => {
    const thread = chats.createThread(chatId)!;
    const other = chats.createThread(chatId)!;
    chats.update(chatId, (draft) => ({ ...draft, activeThreadId: other.id }));
    expect(service.add(thread.id, alice, { title: 'Login page' })).toMatchObject({ ok: true });
    expect(service.list(chatId).map((task) => task.title)).toEqual(['Login page']);
    expect(service.list(thread.id)).toEqual(service.list(chatId));
    expect(emit).toHaveBeenCalledWith({ kind: 'tasks', chatId });
    expect(texts(thread.id)).toEqual(['Alice 新建了任务 #1 Login page']);

    service.claim(chatId, bob, '#1');
    expect(texts(chatId)).toEqual(['Bob 认领了 #1 Login page']);

    service.add(chatId, 'human', { title: 'API' });
    expect(texts(other.id)).toEqual(['用户 新建了任务 #2 API']);
    await service.assign(chatId, '#2', alice);
    expect(send).toHaveBeenCalledWith(other.id, '@Alice 请处理任务 #2：API', {
      task: expect.any(String),
    });

    const gate = service.gate(thread.id, '#1', bob);
    expect(gate).toMatchObject({ ok: true });
    service.sync(
      delegation({
        chatId: thread.id,
        parentBotId: bob,
        targetBotId: alice,
        taskId: store().find(chatId, '#1')!.id,
      })
    );
    expect(store().find(chatId, '#1')).toMatchObject({ assigneeBotId: alice });
    // 委派不再写 system 行；开工 / 交付由 progress 公开
    expect(texts(thread.id).at(-1)).toBe('Alice 新建了任务 #1 Login page');
  });

  it('根群归档后话题里也不能用看板', () => {
    const thread = chats.createThread(chatId)!;
    chats.update(chatId, (draft) => ({ ...draft, archivedAt: 1 }));
    expect(service.add(thread.id, alice, { title: 'x' })).toEqual({
      ok: false,
      error: 'This group is archived.',
    });
  });
});

const DELEGATION = '44444444-4444-4444-8444-444444444444';
function store(): GroupTaskStore {
  return (service as unknown as { deps: { store: GroupTaskStore } }).deps.store;
}
const delegation = (over: Partial<Delegation> = {}): Delegation => ({
  id: DELEGATION,
  parentConversationId: 'p',
  parentBotId: '11111111-1111-4111-8111-111111111111',
  targetBotId: '22222222-2222-4222-8222-222222222222',
  chatId: '33333333-3333-4333-8333-333333333333',
  task: 'do it',
  context: '',
  childConversationId: 'c',
  state: 'queued',
  depth: 1,
  createdAt: 1,
  taskId: '55555555-5555-4555-8555-555555555555',
  ...over,
});
const failedRun = (over: Partial<GroupTaskRun> = {}): GroupTaskRun => ({
  id: DELEGATION,
  botId: delegation().targetBotId,
  trigger: 'delegate',
  state: 'failed',
  failure: 'timeout',
  createdAt: 1,
  ...over,
});
const todo: GroupTask = {
  id: '55555555-5555-4555-8555-555555555555',
  seq: 3,
  title: 'Login',
  status: 'todo',
  createdBy: 'human',
  createdAt: 1,
  updatedAt: 1,
};

describe('委派联动状态机 taskAfterDelegation', () => {
  it('委派创建：todo → doing，负责人 = 目标，记 delegationId', () => {
    expect(taskAfterDelegation(todo, delegation(), 5)).toEqual({
      ...todo,
      status: 'doing',
      assigneeBotId: delegation().targetBotId,
      delegationId: DELEGATION,
      updatedAt: 5,
    });
  });

  it('发起人自己认领中的任务可转委派；别人认领 / 已有委派 / 终态不动', () => {
    const mine = { ...todo, status: 'doing' as const, assigneeBotId: delegation().parentBotId };
    expect(taskAfterDelegation(mine, delegation(), 5)?.assigneeBotId).toBe(
      delegation().targetBotId
    );
    const other = { ...mine, assigneeBotId: '66666666-6666-4666-8666-666666666666' };
    expect(taskAfterDelegation(other, delegation(), 5)).toBeUndefined();
    expect(
      taskAfterDelegation({ ...mine, delegationId: 'x' }, delegation({ id: 'y' }), 5)
    ).toBeUndefined();
    expect(taskAfterDelegation({ ...todo, status: 'done' }, delegation(), 5)).toBeUndefined();
    expect(taskAfterDelegation(todo, delegation({ taskId: 'other' }), 5)).toBeUndefined();
  });

  it('委派完成：执行人不是创建人 → review 保留负责人与委派；失败 → 卡住（执行失败）保留负责人；取消 → 退回 todo 清负责人', () => {
    const linked = taskAfterDelegation(todo, delegation(), 5)!;
    expect(
      taskAfterDelegation(linked, delegation({ state: 'completed', result: 'all good' }), 9)
    ).toMatchObject({
      status: 'review',
      result: 'all good',
      assigneeBotId: delegation().targetBotId,
      delegationId: DELEGATION,
      updatedAt: 9,
    });
    for (const failure of ['timeout', 'interrupted', 'denied', 'error'] as const)
      expect(
        taskAfterDelegation(linked, delegation({ state: 'failed', failure }), 9)
      ).toMatchObject({
        status: 'blocked',
        blockedReason: 'failed',
        assigneeBotId: delegation().targetBotId,
        delegationId: DELEGATION,
        updatedAt: 9,
      });
    expect(
      taskAfterDelegation(linked, delegation({ state: 'failed', failure: 'timeout' }), 9)
    ).not.toHaveProperty('blockedStreak');
    const back = taskAfterDelegation(linked, delegation({ state: 'canceled' }), 9)!;
    expect(back).toMatchObject({ status: 'todo', updatedAt: 9 });
    expect(back).not.toHaveProperty('assigneeBotId');
    expect(back).not.toHaveProperty('delegationId');
    expect(
      taskAfterDelegation({ ...linked, status: 'canceled' }, delegation({ state: 'failed' }), 9)
    ).toBeUndefined();
    expect(
      taskAfterDelegation(
        { ...linked, status: 'review' },
        delegation({ state: 'completed', deliveredAt: 11 }),
        10
      )
    ).toBeUndefined();
  });

  it('执行人就是任务创建人：委派完成仍直接 done', () => {
    const own = { ...todo, createdBy: delegation().targetBotId };
    const linked = taskAfterDelegation(own, delegation(), 5)!;
    expect(
      taskAfterDelegation(linked, delegation({ state: 'completed', result: 'ok' }), 9)
    ).toMatchObject({ status: 'done', result: 'ok' });
  });

  it('卡住（缺信息）：任务 → blocked/need，记缺什么，该成员连续次数 +1；交付后清零；失败不计次', () => {
    const target = delegation().targetBotId;
    const linked = taskAfterDelegation(todo, delegation(), 5)!;
    const blocked = taskAfterDelegation(
      linked,
      delegation({
        state: 'blocked',
        blocked: { need: '数据库密码', waitFor: 'parent', at: 8 },
      }),
      9
    )!;
    expect(blocked).toMatchObject({
      status: 'blocked',
      blockedReason: 'need',
      blockedNeed: '数据库密码',
      blockedStreak: { [target]: 1 },
      assigneeBotId: target,
      delegationId: DELEGATION,
    });
    // 回复：同成员新执行接手，任务回到 doing，清掉卡住原因、保留次数
    const replied = taskAfterDelegation(
      blocked,
      delegation({ id: 'reply', trigger: 'reply' }),
      10
    )!;
    expect(replied).toMatchObject({
      status: 'doing',
      delegationId: 'reply',
      blockedStreak: { [target]: 1 },
    });
    expect(replied).not.toHaveProperty('blockedReason');
    expect(replied).not.toHaveProperty('blockedNeed');
    const again = taskAfterDelegation(
      replied,
      delegation({
        id: 'reply',
        state: 'blocked',
        blocked: { need: '还缺账号', waitFor: 'human', at: 11 },
      }),
      12
    )!;
    expect(again).toMatchObject({ blockedNeed: '还缺账号', blockedStreak: { [target]: 2 } });
    // 执行失败不计次
    const retry = taskAfterDelegation(again, delegation({ id: 'r2', trigger: 'reply' }), 13)!;
    const failed = taskAfterDelegation(
      retry,
      delegation({ id: 'r2', state: 'failed', failure: 'timeout' }),
      14
    )!;
    expect(failed).toMatchObject({
      status: 'blocked',
      blockedReason: 'failed',
      blockedStreak: { [target]: 2 },
    });
    expect(failed).not.toHaveProperty('blockedNeed');
    // 交付清零
    const r3 = taskAfterDelegation(failed, delegation({ id: 'r3', trigger: 'retry' }), 15)!;
    const delivered = taskAfterDelegation(
      r3,
      delegation({ id: 'r3', state: 'completed', result: 'ok' }),
      16
    )!;
    expect(delivered.status).toBe('review');
    expect(delivered).not.toHaveProperty('blockedStreak');
  });
});

describe('委派闸门与同步', () => {
  it('gate：未知 / 终态 / 他人认领拒绝；同步后交付写 progress，不再写委派 / 交付 system 行', () => {
    const task = added();
    expect(service.gate(chatId, '#9', alice)).toEqual({
      ok: false,
      error: 'Task #9 not found in this group.',
    });
    expect(service.gate(chatId, '#1', alice)).toEqual({ ok: true, taskId: task.id, seq: 1 });
    service.claim(chatId, bob, '#1');
    expect(service.gate(chatId, '#1', alice)).toEqual({
      ok: false,
      error: 'Task #1 is already claimed by Bob.',
    });
    expect(service.gate(chatId, '#1', bob)).toEqual({ ok: true, taskId: task.id, seq: 1 });
    const record = delegation({ chatId, parentBotId: bob, targetBotId: alice, taskId: task.id });
    service.sync(record);
    expect(store().find(chatId, '#1')).toMatchObject({
      assigneeBotId: alice,
      delegationId: DELEGATION,
    });
    service.sync({ ...record, state: 'completed', result: 'done!' });
    expect(store().find(chatId, '#1')).toMatchObject({ status: 'review', result: 'done!' });
    expect(systemTexts()).toEqual(['用户 新建了任务 #1 Login page', 'Bob 认领了 #1 Login page']);
    expect(progressTexts()).toEqual(['交付 #1：done!']);
  });
});

describe('待验收 review', () => {
  /** creator 建任务、delegator 委派给 executor 并完成 → review */
  const delivered = (creator: string, delegator: string, executor: string) => {
    const task = added('Login page', creator);
    const record = delegation({
      chatId,
      parentBotId: delegator,
      targetBotId: executor,
      taskId: task.id,
    });
    service.sync(record);
    service.sync({ ...record, state: 'completed', result: 'shipped' });
    expect(store().find(chatId, '#1')).toMatchObject({ status: 'review', assigneeBotId: executor });
    return record;
  };

  it('执行人不能验收 / 退回 / 完成 / 取消自己的任务；看板占用提示待验收', () => {
    delivered(alice, alice, bob);
    expect(progressTexts().at(-1)).toBe('交付 #1：shipped');
    expect(service.accept(chatId, bob, '#1')).toEqual({
      ok: false,
      error: 'Only the task creator (Alice) or a human can review task #1.',
    });
    expect(service.reject(chatId, bob, '#1', 'no')).toMatchObject({ ok: false });
    expect(service.complete(chatId, bob, '#1', 'again')).toEqual({
      ok: false,
      error: 'Task #1 is awaiting review; only Alice or a human can accept or reject it.',
    });
    expect(service.cancel(chatId, bob, '#1')).toEqual({
      ok: false,
      error: 'Only the task creator (Alice) or a human can cancel task #1 while it awaits review.',
    });
    expect(service.claim(chatId, bob, '#1')).toEqual({
      ok: false,
      error: 'Task #1 is awaiting review by Alice.',
    });
    expect(service.gate(chatId, '#1', alice)).toEqual({
      ok: false,
      error: 'Task #1 is awaiting review by Alice.',
    });
    expect(store().find(chatId, '#1')).toMatchObject({ status: 'review' });
  });

  it('创建人验收通过 → done，写 system 时间线', () => {
    delivered(alice, alice, bob);
    expect(service.accept(chatId, alice, '#1')).toMatchObject({
      ok: true,
      task: { status: 'done', result: 'shipped', assigneeBotId: bob },
    });
    expect(systemTexts().at(-1)).toBe('Alice 验收通过了 #1 Login page');
    expect(service.accept(chatId, alice, '#1')).toEqual({
      ok: false,
      error: 'Task #1 is not awaiting review.',
    });
    expect(cancelDelegation).not.toHaveBeenCalled();
  });

  it('退回必须写原因 → todo 清负责人与委派、记原因，可再次委派；再交付后通过清掉原因', () => {
    const record = delivered('human', alice, bob);
    expect(service.accept(chatId, alice, '#1')).toMatchObject({ ok: false });
    expect(service.reject(chatId, 'human', '#1', '  ')).toEqual({
      ok: false,
      error: 'Give a reason when rejecting a task.',
    });
    const back = service.reject(chatId, 'human', '#1', '缺少测试');
    expect(back).toMatchObject({ ok: true, task: { status: 'todo', returnReason: '缺少测试' } });
    if (!back.ok) throw new Error(back.error);
    expect(back.task).not.toHaveProperty('assigneeBotId');
    expect(back.task).not.toHaveProperty('delegationId');
    expect(systemTexts().at(-1)).toBe('用户 退回了 #1 Login page：缺少测试');
    expect(service.gate(chatId, '#1', alice)).toMatchObject({ ok: true });
    const again = { ...record, id: '77777777-7777-4777-8777-777777777777' };
    service.sync(again);
    service.sync({ ...again, state: 'completed', result: 'with tests' });
    expect(store().find(chatId, '#1')).toMatchObject({
      status: 'review',
      returnReason: '缺少测试',
    });
    const done = service.accept(chatId, 'human', '#1');
    expect(done).toMatchObject({ ok: true, task: { status: 'done', result: 'with tests' } });
    expect(done.ok && done.task).not.toHaveProperty('returnReason');
  });

  it('委派人不是创建人时也不能验收；创建人可取消待验收任务', () => {
    delivered('human', alice, bob);
    expect(service.accept(chatId, alice, '#1')).toEqual({
      ok: false,
      error: 'Only the task creator (用户) or a human can review task #1.',
    });
    expect(service.cancel(chatId, 'human', '#1')).toMatchObject({
      ok: true,
      task: { status: 'canceled' },
    });
  });

  it('成员自己建、自己认领完成的任务行为不变', () => {
    added('Own', bob);
    service.claim(chatId, bob, '#1');
    expect(service.complete(chatId, bob, '#1', 'ok')).toMatchObject({
      ok: true,
      task: { status: 'done' },
    });
  });

  it('tool 入口：list 显示 review 与退回原因；accept / reject 走同一校验', () => {
    delivered(alice, alice, bob);
    expect(service.tool(chatId, bob, { action: 'accept', id: '#1' })).toMatchObject({
      ok: false,
    });
    expect(service.tool(chatId, alice, { action: 'reject', id: '#1' })).toEqual({
      ok: false,
      error: 'Give a reason when rejecting a task.',
    });
    expect(
      service.tool(chatId, alice, { action: 'reject', id: '#1', reason: 'redo' })
    ).toMatchObject({ ok: true, task: { id: '#1', status: 'todo', returnReason: 'redo' } });
    expect(service.tool(chatId, alice, { action: 'list' })).toMatchObject({
      ok: true,
      tasks: [{ id: '#1', status: 'todo', returnReason: 'redo' }],
    });
  });
});

describe('执行记录 runs / sessions', () => {
  const check = { kind: 'output-contains' as const, text: 'XYZ_PASS' };
  const runId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

  it('open 静默建卡：标题取首个非空行前 60 字，详情为全文，创建人为发起成员；discard 回滚', () => {
    const text = `\n  ${'修'.repeat(70)}  \n第二行`;
    const opened = service.open(chatId, alice, text, check);
    expect(opened).toEqual({ taskId: expect.any(String), seq: 1 });
    expect(store().find(chatId, '#1')).toMatchObject({
      title: '修'.repeat(60),
      detail: text.trim(),
      createdBy: alice,
      status: 'todo',
      check,
    });
    expect(systemTexts()).toEqual([]);
    service.discard(chatId, opened?.taskId ?? '');
    expect(service.list(chatId)).toEqual([]);
    expect(service.open('not-a-chat', alice, 'x')).toBeUndefined();
  });

  it('每次落盘同步 runs 与执行人子会话；只有关联变化写时间线，#21 规则不变', () => {
    const task = added('Login page', alice);
    const record = delegation({
      chatId,
      parentBotId: alice,
      targetBotId: bob,
      taskId: task.id,
      childConversationId: 'child-bob',
      trigger: 'delegate',
    });
    service.sync(record);
    service.sync({ ...record, state: 'running', startedAt: 5 });
    expect(store().find(chatId, '#1')).toMatchObject({
      status: 'doing',
      runs: [
        {
          id: DELEGATION,
          botId: bob,
          trigger: 'delegate',
          state: 'running',
          createdAt: 1,
          startedAt: 5,
        },
      ],
      sessions: { [bob]: 'child-bob' },
    });
    service.sync({ ...record, state: 'completed', startedAt: 5, finishedAt: 9, result: 'ok' });
    service.sync({
      ...record,
      state: 'completed',
      startedAt: 5,
      finishedAt: 9,
      result: 'ok',
      deliveredAt: 10,
    });
    expect(store().find(chatId, '#1')).toMatchObject({
      status: 'review',
      runs: [{ id: DELEGATION, state: 'completed', startedAt: 5, finishedAt: 9 }],
    });
    expect(systemTexts()).toEqual(['Alice 新建了任务 #1 Login page']);
    expect(progressTexts()).toEqual(['交付 #1：ok']);
    // 执行人就是创建人：仍直接 done
    const own = added('Own', bob);
    const mine = delegation({
      id: runId(2),
      chatId,
      parentBotId: alice,
      targetBotId: bob,
      taskId: own.id,
    });
    service.sync(mine);
    service.sync({ ...mine, state: 'completed', result: 'ok' });
    expect(store().find(chatId, '#2')).toMatchObject({
      status: 'done',
      runs: [{ id: runId(2), trigger: 'delegate', state: 'completed' }],
    });
  });

  it('runs 只留最近 30 次；缺省 trigger 按 delegate', () => {
    const task = added();
    for (let n = 1; n <= 32; n++) {
      const record = delegation({
        id: runId(n),
        chatId,
        parentBotId: alice,
        targetBotId: bob,
        taskId: task.id,
        createdAt: n,
      });
      service.sync(record);
      service.sync({ ...record, state: 'failed', failure: 'timeout', finishedAt: n });
    }
    const runs = store().find(chatId, '#1')?.runs ?? [];
    expect(runs).toHaveLength(30);
    // 摘要没变的落盘（如投递时间）不重写任务
    const updatedAt = store().find(chatId, '#1')?.updatedAt;
    vi.spyOn(Date, 'now').mockReturnValue(Number.MAX_SAFE_INTEGER);
    const last = delegation({
      id: runId(32),
      chatId,
      parentBotId: alice,
      targetBotId: bob,
      taskId: task.id,
      createdAt: 32,
    });
    service.sync({ ...last, state: 'failed', failure: 'timeout', finishedAt: 32, deliveredAt: 99 });
    expect(store().find(chatId, '#1')?.updatedAt).toBe(updatedAt);
    vi.restoreAllMocks();
    expect(runs[0]).toEqual({
      id: runId(3),
      botId: bob,
      trigger: 'delegate',
      state: 'failed',
      failure: 'timeout',
      createdAt: 3,
      finishedAt: 3,
    });
  });

  it('深度 2 的嵌套执行只记进上层任务的 runs：不改状态、不记会话、不写时间线', () => {
    const task = added('Login page', alice);
    const outer = delegation({
      chatId,
      parentBotId: alice,
      targetBotId: bob,
      taskId: task.id,
      childConversationId: 'child-bob',
    });
    service.sync(outer);
    const before = systemTexts();
    const { taskId: _task, ...rest } = delegation({
      id: runId(7),
      chatId,
      parentBotId: bob,
      targetBotId: alice,
      parentConversationId: 'child-bob',
      childConversationId: 'child-alice',
      depth: 2,
      createdAt: 3,
    });
    service.sync(rest, task.id);
    service.sync({ ...rest, state: 'completed', result: 'sub done' }, task.id);
    expect(store().find(chatId, '#1')).toMatchObject({
      status: 'doing',
      delegationId: DELEGATION,
      sessions: { [bob]: 'child-bob' },
      runs: [
        { id: DELEGATION, botId: bob, state: 'queued' },
        { id: runId(7), botId: alice, state: 'completed', nested: true },
      ],
    });
    expect(store().find(chatId, '#1')?.sessions).not.toHaveProperty(alice);
    expect(systemTexts()).toEqual(before);
  });

  it('旧任务没有 runs：list 按 taskId 从委派记录只读派生，下次同步在派生结果上追加', () => {
    const task = added();
    const old = (n: number, over: Partial<Delegation>) =>
      delegation({
        id: runId(n),
        chatId,
        parentBotId: alice,
        targetBotId: bob,
        taskId: task.id,
        ...over,
      });
    legacy = [
      old(1, { state: 'completed', createdAt: 20, finishedAt: 25 }),
      old(2, { taskId: runId(99), createdAt: 5 }),
      old(3, { state: 'failed', failure: 'error', createdAt: 10, startedAt: 11, trigger: 'retry' }),
    ];
    expect(service.list(chatId)[0].runs).toEqual([
      {
        id: runId(3),
        botId: bob,
        trigger: 'retry',
        state: 'failed',
        failure: 'error',
        createdAt: 10,
        startedAt: 11,
      },
      {
        id: runId(1),
        botId: bob,
        trigger: 'delegate',
        state: 'completed',
        createdAt: 20,
        finishedAt: 25,
      },
    ]);
    expect(store().find(chatId, '#1')).not.toHaveProperty('runs');
    expect(service.list(chatId)).toHaveLength(1);
    service.sync(old(4, { createdAt: 30 }));
    expect(
      store()
        .find(chatId, '#1')
        ?.runs?.map((run) => run.id)
    ).toEqual([runId(3), runId(1), runId(4)]);
    added('Empty');
    expect(service.list(chatId)[1]).not.toHaveProperty('runs');
  });
});

describe('会话延续：续跑闸门、失败保留负责人、退回返工', () => {
  const runId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  /** alice 建卡并委派给 bob，执行到 state；子会话 child-bob */
  const handed = (state: 'failed' | 'completed' | 'blocked', over: Partial<Delegation> = {}) => {
    const task = added('Login page', alice);
    const record = delegation({
      chatId,
      parentBotId: alice,
      targetBotId: bob,
      taskId: task.id,
      childConversationId: 'child-bob',
    });
    legacy = [record];
    service.sync(record);
    const done = {
      ...record,
      state,
      ...(state === 'failed'
        ? { failure: 'timeout' as const }
        : state === 'blocked'
          ? { blocked: { need: '数据库密码', waitFor: 'parent' as const, at: 2 } }
          : { result: 'shipped' }),
      ...over,
    };
    legacy = [done];
    service.sync(done);
    return { task, record: done };
  };

  it('执行失败：任务进卡住（执行失败），仍由执行人负责、保留会话，时间线写失败原因；list 带出失败原因', () => {
    handed('failed');
    expect(store().find(chatId, '#1')).toMatchObject({
      status: 'blocked',
      blockedReason: 'failed',
      assigneeBotId: bob,
      delegationId: DELEGATION,
      sessions: { [bob]: 'child-bob' },
      runs: [{ id: DELEGATION, state: 'failed', failure: 'timeout' }],
    });
    expect(progressTexts().at(-1)).toBe('#1 执行失败：超时');
    expect(service.tool(chatId, alice, { action: 'list' })).toMatchObject({
      tasks: [
        {
          id: '#1',
          status: 'blocked',
          blockedReason: 'failed',
          assignee: 'Bob',
          failure: 'timeout',
        },
      ],
    });
  });

  it('失败后的闸门：原执行人续跑同一会话（retry）；委派人改派他人开新执行；无关成员拒绝', () => {
    const { task } = handed('failed');
    expect(service.gate(chatId, '#1', alice, bob)).toEqual({
      ok: true,
      taskId: task.id,
      seq: 1,
      trigger: 'retry',
      session: 'child-bob',
    });
    expect(service.gate(chatId, '#1', alice, alice)).toEqual({ ok: true, taskId: task.id, seq: 1 });
    const c = bots.create({ name: 'Carol' }, []);
    if (!c.ok) throw new Error('bot');
    chats.update(chatId, (draft) => ({ ...draft, members: [...draft.members, c.bot.id] }));
    expect(service.gate(chatId, '#1', c.bot.id, bob)).toEqual({
      ok: false,
      error:
        'Task #1 is blocked on Bob; only its creator, its delegator or a human can unblock, reassign or cancel it.',
    });
    // 新执行挂上任务：失败的执行不再挡
    service.sync(
      delegation({
        id: runId(2),
        chatId,
        parentBotId: alice,
        targetBotId: bob,
        taskId: task.id,
        childConversationId: 'child-bob',
        trigger: 'retry',
      })
    );
    expect(store().find(chatId, '#1')).toMatchObject({
      status: 'doing',
      assigneeBotId: bob,
      delegationId: runId(2),
    });
    expect(systemTexts().at(-1)).toBe('Alice 让 Bob 重试 #1 Login page');
  });

  it('失败的任务：创建人可取消，人可改派给别人（清掉失败的执行）', async () => {
    handed('failed');
    expect(service.cancel(chatId, alice, '#1')).toMatchObject({ ok: true });
    handed('failed');
    expect(await service.assign(chatId, '#2', alice)).toMatchObject({
      ok: true,
      task: { status: 'doing', assigneeBotId: alice },
    });
    expect(store().find(chatId, '#2')).not.toHaveProperty('delegationId');
  });

  it('待验收的闸门：创建人 / 委派人给原执行人追加 → 同会话 append；给别人或旁人拒绝', () => {
    const { task } = handed('completed');
    expect(service.gate(chatId, '#1', alice, bob)).toEqual({
      ok: true,
      taskId: task.id,
      seq: 1,
      trigger: 'append',
      session: 'child-bob',
    });
    expect(service.gate(chatId, '#1', alice, alice)).toEqual({
      ok: false,
      error: 'Task #1 is awaiting review by Alice.',
    });
    expect(service.gate(chatId, '#1', bob, bob)).toMatchObject({ ok: false });
    service.sync(
      delegation({
        id: runId(2),
        chatId,
        parentBotId: alice,
        targetBotId: bob,
        taskId: task.id,
        childConversationId: 'child-bob',
        trigger: 'append',
      })
    );
    expect(store().find(chatId, '#1')).toMatchObject({
      status: 'doing',
      delegationId: runId(2),
      result: 'shipped',
    });
  });

  it('退回待办后再委派同一成员：带出该成员在本任务的会话与退回理由；别的成员没有会话', () => {
    const { task } = handed('completed');
    service.reject(chatId, alice, '#1', '缺测试');
    expect(service.gate(chatId, '#1', alice, bob)).toEqual({
      ok: true,
      taskId: task.id,
      seq: 1,
      session: 'child-bob',
      returnReason: '缺测试',
    });
    expect(service.gate(chatId, '#1', alice, alice)).toEqual({
      ok: true,
      taskId: task.id,
      seq: 1,
      returnReason: '缺测试',
    });
  });

  it('旧任务没有 sessions：回退到本任务该成员最近一条执行的子会话', () => {
    const { task } = handed('failed');
    const { sessions: _sessions, ...rest } = store().find(chatId, '#1')!;
    store().save(chatId, rest);
    legacy = [
      delegation({ ...legacy[0], childConversationId: 'old' }),
      delegation({
        ...legacy[0],
        id: runId(2),
        childConversationId: 'newer',
        createdAt: 5,
        state: 'failed',
      }),
      delegation({
        ...legacy[0],
        id: runId(3),
        taskId: runId(9),
        childConversationId: 'x',
        createdAt: 9,
      }),
    ];
    expect(service.gate(chatId, '#1', alice, bob)).toMatchObject({ session: 'newer' });
    expect(task.id).toBeTruthy();
  });

  it('reject rework：交给委派服务在原会话返工，记退回理由；不带 rework 维持退回待办', () => {
    handed('completed');
    rework.mockImplementationOnce((input) => {
      service.sync(
        delegation({
          id: runId(2),
          chatId,
          parentBotId: alice,
          targetBotId: bob,
          taskId: store().find(chatId, '#1')!.id,
          childConversationId: 'child-bob',
          trigger: 'rework',
          task: input.reason,
        })
      );
      return { ok: true };
    });
    expect(
      service.tool(chatId, alice, { action: 'reject', id: '#1', reason: '缺测试', rework: true })
    ).toMatchObject({
      ok: true,
      task: { id: '#1', status: 'doing', assignee: 'Bob', returnReason: '缺测试' },
    });
    expect(rework).toHaveBeenCalledWith({
      chatId,
      delegationId: DELEGATION,
      actor: alice,
      reason: '缺测试',
    });
    expect(store().find(chatId, '#1')).toMatchObject({ delegationId: runId(2) });
    expect(systemTexts().at(-1)).toBe('Alice 退回了 #1 Login page，让 Bob 返工：缺测试');
  });

  it('reject rework 失败时任务不变；执行人不能让自己返工', () => {
    handed('completed');
    rework.mockReturnValueOnce({ ok: false, error: 'Delegation workspace unavailable.' });
    expect(service.reject(chatId, 'human', '#1', 'redo', true)).toEqual({
      ok: false,
      error: 'Delegation workspace unavailable.',
    });
    expect(store().find(chatId, '#1')).toMatchObject({ status: 'review' });
    expect(store().find(chatId, '#1')).not.toHaveProperty('returnReason');
    expect(service.reject(chatId, bob, '#1', 'redo', true)).toMatchObject({ ok: false });
    expect(rework).toHaveBeenCalledTimes(1);
  });

  it('卡住（缺信息）：时间线写缺什么；委派人给原执行人 → reply 接同一会话；旁人、执行人自己不能解除', () => {
    const { task } = handed('blocked');
    expect(store().find(chatId, '#1')).toMatchObject({
      status: 'blocked',
      blockedReason: 'need',
      blockedNeed: '数据库密码',
      blockedStreak: { [bob]: 1 },
    });
    expect(progressTexts().at(-1)).toBe('#1 卡住了，缺：数据库密码 @Alice');
    expect(service.tool(chatId, alice, { action: 'list' })).toMatchObject({
      tasks: [{ id: '#1', status: 'blocked', blockedReason: 'need', need: '数据库密码' }],
    });
    expect(service.gate(chatId, '#1', alice, bob)).toEqual({
      ok: true,
      taskId: task.id,
      seq: 1,
      trigger: 'reply',
      session: 'child-bob',
    });
    // 执行人自己 / 无关成员
    expect(service.gate(chatId, '#1', bob, bob)).toMatchObject({ ok: false });
    const c = bots.create({ name: 'Carol' }, []);
    if (!c.ok) throw new Error('bot');
    chats.update(chatId, (draft) => ({ ...draft, members: [...draft.members, c.bot.id] }));
    expect(service.gate(chatId, '#1', c.bot.id, bob)).toMatchObject({ ok: false });
    // 成员不能认领 / 完成卡住的任务；执行人自己也不能取消
    expect(service.claim(chatId, c.bot.id, '#1')).toMatchObject({ ok: false });
    expect(service.complete(chatId, bob, '#1', 'x')).toMatchObject({ ok: false });
    expect(service.cancel(chatId, bob, '#1')).toEqual({
      ok: false,
      error: 'Only the creator, the delegator or a human can cancel blocked task #1.',
    });
    // 人取消：卡住原因与连续次数一并清掉
    const canceled = service.cancel(chatId, 'human', '#1');
    expect(canceled).toMatchObject({ ok: true, task: { status: 'canceled' } });
    expect(store().find(chatId, '#1')).not.toHaveProperty('blockedReason');
    expect(store().find(chatId, '#1')).not.toHaveProperty('blockedStreak');
  });

  it('连续 3 次缺信息卡住：不再接受委派人代答，只有人能解除；执行失败的卡住不受次数影响', () => {
    handed('blocked', { blocked: { need: 'x', waitFor: 'parent', at: 2 } });
    const current = store().find(chatId, '#1')!;
    store().save(chatId, { ...current, blockedStreak: { [bob]: 3 } });
    expect(service.gate(chatId, '#1', alice, bob)).toEqual({
      ok: false,
      error:
        'Task #1 has been blocked 3 times in a row on Bob; only a human can answer it now. Ask the human in the group.',
    });
    expect(service.gate(chatId, '#1', alice, bob, true)).toMatchObject({
      ok: true,
      trigger: 'reply',
    });
    store().save(chatId, {
      ...current,
      blockedReason: 'failed',
      blockedNeed: undefined,
      blockedStreak: { [bob]: 3 },
    });
    expect(service.gate(chatId, '#1', alice, bob)).toMatchObject({ ok: true, trigger: 'retry' });
  });

  it('任务卡回复：缺信息 → 交给委派服务解除；执行失败拒绝；执行中插入当前执行；其他状态只记评论', async () => {
    const reply = vi.fn((input: { chatId: string; delegationId: string; text: string }) => {
      // 委派服务开新执行（trigger reply），落盘时同步任务
      service.sync(
        delegation({
          id: runId(5),
          chatId,
          parentBotId: alice,
          targetBotId: bob,
          taskId: store().find(chatId, '#1')!.id,
          childConversationId: 'child-bob',
          trigger: 'reply',
          task: input.text,
        })
      );
      return { ok: true as const };
    });
    const interject = vi.fn(async (_input: { delegationId: string; text: string }) => ({
      ok: true as const,
    }));
    Object.assign((service as unknown as { deps: object }).deps, { reply, interject });
    handed('blocked');
    expect(await service.reply(chatId, '#1', '  ')).toMatchObject({ ok: false });
    expect(await service.reply(chatId, '#1', '密码是 hunter2')).toMatchObject({ ok: true });
    expect(reply).toHaveBeenCalledWith({
      chatId,
      delegationId: DELEGATION,
      text: '密码是 hunter2',
    });
    expect(systemTexts().at(-1)).toBe('用户 回复了 #1 Login page：密码是 hunter2');
    expect(store().find(chatId, '#1')).toMatchObject({ status: 'doing', delegationId: runId(5) });

    handed('failed');
    expect(await service.reply(chatId, '#2', '再试试')).toEqual({
      ok: false,
      error: 'Task #2 failed to run; retry, reassign or cancel it.',
    });

    const doing = added('Docs', alice);
    const running = delegation({
      id: runId(7),
      chatId,
      parentBotId: alice,
      targetBotId: bob,
      taskId: doing.id,
      state: 'running',
    });
    legacy = [running];
    service.sync(running);
    expect(await service.reply(chatId, '#3', '顺便改下标题')).toMatchObject({ ok: true });
    expect(interject).toHaveBeenCalledWith({ delegationId: runId(7), text: '顺便改下标题' });

    added('Idle');
    expect(await service.reply(chatId, '#4', '先放着')).toMatchObject({ ok: true });
    expect(systemTexts().at(-1)).toBe('用户 评论了 #4 Idle：先放着');
    expect(reply).toHaveBeenCalledTimes(1);
    expect(interject).toHaveBeenCalledTimes(1);
  });
});

describe('公开进度 progress', () => {
  const runId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const progress = () =>
    chats.readEntries(chatId, { limit: 100 }).flatMap((entry) =>
      entry.kind === 'progress'
        ? [
            {
              phase: entry.phase,
              botId: entry.botId,
              delegationId: entry.delegationId,
              text: entry.text,
            },
          ]
        : []
    );
  beforeEach(() => vi.useFakeTimers({ now: 1_000_000 }));
  afterEach(() => vi.useRealTimers());

  /** alice 建卡委派给 bob：排队 → 开工；legacy 跟着最新记录走 */
  const begin = (over: Partial<Delegation> = {}, title = 'Login page') => {
    const task = added(title, alice);
    const queued = delegation({
      id: runId(1),
      chatId,
      parentBotId: alice,
      targetBotId: bob,
      taskId: task.id,
      childConversationId: 'child-bob',
      ...over,
    });
    legacy = [queued];
    service.sync(queued);
    const running: Delegation = { ...queued, state: 'running', startedAt: Date.now() };
    legacy = [running];
    service.sync(running);
    return { task, running };
  };
  const end = (record: Delegation, over: Partial<Delegation>) => {
    const done: Delegation = { ...record, finishedAt: Date.now(), ...over } as Delegation;
    legacy = [done];
    service.sync(done);
    return done;
  };

  it('开工延后 60 秒才写，以执行人名义；交付写结果首行前 120 字；不再写委派 / 交付的 system 行', () => {
    const { running } = begin();
    expect(progress()).toEqual([]);
    vi.advanceTimersByTime(59_999);
    expect(progress()).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(progress()).toEqual([
      { phase: 'started', botId: bob, delegationId: runId(1), text: '开工 #1『Login page』' },
    ]);
    // 同一执行再落盘（如追加）不重复写开工
    service.sync({ ...running, timeoutMinutes: 30 });
    vi.advanceTimersByTime(120_000);
    const long = `${'长'.repeat(130)}\n第二行`;
    end(running, { state: 'completed', result: `\n  ${long}` });
    expect(progress().at(-1)).toEqual({
      phase: 'delivered',
      botId: bob,
      delegationId: runId(1),
      text: `交付 #1：${'长'.repeat(120)}…`,
    });
    expect(progress()).toHaveLength(2);
    expect(systemTexts()).toEqual(['Alice 新建了任务 #1 Login page']);
    const [entry] = chats.readEntries(chatId, { limit: 100 }).filter((e) => e.kind === 'progress');
    expect(entry).toMatchObject({ taskId: store().find(chatId, '#1')?.id, taskSeq: 1 });
  });

  it('60 秒内结束的执行不发开工，只发交付', () => {
    const { running } = begin();
    vi.advanceTimersByTime(30_000);
    end(running, { state: 'completed', result: 'done' });
    vi.advanceTimersByTime(120_000);
    expect(progress()).toEqual([
      { phase: 'delivered', botId: bob, delegationId: runId(1), text: '交付 #1：done' },
    ]);
  });

  it('排队不发：一直排队的执行到点也不写开工', () => {
    const task = added('Login page', alice);
    const queued = delegation({
      id: runId(1),
      chatId,
      parentBotId: alice,
      targetBotId: bob,
      taskId: task.id,
    });
    legacy = [queued];
    service.sync(queued);
    vi.advanceTimersByTime(120_000);
    expect(progress()).toEqual([]);
  });

  it('卡住（缺信息）写缺什么并 @ 等待的人；执行失败写原因；都不再写对应 system 行', () => {
    const first = begin().running;
    end(first, { state: 'blocked', blocked: { need: '数据库密码', waitFor: 'parent', at: 2 } });
    expect(progress().at(-1)).toMatchObject({
      phase: 'blocked',
      botId: bob,
      text: '#1 卡住了，缺：数据库密码 @Alice',
    });
    const second = begin({ id: runId(2) }, 'Docs').running;
    end(second, { state: 'blocked', blocked: { need: '发布窗口', waitFor: 'human', at: 2 } });
    expect(progress().at(-1)).toMatchObject({ text: '#2 卡住了，缺：发布窗口 @用户' });
    const third = begin({ id: runId(3) }, 'Ops').running;
    end(third, { state: 'failed', failure: 'timeout' });
    expect(progress().at(-1)).toMatchObject({ phase: 'blocked', text: '#3 执行失败：超时' });
    expect(systemTexts().filter((text) => /卡住|执行失败|委派给/u.test(text))).toEqual([]);
    vi.advanceTimersByTime(120_000);
    expect(progress().filter((item) => item.phase === 'started')).toEqual([]);
  });

  it('答复 / 返工的执行开工写「接着做 #N」；重试、追加的执行不发开工，结束照发', () => {
    begin({ trigger: 'reply' });
    vi.advanceTimersByTime(60_000);
    expect(progress().at(-1)).toMatchObject({ phase: 'started', text: '接着做 #1' });
    begin({ id: runId(2), trigger: 'rework' }, 'Docs');
    vi.advanceTimersByTime(60_000);
    expect(progress().at(-1)).toMatchObject({ phase: 'started', text: '接着做 #2' });
    const retry = begin({ id: runId(3), trigger: 'retry' }, 'Ops').running;
    const append = begin({ id: runId(4), trigger: 'append' }, 'QA').running;
    legacy = [retry, append];
    vi.advanceTimersByTime(120_000);
    expect(progress().map((item) => item.delegationId)).toEqual([runId(1), runId(2)]);
    end(retry, { state: 'completed', result: 'ok' });
    expect(progress().at(-1)).toMatchObject({ delegationId: runId(3), text: '交付 #3：ok' });
  });

  it('人在任务卡答复：system 行只记答复，接着做交给进度条目', () => {
    const { running } = begin();
    end(running, { state: 'blocked', blocked: { need: '密码', waitFor: 'human', at: 2 } });
    Object.assign((service as unknown as { deps: object }).deps, {
      reply: () => {
        service.sync(
          delegation({
            id: runId(5),
            chatId,
            parentBotId: alice,
            targetBotId: bob,
            taskId: store().find(chatId, '#1')!.id,
            trigger: 'reply',
          })
        );
        return { ok: true as const };
      },
    });
    return service.reply(chatId, '#1', 'hunter2').then(() => {
      expect(systemTexts().at(-1)).toBe('用户 回复了 #1 Login page：hunter2');
    });
  });

  it('深度 2 嵌套执行只发卡住：开工、交付、失败都不发，卡住记在上层任务编号下', () => {
    const { task } = begin();
    vi.advanceTimersByTime(60_000);
    const carol = bots.create({ name: 'Carol' }, []);
    if (!carol.ok) throw new Error('bot');
    const nested = (n: number): Delegation => {
      const { taskId: _taskId, ...rest } = delegation({
        id: runId(n),
        chatId,
        parentBotId: bob,
        targetBotId: carol.bot.id,
        parentConversationId: 'child-bob',
        childConversationId: `child-carol-${n}`,
        depth: 2,
        state: 'running',
        startedAt: Date.now(),
      });
      return rest;
    };
    service.sync(nested(6), task.id);
    vi.advanceTimersByTime(120_000);
    service.sync({ ...nested(6), state: 'completed', result: 'logs ok' }, task.id);
    service.sync(nested(7), task.id);
    service.sync({ ...nested(7), state: 'failed', failure: 'error' }, task.id);
    service.sync(nested(8), task.id);
    service.sync(
      { ...nested(8), state: 'blocked', blocked: { need: 'VPN 账号', waitFor: 'parent', at: 3 } },
      task.id
    );
    expect(progress().filter((item) => item.delegationId !== runId(1))).toEqual([
      {
        phase: 'blocked',
        botId: carol.bot.id,
        delegationId: runId(8),
        text: '#1 卡住了，缺：VPN 账号 @Bob',
      },
    ]);
  });

  it('进度写到发起委派的话题', () => {
    const thread = chats.createThread(chatId)!;
    const task = added('Login page', alice);
    const record = delegation({
      id: runId(1),
      chatId: thread.id,
      parentBotId: alice,
      targetBotId: bob,
      taskId: task.id,
      state: 'running',
      startedAt: Date.now(),
    });
    legacy = [record];
    service.sync(record);
    service.sync({ ...record, state: 'completed', result: 'ok' });
    expect(
      chats.readEntries(thread.id, { limit: 10 }).filter((e) => e.kind === 'progress')
    ).toHaveLength(1);
    expect(progress()).toEqual([]);
  });
});
