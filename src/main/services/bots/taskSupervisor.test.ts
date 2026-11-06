import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Delegation, GroupEntry, GroupTask } from '../../../shared/types/bot';
import type { BotSilence } from '../../../shared/types/botIpc';
import { BotStore } from './botStore';
import { BotChatStore } from './chatStore';
import type { GroupTaskService } from './groupTasks';
import { parseTaskFollowup, TaskSupervisor } from './taskSupervisor';

let dir: string;
beforeEach(() => {
  vi.useFakeTimers();
  dir = mkdtempSync(join(tmpdir(), 'task-supervisor-'));
});
afterEach(() => {
  vi.useRealTimers();
  rmSync(dir, { recursive: true, force: true });
});

function fixture() {
  const bots = new BotStore(join(dir, 'bots'));
  const a = bots.create({ name: 'Alice' }, []);
  const b = bots.create({ name: 'Bob' }, []);
  if (!a.ok || !b.ok) throw new Error('fixture');
  const chats = new BotChatStore(join(dir, 'chats'));
  const chat = chats.create({
    kind: 'group',
    title: 'Team',
    members: [a.bot.id, b.bot.id],
    bossBotId: a.bot.id,
    workspace: { kind: 'chat-home', projectId: 'p' },
  })!;
  chats.update(chat.id, (draft) => ({ ...draft, taskSupervision: true }));
  const task: GroupTask = {
    id: '11111111-1111-4111-8111-111111111111',
    seq: 1,
    title: 'Login',
    status: 'doing',
    createdBy: a.bot.id,
    assigneeBotId: b.bot.id,
    delegationId: 'run',
    createdAt: 1,
    updatedAt: 1,
  };
  const record: Delegation = {
    id: 'run',
    taskId: task.id,
    chatId: chat.id,
    parentBotId: a.bot.id,
    targetBotId: b.bot.id,
    parentConversationId: 'parent',
    childConversationId: 'child',
    task: 'Fix login',
    context: '',
    state: 'running',
    depth: 1,
    createdAt: 1,
  };
  let silences: BotSilence[] = [];
  const reply = vi.fn(async (..._args: Parameters<GroupTaskService['reply']>) => ({
    ok: true as const,
    task,
  }));
  const emit = vi.fn();
  const notify = vi.fn();
  const taskStore = {
    list: (id: string) => (id === chat.id ? [task] : []),
    find: (id: string, ref: string) =>
      id === chat.id && ref === `#${task.seq}` ? task : undefined,
  };
  const delegations = { get: (id: string) => (id === record.id ? record : undefined) };
  const supervisor = new TaskSupervisor({
    chats,
    bots,
    taskStore,
    replyTask: reply,
    delegations,
    silences: () => silences,
    emit,
    notify,
  });
  const entry = (text = '#1 只修 Safari'): Extract<GroupEntry, { kind: 'human' }> => ({
    id: 'human:delivery',
    seq: 1,
    at: 1,
    kind: 'human',
    text,
    mentions: [],
  });
  return {
    chats,
    bots,
    chat,
    task,
    record,
    reply,
    emit,
    notify,
    supervisor,
    taskStore,
    delegations,
    entry,
    silence: () => {
      silences = [{ conversationId: 'child', botId: b.bot.id, chatId: chat.id, since: 1 }];
    },
  };
}

describe('明确任务引用，不猜测消息归属', () => {
  it.each(['#1 只修 Safari', '任务 #1：只修 Safari', 'task #1: Safari only'])('%s', (text) => {
    expect(parseTaskFollowup(text)).toMatchObject({ seq: 1 });
  });
  it.each(['按钮颜色改成 #2563eb', '顺便看下 issue #12', '看下 (Issue #12) 里的备注'])(
    '正文里的非任务引用原样直通：%s',
    (text) => expect(parseTaskFollowup(`#3 ${text}`)).toEqual({ seq: 3, text })
  );
  it.each([
    '#1',
    '#0 x',
    '#01 x',
    '#1 和 #2 一起做',
    '#1 顺便处理任务#2：补上用例',
    '#1 先看 issue #12，再处理 #2',
    '比较 #1 的结果',
    'https://host/#1 x',
    '```\n#1 code\n```',
    '#1abc x',
    '#999999999999999999 x',
  ])('不把 %s 当成可直通的补充', (text) => expect(parseTaskFollowup(text)).toBeUndefined());

  it('补充送进原任务会话，并携带稳定投递身份', async () => {
    const f = fixture();
    expect(await f.supervisor.route(f.chat.id, f.entry())).toMatchObject({ ok: true });
    expect(f.reply).toHaveBeenCalledWith(f.chat.id, f.task.id, '只修 Safari', {
      deliveryId: expect.stringMatching(/^task-followup:[a-f0-9]{64}$/u),
    });
  });

  it('最长人类投递身份仍满足 worker 上限，跨话题的同名消息互不去重', async () => {
    const f = fixture();
    const entry = { ...f.entry(), id: `human:${'a'.repeat(128)}` };
    const thread = f.chats.createThread(f.chat.id)!;
    await f.supervisor.route(f.chat.id, entry);
    await f.supervisor.route(thread.id, entry);
    const ids = f.reply.mock.calls.map((call) => call[3]!.deliveryId);
    expect(ids.every((id) => id.length <= 128)).toBe(true);
    expect(new Set(ids).size).toBe(2);
  });

  it('定向补充只读取本群一张原始任务和对应委派，不派生历史或克隆全集', async () => {
    const f = fixture();
    const allTasks = vi.spyOn(f.taskStore, 'list');
    const task = vi.spyOn(f.taskStore, 'find');
    const record = vi.spyOn(f.delegations, 'get');
    await f.supervisor.route(f.chat.id, f.entry());
    expect(allTasks).not.toHaveBeenCalled();
    expect(task).toHaveBeenCalledExactlyOnceWith(f.chat.id, '#1');
    expect(record).toHaveBeenCalledExactlyOnceWith(f.task.delegationId);
    expect(f.reply).toHaveBeenCalledTimes(1);
  });

  it.each([
    'disabled',
    'archived',
    'todo',
    'done',
    'review',
    'canceled',
    'failed',
    'removed',
    'wrong-task',
    'foreign-group',
  ] as const)('%s 时不启动或复活任务', async (state) => {
    const f = fixture();
    if (state === 'disabled')
      f.chats.update(f.chat.id, (chat) => {
        delete chat.taskSupervision;
        return chat;
      });
    if (state === 'archived') f.chats.update(f.chat.id, (chat) => ({ ...chat, archivedAt: 1 }));
    if (['todo', 'done', 'review', 'canceled'].includes(state))
      f.task.status = state as GroupTask['status'];
    if (state === 'failed') {
      f.task.status = 'blocked';
      f.task.blockedReason = 'failed';
      f.record.state = 'failed';
    }
    if (state === 'removed')
      f.chats.update(f.chat.id, (chat) => ({
        ...chat,
        members: [f.record.parentBotId, '22222222-2222-4222-8222-222222222222'],
      }));
    if (state === 'wrong-task') f.record.taskId = 'other';
    if (state === 'foreign-group') f.record.chatId = 'missing';
    const result = await f.supervisor.route(f.chat.id, f.entry());
    if (state === 'disabled' || state === 'archived') expect(result).toBeUndefined();
    else {
      expect(result).toEqual({ ok: true });
      expect(f.chats.readEntries(f.chat.id).at(-1)).toMatchObject({ kind: 'system' });
    }
    expect(f.reply).not.toHaveBeenCalled();
  });

  it('同根群的另一个话题可补充原任务，其他群不能借编号串线', async () => {
    const f = fixture();
    const thread = f.chats.createThread(f.chat.id)!;
    expect(await f.supervisor.route(thread.id, f.entry())).toMatchObject({ ok: true });
    const other = f.chats.create({
      kind: 'group',
      title: 'Other',
      members: f.chat.members,
      bossBotId: f.chat.bossBotId,
      workspace: f.chat.workspace,
    })!;
    f.chats.update(other.id, (chat) => ({ ...chat, taskSupervision: true }));
    expect(await f.supervisor.route(other.id, f.entry())).toEqual({ ok: true });
    expect(f.chats.readEntries(other.id).at(-1)).toMatchObject({ kind: 'system' });
    expect(f.reply).toHaveBeenCalledTimes(1);
  });

  it('待人回答的任务继续走原有 reply 权限和连续卡住限制', async () => {
    const f = fixture();
    f.task.status = 'blocked';
    f.task.blockedReason = 'need';
    f.record.state = 'blocked';
    expect(await f.supervisor.route(f.chat.id, f.entry())).toMatchObject({ ok: true });
    expect(f.reply).toHaveBeenCalledTimes(1);
  });

  it('明确 @、附件与聊天/技能引用保留普通群路由，不丢输入', async () => {
    const f = fixture();
    for (const entry of [
      { ...f.entry(), mentions: [f.record.parentBotId] },
      { ...f.entry(), images: ['image-id'] },
      { ...f.entry(), refs: { skill: 'test' } },
      { ...f.entry(), refs: { task: f.task.id } },
    ])
      expect(await f.supervisor.route(f.chat.id, entry)).toBeUndefined();
    expect(f.reply).not.toHaveBeenCalled();
  });

  it('投递失败写时间线提醒，已持久化的原消息不再要求客户端重发', async () => {
    const f = fixture();
    f.reply.mockRejectedValueOnce(new Error('offline'));
    expect(await f.supervisor.route(f.chat.id, f.entry())).toEqual({ ok: true });
    expect(f.chats.readEntries(f.chat.id).at(-1)).toMatchObject({
      kind: 'system',
      text: expect.stringContaining('#1'),
    });
  });
});

describe('Main 侧看护，不自动重放有副作用的工作', () => {
  it('未挂委派的旧任务不补 runs，巡检只读取当前任务绑定的委派', () => {
    const f = fixture();
    f.silence();
    const list = vi.spyOn(f.taskStore, 'list').mockReturnValue([
      ...Array.from({ length: 1000 }, (_, index) => ({
        ...f.task,
        id: `legacy-${index}`,
        delegationId: undefined,
      })),
      f.task,
    ]);
    const get = vi.spyOn(f.delegations, 'get');
    f.supervisor.sweep();
    expect(list).toHaveBeenCalledExactlyOnceWith(f.chat.id);
    expect(get).toHaveBeenCalledExactlyOnceWith(f.record.id);
    expect(f.notify).toHaveBeenCalledTimes(1);
  });

  it('销毁取消尚未触发的巡检，不在之后扫描或发通知', async () => {
    const f = fixture();
    f.silence();
    const list = vi.spyOn(f.chats, 'list');
    f.supervisor.scheduleSweep();
    f.supervisor.dispose();
    await vi.advanceTimersByTimeAsync(2000);
    expect(list).not.toHaveBeenCalled();
    expect(f.notify).not.toHaveBeenCalled();
  });
  it('跨异步事件的突发更新在最后一次变更后只巡检一次', async () => {
    const f = fixture();
    const list = vi.spyOn(f.chats, 'list');
    f.silence();
    f.supervisor.scheduleSweep();
    await vi.advanceTimersByTimeAsync(350);
    f.supervisor.scheduleSweep();
    await vi.advanceTimersByTimeAsync(350);
    f.supervisor.scheduleSweep();
    await vi.advanceTimersByTimeAsync(749);
    expect(list).not.toHaveBeenCalled();
    expect(f.notify).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(list).toHaveBeenCalledTimes(1);
    expect(f.notify).toHaveBeenCalledTimes(1);
  });

  it('提醒落盘失败不能中断任务主链路，下次巡检仍可补发', () => {
    const f = fixture();
    f.silence();
    const append = vi.spyOn(f.chats, 'appendEntry').mockImplementationOnce(() => {
      throw new Error('disk unavailable');
    });
    expect(() => f.supervisor.sweep()).not.toThrow();
    expect(f.notify).not.toHaveBeenCalled();
    append.mockRestore();
    f.supervisor.sweep();
    expect(f.notify).toHaveBeenCalledTimes(1);
  });
  it('中断只提醒确认恢复；跨重建和重复事件只通知一次', () => {
    const f = fixture();
    f.task.status = 'blocked';
    f.task.blockedReason = 'failed';
    f.record.state = 'failed';
    f.record.failure = 'interrupted';
    f.supervisor.sweep();
    f.supervisor.sweep();
    expect(f.reply).not.toHaveBeenCalled();
    expect(f.notify).toHaveBeenCalledTimes(1);
    const boundary = f.chats.appendEntry(f.chat.id, {
      kind: 'system',
      id: 'new-conversation',
      at: 2,
      text: '新对话',
      newConversation: true,
    })!;
    f.chats.update(f.chat.id, (chat) => ({ ...chat, epochSeq: boundary.seq }));
    const reloaded = new BotChatStore(join(dir, 'chats'));
    const another = new TaskSupervisor({
      chats: reloaded,
      bots: f.bots,
      taskStore: f.taskStore,
      replyTask: f.reply,
      delegations: f.delegations,
      silences: () => [],
      emit: f.emit,
      notify: f.notify,
    });
    another.sweep();
    expect(f.notify).toHaveBeenCalledTimes(1);
    expect(reloaded.readEntries(f.chat.id)).toHaveLength(2);
  });

  it('静默只提醒，不停止、不重试；结束/取消/旧执行不再提醒', () => {
    const f = fixture();
    f.silence();
    f.supervisor.sweep();
    f.supervisor.sweep();
    expect(f.notify).toHaveBeenCalledTimes(1);
    expect(f.reply).not.toHaveBeenCalled();
    f.task.status = 'done';
    f.record.id = 'old';
    f.supervisor.sweep();
    expect(f.notify).toHaveBeenCalledTimes(1);
  });

  it('只在显式开启、未归档的群里巡检；关闭和 dispose 后不再动作', async () => {
    const f = fixture();
    f.silence();
    f.chats.update(f.chat.id, (chat) => {
      delete chat.taskSupervision;
      return chat;
    });
    f.supervisor.start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.notify).not.toHaveBeenCalled();
    f.chats.update(f.chat.id, (chat) => ({ ...chat, taskSupervision: true }));
    f.supervisor.dispose();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.notify).not.toHaveBeenCalled();
    expect(await f.supervisor.route(f.chat.id, f.entry())).toBeUndefined();
  });
});
