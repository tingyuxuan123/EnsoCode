import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BOT_NOTES_MAX_CHARS } from '@shared/bots/notes';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BotNotesStore } from './botNotes';
import { BotStore } from './botStore';
import { BotChatStore } from './chatStore';

let root: string;
let bots: BotStore;
let chats: BotChatStore;
let store: BotNotesStore;
let botId: string;
let chatId: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'bot-notes-'));
  bots = new BotStore(join(root, 'bots'));
  chats = new BotChatStore(join(root, 'bot-chats'));
  store = new BotNotesStore({ bots: join(root, 'bots'), chats: join(root, 'bot-chats') });
  const bot = bots.create({ name: 'Alice' }, []);
  if (!bot.ok) throw new Error('fixture');
  botId = bot.bot.id;
  const bob = bots.create({ name: 'Bob' }, []);
  if (!bob.ok) throw new Error('fixture');
  chatId = chats.create({
    kind: 'group',
    title: 'Team',
    members: [botId, bob.bot.id],
    bossBotId: botId,
    workspace: { kind: 'chat-home', projectId: 'home' },
  })!.id;
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('BotNotesStore', () => {
  it('truncates on write, versions by content and rejects stale versions', () => {
    const empty = store.read({ kind: 'bot', id: botId });
    expect(empty.content).toBe('');
    const saved = store.write({ kind: 'bot', id: botId }, 'x'.repeat(5000), empty.version);
    if (!saved.ok) throw new Error(saved.error);
    expect(saved.notes.content).toHaveLength(BOT_NOTES_MAX_CHARS);
    expect(store.read({ kind: 'bot', id: botId })).toEqual(saved.notes);
    expect(saved.notes.version).not.toBe(empty.version);
    expect(store.write({ kind: 'bot', id: botId }, 'other', empty.version)).toMatchObject({
      ok: false,
      error: 'conflict',
    });
    expect(store.read({ kind: 'bot', id: botId }).content).toHaveLength(BOT_NOTES_MAX_CHARS);
  });

  it('stores member and group notes in their own directories and is cleaned up with them', () => {
    const member = store.write({ kind: 'bot', id: botId }, 'likes tea');
    const group = store.write({ kind: 'chat', id: chatId }, 'standup at 10');
    expect(member.ok && group.ok).toBe(true);
    const memberFile = join(root, 'bots', botId, 'notes.md');
    const groupFile = join(root, 'bot-chats', chatId, 'notes.md');
    expect(existsSync(memberFile)).toBe(true);
    expect(existsSync(groupFile)).toBe(true);
    chats.remove(chatId);
    bots.remove(botId);
    expect(existsSync(memberFile)).toBe(false);
    expect(existsSync(groupFile)).toBe(false);
    // 删除后不再重新建目录
    expect(store.write({ kind: 'bot', id: botId }, 'late')).toMatchObject({
      ok: false,
      error: 'not-found',
    });
    expect(existsSync(join(root, 'bots', botId))).toBe(false);
  });
});
