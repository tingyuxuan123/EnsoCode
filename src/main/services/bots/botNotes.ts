import { createHash } from 'node:crypto';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { BOT_NOTES_MAX_CHARS } from '@shared/bots/notes';
import { writeAtomic } from './files';

export type BotNotesTarget = { kind: 'bot' | 'chat'; id: string };
export interface BotNotes {
  content: string;
  version: string;
}
export type BotNotesWrite =
  | { ok: true; notes: BotNotes }
  | { ok: false; error: 'conflict' | 'not-found' };
const versionOf = (content: string) =>
  createHash('sha256').update(content).digest('hex').slice(0, 16);
const clamp = (content: string) => content.trim().slice(0, BOT_NOTES_MAX_CHARS).trimEnd();

/** 成员笔记 bots/<botId>/notes.md，群笔记 bot-chats/<chatId>/notes.md；随所属目录一起删除 */
export class BotNotesStore {
  constructor(private readonly roots: { bots: string; chats: string }) {}

  read(target: BotNotesTarget): BotNotes {
    let content = '';
    try {
      content = readFileSync(this.file(target), 'utf8');
    } catch {
      /* 还没有笔记 */
    }
    return { content, version: versionOf(content) };
  }

  /** expectedVersion 给出时必须与当前一致；所属目录已删除则不重建 */
  write(target: BotNotesTarget, content: string, expectedVersion?: string): BotNotesWrite {
    if (!existsSync(this.dir(target))) return { ok: false, error: 'not-found' };
    if (expectedVersion !== undefined && this.read(target).version !== expectedVersion)
      return { ok: false, error: 'conflict' };
    const next = clamp(content);
    if (next) writeAtomic(this.file(target), next);
    else rmSync(this.file(target), { force: true });
    return { ok: true, notes: { content: next, version: versionOf(next) } };
  }

  private dir(target: BotNotesTarget): string {
    return join(target.kind === 'bot' ? this.roots.bots : this.roots.chats, target.id);
  }

  private file(target: BotNotesTarget): string {
    return join(this.dir(target), 'notes.md');
  }
}
