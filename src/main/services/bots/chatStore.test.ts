import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BotChatStore } from './chatStore';

const BOT_A = '11111111-1111-4111-8111-111111111111';
const BOT_B = '22222222-2222-4222-8222-222222222222';

let root: string;
let store: BotChatStore;
let clock = 1000;
const now = () => ++clock;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'bot-chats-'));
  store = new BotChatStore(root, now);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function group() {
  const created = store.create({
    kind: 'group',
    title: '发布小组',
    members: [BOT_A, BOT_B],
    bossBotId: BOT_A,
    workspace: { kind: 'project', projectId: 'p1' },
  });
  if (!created) throw new Error('create failed');
  return created;
}

describe('BotChatStore chats', () => {
  it('creates, reloads and rejects invalid chats', () => {
    const chat = group();
    expect(chat).toMatchObject({
      routing: { mode: 'smart', maxHops: 4, maxTurnsPerBot: 2 },
      sessions: {},
      version: 1,
    });
    expect(new BotChatStore(root, now).get(chat.id)).toEqual(chat);
    expect(
      store.create({
        kind: 'group',
        title: 'x',
        members: [BOT_A],
        bossBotId: BOT_A,
        workspace: { kind: 'project', projectId: 'p' },
      })
    ).toBeUndefined();
  });

  it('updates through a validated mutation and bumps version', () => {
    const boss = store.create({
      kind: 'group',
      title: 'x',
      members: [BOT_A, BOT_B],
      bossBotId: BOT_A,
      workspace: { kind: 'project', projectId: 'p' },
      routing: { mode: 'boss' },
    });
    expect(boss?.routing.mode).toBe('boss');
    const chat = group();
    const updated = store.update(chat.id, (draft) => ({
      ...draft,
      sessions: { [BOT_A]: { conversationId: 'c1', cursor: 2 } },
    }));
    expect(updated).toMatchObject({
      version: 2,
      sessions: { [BOT_A]: { conversationId: 'c1', cursor: 2 } },
    });
    expect(store.update(chat.id, (draft) => ({ ...draft, members: [BOT_A] }))).toBeUndefined();
    expect(store.get(chat.id)?.members).toEqual([BOT_A, BOT_B]);
    expect(store.update(chat.id, (draft) => ({ ...draft, id: 'other' }))).toBeUndefined();
  });

  it('任务托管默认关闭，群显式开启后重载保留，私聊更新不能授权', () => {
    const chat = group();
    expect(chat).not.toHaveProperty('taskSupervision');
    expect(new BotChatStore(root, now).get(chat.id)).not.toHaveProperty('taskSupervision');
    expect(
      store.update(chat.id, (draft) => ({ ...draft, taskSupervision: true as const }))
    ).toMatchObject({ taskSupervision: true });
    expect(new BotChatStore(root, now).get(chat.id)).toMatchObject({ taskSupervision: true });
    store.update(chat.id, (draft) => ({ ...draft, taskSupervision: undefined }));
    expect(new BotChatStore(root, now).get(chat.id)).not.toHaveProperty('taskSupervision');
    const direct = store.create({
      kind: 'direct',
      title: 'd',
      members: [BOT_A],
      bossBotId: null,
      workspace: { kind: 'member-home' },
    })!;
    store.update(direct.id, (draft) => ({ ...draft, taskSupervision: true as const }));
    expect(new BotChatStore(root, now).get(direct.id)).not.toHaveProperty('taskSupervision');
  });

  it('removes the chat directory', () => {
    const chat = group();
    store.appendEntry(chat.id, { id: 'e1', at: 1, kind: 'system', text: 'hi' });
    expect(store.remove(chat.id)).toBe(true);
    expect(store.get(chat.id)).toBeUndefined();
    expect(store.readEntries(chat.id)).toEqual([]);
  });

  it('新建的群与话题带 autoTitle 标记，私聊不带；旧数据（无标记）重载后仍不带', () => {
    const chat = group();
    expect(chat.autoTitle).toEqual({ seq: 0 });
    expect(store.createThread(chat.id)?.autoTitle).toEqual({ seq: 0 });
    const direct = store.create({
      kind: 'direct',
      title: 'd',
      members: [BOT_A],
      bossBotId: null,
      workspace: { kind: 'member-home' },
    })!;
    expect(direct).not.toHaveProperty('autoTitle');
    const legacy = store.update(chat.id, (draft) => {
      delete draft.autoTitle;
      return draft;
    })!;
    expect(legacy).not.toHaveProperty('autoTitle');
    expect(new BotChatStore(root, now).get(chat.id)).not.toHaveProperty('autoTitle');
  });
});

describe('BotChatStore threads', () => {
  it('任务托管随根群同步已有与新话题，但不影响另一群，话题不能自行开启或关闭', () => {
    const parent = group();
    const thread = store.createThread(parent.id)!;
    const other = group();
    const otherThread = store.createThread(other.id)!;
    expect(thread).not.toHaveProperty('taskSupervision');
    store.update(thread.id, (draft) => ({ ...draft, taskSupervision: true as const }));
    expect(store.get(thread.id)).not.toHaveProperty('taskSupervision');
    expect(store.get(parent.id)).not.toHaveProperty('taskSupervision');

    store.update(parent.id, (draft) => ({ ...draft, taskSupervision: true as const }));
    expect(store.get(thread.id)).toMatchObject({ taskSupervision: true });
    const newThread = store.createThread(parent.id)!;
    expect(newThread).toMatchObject({ taskSupervision: true });
    store.update(thread.id, (draft) => ({ ...draft, taskSupervision: undefined }));
    expect(store.get(thread.id)).toMatchObject({ taskSupervision: true });
    expect(store.get(parent.id)).toMatchObject({ taskSupervision: true });
    expect(store.get(other.id)).not.toHaveProperty('taskSupervision');
    expect(store.get(otherThread.id)).toEqual(otherThread);
    const enabled = new BotChatStore(root, now);
    expect(enabled.get(parent.id)).toMatchObject({ taskSupervision: true });
    expect(enabled.get(thread.id)).toMatchObject({ taskSupervision: true });
    expect(enabled.get(newThread.id)).toMatchObject({ taskSupervision: true });

    store.update(parent.id, (draft) => ({ ...draft, taskSupervision: undefined }));
    const disabled = new BotChatStore(root, now);
    for (const id of [parent.id, thread.id, newThread.id])
      expect(disabled.get(id)).not.toHaveProperty('taskSupervision');
    expect(disabled.get(otherThread.id)).toEqual(otherThread);
  });

  it('建话题：复制根群配置、独立时间线与会话，只能挂在根群下', () => {
    const parent = group();
    store.update(parent.id, (draft) => {
      draft.sessions[BOT_A] = { conversationId: 'c1', cursor: 1 };
      return draft;
    });
    store.appendEntry(parent.id, { id: 'r1', at: 1, kind: 'system', text: 'root' });
    const thread = store.createThread(parent.id, '  发布清单 ');
    expect(thread).toMatchObject({
      kind: 'group',
      parentId: parent.id,
      threadTitle: '发布清单',
      title: parent.title,
      members: parent.members,
      bossBotId: parent.bossBotId,
      workspace: parent.workspace,
      routing: parent.routing,
      sessions: {},
    });
    expect(thread!.id).not.toBe(parent.id);
    expect(store.appendEntry(thread!.id, { id: 't1', at: 1, kind: 'system', text: 'x' })?.seq).toBe(
      1
    );
    expect(store.readEntries(parent.id).map((e) => e.id)).toEqual(['r1']);
    expect(store.createThread(thread!.id)).toBeUndefined();
    const direct = store.create({
      kind: 'direct',
      title: 'd',
      members: [BOT_A],
      bossBotId: null,
      workspace: { kind: 'member-home' },
    })!;
    expect(store.createThread(direct.id)).toBeUndefined();
    expect(store.createThread('nope')).toBeUndefined();
  });

  it('根群改配置级联到话题；话题自身改不动群配置', () => {
    const parent = group();
    const thread = store.createThread(parent.id)!;
    store.update(thread.id, (draft) => {
      draft.sessions[BOT_B] = { conversationId: 'c2', cursor: 0 };
      return draft;
    });
    store.update(parent.id, (draft) => ({
      ...draft,
      title: '新名字',
      bossBotId: BOT_B,
      routing: { ...draft.routing, mode: 'boss' },
      workspace: { kind: 'project', projectId: 'p2' },
      archivedAt: 5,
    }));
    expect(store.get(thread.id)).toMatchObject({
      title: '新名字',
      bossBotId: BOT_B,
      routing: { mode: 'boss' },
      workspace: { kind: 'project', projectId: 'p2' },
      archivedAt: 5,
      sessions: { [BOT_B]: { conversationId: 'c2', cursor: 0 } },
    });
    store.update(parent.id, (draft) => {
      delete draft.archivedAt;
      return draft;
    });
    expect(store.get(thread.id)).not.toHaveProperty('archivedAt');
    store.update(thread.id, (draft) => ({ ...draft, title: 'x', bossBotId: BOT_A }));
    expect(store.get(thread.id)).toMatchObject({ title: '新名字', bossBotId: BOT_B });
    expect(new BotChatStore(root, now).get(thread.id)).toMatchObject({ title: '新名字' });
  });

  it('话题列表、根群与当前话题；孤儿话题重启后不加载', () => {
    const parent = group();
    const first = store.createThread(parent.id)!;
    const second = store.createThread(parent.id)!;
    expect(store.threadsOf(parent.id).map((c) => c.id)).toEqual([parent.id, first.id, second.id]);
    expect(store.threadsOf(first.id)).toEqual([]);
    expect(store.rootOf(second.id)?.id).toBe(parent.id);
    expect(store.rootOf(parent.id)?.id).toBe(parent.id);
    expect(store.activeThread(parent.id)?.id).toBe(parent.id);
    store.update(parent.id, (draft) => ({ ...draft, activeThreadId: second.id }));
    expect(store.activeThread(parent.id)?.id).toBe(second.id);
    store.remove(second.id);
    expect(store.activeThread(parent.id)?.id).toBe(parent.id);

    store.remove(parent.id);
    const reloaded = new BotChatStore(root, now);
    expect(reloaded.get(first.id)).toBeUndefined();
  });

  it('根群会话 cursor 或当前话题变化不重写其他话题', () => {
    const parent = group();
    const thread = store.createThread(parent.id)!;
    store.update(parent.id, (draft) => ({
      ...draft,
      sessions: { [BOT_A]: { conversationId: 'c1', cursor: 10 } },
      activeThreadId: thread.id,
    }));
    expect(store.get(thread.id)).toEqual(thread);
    expect(new BotChatStore(root, now).get(thread.id)).toEqual(thread);
  });
});

describe('BotChatStore timeline', () => {
  it('assigns increasing seq that survives restart', () => {
    const chat = group();
    const first = store.appendEntry(chat.id, {
      id: 'e1',
      at: 1,
      kind: 'human',
      text: 'hi',
      mentions: [],
    });
    const second = store.appendEntry(chat.id, { id: 'e2', at: 2, kind: 'system', text: 'x' });
    expect([first?.seq, second?.seq]).toEqual([1, 2]);

    const reloaded = new BotChatStore(root, now);
    expect(reloaded.lastSeq(chat.id)).toBe(2);
    expect(reloaded.appendEntry(chat.id, { id: 'e3', at: 3, kind: 'system', text: 'y' })?.seq).toBe(
      3
    );
  });

  it('rejects invalid entries and unknown chats', () => {
    const chat = group();
    expect(
      store.appendEntry(chat.id, { id: '', at: 1, kind: 'system', text: 'x' })
    ).toBeUndefined();
    expect(
      store.appendEntry('77777777-7777-4777-8777-777777777777', {
        id: 'e',
        at: 1,
        kind: 'system',
        text: 'x',
      })
    ).toBeUndefined();
    expect(store.lastSeq(chat.id)).toBe(0);
  });

  it('tolerates corrupt and truncated lines', () => {
    const chat = group();
    store.appendEntry(chat.id, { id: 'e1', at: 1, kind: 'system', text: 'a' });
    appendFileSync(
      join(root, chat.id, 'timeline.jsonl'),
      'garbage\n{"seq":2,"id":"e2","at":2,"kind":"sys'
    );

    const reloaded = new BotChatStore(root, now);
    expect(reloaded.lastSeq(chat.id)).toBe(1);
    expect(reloaded.appendEntry(chat.id, { id: 'e3', at: 3, kind: 'system', text: 'c' })?.seq).toBe(
      2
    );
    expect(reloaded.readEntries(chat.id).map((entry) => entry.id)).toEqual(['e1', 'e3']);
  });

  it('pages backwards by seq', () => {
    const chat = group();
    for (let i = 1; i <= 5; i++)
      store.appendEntry(chat.id, { id: `e${i}`, at: i, kind: 'system', text: String(i) });
    expect(store.readEntries(chat.id, { limit: 2 }).map((entry) => entry.seq)).toEqual([4, 5]);
    expect(
      store.readEntries(chat.id, { beforeSeq: 4, limit: 2 }).map((entry) => entry.seq)
    ).toEqual([2, 3]);
    expect(
      store.readEntries(chat.id, { beforeSeq: 2, limit: 10 }).map((entry) => entry.seq)
    ).toEqual([1]);
  });

  it('reads across chunk boundaries with multi-byte text and a torn tail', () => {
    const small = new BotChatStore(root, now, { chunkSize: 7 });
    const chat = small.create({
      kind: 'group',
      title: 't',
      members: [BOT_A, BOT_B],
      bossBotId: BOT_A,
      workspace: { kind: 'project', projectId: 'p' },
    });
    if (!chat) throw new Error('create failed');
    for (let i = 1; i <= 6; i++)
      small.appendEntry(chat.id, { id: `e${i}`, at: i, kind: 'system', text: `中文消息${i}🙂` });
    appendFileSync(join(root, chat.id, 'timeline.jsonl'), '{"seq":7,"id":"e7","at":7,"ki');
    const reloaded = new BotChatStore(root, now, { chunkSize: 5 });
    expect(reloaded.lastSeq(chat.id)).toBe(6);
    expect(
      reloaded
        .readEntries(chat.id, { limit: 3 })
        .map((entry) => entry.kind === 'system' && entry.text)
    ).toEqual(['中文消息4🙂', '中文消息5🙂', '中文消息6🙂']);
    expect(reloaded.readAfter(chat.id, 4).map((entry) => entry.seq)).toEqual([5, 6]);
    expect(reloaded.appendEntry(chat.id, { id: 'e8', at: 8, kind: 'system', text: 'x' })?.seq).toBe(
      7
    );
    expect(reloaded.readEntries(chat.id, { limit: 2 }).map((entry) => entry.id)).toEqual([
      'e6',
      'e8',
    ]);
  });

  it('reads only entries after a seq, falling back to the latest page when the gap is too large', () => {
    const chat = group();
    for (let i = 1; i <= 8; i++)
      store.appendEntry(chat.id, { id: `e${i}`, at: i, kind: 'system', text: String(i) });
    expect(store.readSince(chat.id, 6, 3).map((entry) => entry.seq)).toEqual([7, 8]);
    expect(store.readSince(chat.id, 8, 3)).toEqual([]);
    expect(store.readSince(chat.id, 1, 3).map((entry) => entry.seq)).toEqual([6, 7, 8]);
  });

  it('indexes entry ids for dedupe and lookup, surviving restart and appends', () => {
    const chat = group();
    store.appendEntry(chat.id, { id: 'delegation:d1', at: 1, kind: 'system', text: 'a' });
    store.appendEntry(chat.id, { id: 'e2', at: 2, kind: 'system', text: 'b' });
    expect(store.hasEntry(chat.id, 'delegation:d1')).toBe(true);
    expect(store.hasEntry(chat.id, 'nope')).toBe(false);
    store.appendEntry(chat.id, { id: 'e3', at: 3, kind: 'system', text: 'c' });
    expect(store.findEntry(chat.id, 'e3')).toMatchObject({ seq: 3, text: 'c' });

    const reloaded = new BotChatStore(root, now);
    expect(reloaded.hasEntry(chat.id, 'delegation:d1')).toBe(true);
    expect(reloaded.findEntry(chat.id, 'e2')).toMatchObject({ seq: 2, text: 'b' });
    expect(reloaded.findEntry(chat.id, 'missing')).toBeUndefined();
    reloaded.appendEntry(chat.id, { id: 'e4', at: 4, kind: 'system', text: 'd' });
    expect(reloaded.findEntry(chat.id, 'e4')).toMatchObject({ seq: 4 });
  });

  it('builds the dedupe index only after the new-conversation divider; old lookups still work', () => {
    const small = new BotChatStore(root, now, { chunkSize: 11 });
    const chat = small.create({
      kind: 'group',
      title: 't',
      members: [BOT_A, BOT_B],
      bossBotId: BOT_A,
      workspace: { kind: 'project', projectId: 'p' },
    });
    if (!chat) throw new Error('create failed');
    for (let i = 1; i <= 5; i++)
      small.appendEntry(chat.id, { id: `e${i}`, at: i, kind: 'system', text: `旧${i}` });
    small.update(chat.id, (draft) => ({ ...draft, epochSeq: 3 }));

    const reloaded = new BotChatStore(root, now, { chunkSize: 11 });
    expect(reloaded.get(chat.id)?.epochSeq).toBe(3);
    expect(reloaded.hasEntry(chat.id, 'e5')).toBe(true);
    expect(reloaded.hasEntry(chat.id, 'e4')).toBe(true);
    expect(reloaded.hasEntry(chat.id, 'e3')).toBe(false);
    expect(reloaded.hasEntry(chat.id, 'e1')).toBe(false);
    expect(reloaded.findEntry(chat.id, 'e2')).toMatchObject({ seq: 2, text: '旧2' });
    expect(reloaded.findEntry(chat.id, 'e3')).toMatchObject({ seq: 3 });
    expect(reloaded.hasEntry(chat.id, 'e1')).toBe(true);
    reloaded.appendEntry(chat.id, { id: 'e6', at: 6, kind: 'system', text: 'x' });
    expect(reloaded.findEntry(chat.id, 'e6')).toMatchObject({ seq: 6 });
    expect(reloaded.findEntry(chat.id, 'missing')).toBeUndefined();
  });

  it('reads backward down to a lower bound', () => {
    const chat = group();
    for (let i = 1; i <= 6; i++)
      store.appendEntry(chat.id, { id: `e${i}`, at: i, kind: 'system', text: String(i) });
    expect([...store.backward(chat.id, undefined, 3)].map((e) => e.seq)).toEqual([6, 5, 4]);
    expect([...store.backward(chat.id, undefined, 6)]).toEqual([]);
    expect(store.readAfter(chat.id, 4).map((e) => e.seq)).toEqual([5, 6]);
  });

  it('scans the whole timeline asynchronously in batches', async () => {
    const chat = group();
    for (let i = 1; i <= 5; i++)
      store.appendEntry(chat.id, { id: `e${i}`, at: i, kind: 'system', text: String(i) });
    const seqs: number[] = [];
    for await (const batch of store.scanEntries(chat.id)) seqs.push(...batch.map((e) => e.seq));
    expect(seqs).toEqual([1, 2, 3, 4, 5]);
  });

  it('deep pages stay identical once seq checkpoints are learned', () => {
    const small = new BotChatStore(root, now, { chunkSize: 97 });
    const chat = small.create({
      kind: 'group',
      title: 't',
      members: [BOT_A, BOT_B],
      bossBotId: BOT_A,
      workspace: { kind: 'project', projectId: 'p' },
    });
    if (!chat) throw new Error('create failed');
    for (let i = 1; i <= 700; i++)
      small.appendEntry(chat.id, { id: `e${i}`, at: i, kind: 'system', text: `第${i}条` });
    const page = (store: BotChatStore, beforeSeq: number) =>
      store.readEntries(chat.id, { beforeSeq, limit: 7 }).map((entry) => entry.seq);
    // 先整段倒读一遍，学到检查点
    expect(small.readEntries(chat.id, { limit: 1000 })).toHaveLength(700);
    for (const before of [701, 700, 513, 512, 511, 257, 256, 129, 128, 8, 2, 1])
      expect(page(small, before)).toEqual(page(new BotChatStore(root, now), before));
    small.appendEntry(chat.id, { id: 'tail', at: 1, kind: 'system', text: 'x' });
    expect(page(small, 702)).toEqual([695, 696, 697, 698, 699, 700, 701]);
    expect(page(small, 300)).toEqual([293, 294, 295, 296, 297, 298, 299]);
  });

  it('tail-reads a 50k-entry timeline without loading it all', () => {
    const chat = group();
    const file = join(root, chat.id, 'timeline.jsonl');
    const lines: string[] = [];
    for (let seq = 1; seq <= 50_000; seq++)
      lines.push(
        JSON.stringify({
          seq,
          id: `e${seq}`,
          at: seq,
          kind: 'system',
          text: `消息 ${seq} `.repeat(8),
        })
      );
    writeFileSync(file, `${lines.join('\n')}\n`);
    const reloaded = new BotChatStore(root, now);
    const started = performance.now();
    expect(reloaded.lastSeq(chat.id)).toBe(50_000);
    expect(reloaded.readEntries(chat.id, { limit: 50 }).map((e) => e.seq)).toEqual(
      Array.from({ length: 50 }, (_, i) => 49_951 + i)
    );
    expect(
      reloaded.readEntries(chat.id, { beforeSeq: 49_901, limit: 2 }).map((e) => e.seq)
    ).toEqual([49_899, 49_900]);
    expect(reloaded.readAfter(chat.id, 49_990)).toHaveLength(10);
    expect(
      reloaded.appendEntry(chat.id, { id: 'new', at: 1, kind: 'system', text: 'x' })?.seq
    ).toBe(50_001);
    const tail = performance.now() - started;
    const fullStarted = performance.now();
    expect(reloaded.readEntries(chat.id, { beforeSeq: 3, limit: 5 }).map((e) => e.seq)).toEqual([
      1, 2,
    ]);
    const full = performance.now() - fullStarted;
    // 绝对上界留给负载较高的 CI；相对上界确认尾部读取不随文件大小增长
    expect(tail).toBeLessThan(500);
    expect(tail * 5).toBeLessThan(full);
    expect(reloaded.findEntry(chat.id, 'e123')).toMatchObject({ seq: 123 });
  });
});
