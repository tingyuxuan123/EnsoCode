import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { VaultBindingStore } from './bindings';
import {
  ensureCompileJob,
  parseCompilePlan,
  recentCompiledNotes,
  runCompileJob,
  sliceTranscript,
} from './compiler';
import { listIndexedNotes, openIndexDb } from './indexDb';
import { listPendingWrites } from './pending';
import { readNoteFile } from './vault';

const dirs: string[] = [];
function tmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'enso-compiler-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('wiki compiler', () => {
  it('parses compile action plans tolerantly and slices watermarks accurately', () => {
    const plan = parseCompilePlan(
      '```json\n{"actions":[{"action":"create","slug":"systems/cache","title":"缓存策略","type":"systems","description":"本地缓存规范","content":"使用 LRU"}]}\n```'
    );
    expect(plan?.actions).toHaveLength(1);
    expect(plan?.actions[0].slug).toBe('systems/cache');
    expect(parseCompilePlan('{"actions":[]}')?.actions).toEqual([]);
    expect(parseCompilePlan('not json at all')).toBeNull();

    const sliced = sliceTranscript(
      [
        { role: 'user', text: 'first', entryId: 'e1' },
        { role: 'assistant', text: 'second', entryId: 'e2' },
        { role: 'user', text: 'third', entryId: 'e3' },
      ],
      'e1'
    );
    expect(sliced.messages.map((m) => m.entryId)).toEqual(['e2', 'e3']);
    expect(sliced.watermark).toBe('e3');
  });

  it('compiles a transcript into draft markdown notes, redacts secrets, and updates existing pages', async () => {
    const work = tmpDir();
    const bindings = new VaultBindingStore(work);
    const db = openIndexDb(path.join(work, 'index.db'));
    try {
      const jobId = ensureCompileJob(db, {
        sessionId: 'sess-1',
        sessionFile: '/fake/sess-1.jsonl',
        projectId: 'p1',
      });
      expect(jobId).toBeGreaterThan(0);

      let seenPrompt = '';
      await runCompileJob(db, jobId, {
        bindings,
        language: 'zh',
        readTranscript: async () => [
          {
            role: 'user',
            text: '记住我们统一用 pnpm，不要用 npm。顺便 token sk-1234567890abcdefghijklmnop 别泄露。',
            entryId: 'e1',
          },
          { role: 'assistant', text: '好的，后续都使用 pnpm。', entryId: 'e2' },
        ],
        complete: async (_sys, userText) => {
          seenPrompt = userText;
          return JSON.stringify({
            actions: [
              {
                action: 'create',
                slug: 'practices/package-manager',
                title: '包管理器规范',
                type: 'practices',
                description: '统一使用 pnpm',
                content: '仓库统一使用 pnpm 执行依赖安装和脚本。',
                tags: ['pnpm'],
              },
            ],
          });
        },
      });

      // Secret was redacted before reaching the LLM
      expect(seenPrompt).not.toContain('sk-1234567890');
      expect(seenPrompt).toContain('[REDACTED]');

      const space = bindings.resolveSpace('proj:p1');
      const note = readNoteFile(space.rootPath, 'wiki/practices/package-manager.md');
      expect(note).toContain('status: draft');
      expect(note).toContain('by: collabra-compiler');
      expect(note).toContain('仓库统一使用 pnpm');

      const listed = listIndexedNotes(db, { spaceId: 'proj:p1', limit: 10, offset: 0 });
      expect(listed.total).toBe(1);
      expect(recentCompiledNotes(db, 'proj:p1', 0)).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it('routes bot group chat shared writes cleanly between bot space and chat space', async () => {
    const work = tmpDir();
    const bindings = new VaultBindingStore(work);
    const db = openIndexDb(path.join(work, 'index.db'));
    const botId = '22222222-2222-4222-8222-222222222222';
    const chatId = '33333333-3333-4333-8333-333333333333';
    try {
      const jobId = ensureCompileJob(db, {
        sessionId: 'sess-bot',
        sessionFile: '/fake/bot.jsonl',
        projectId: null,
        botId,
        chatId,
      });
      await runCompileJob(db, jobId, {
        bindings,
        language: 'zh',
        readTranscript: async () => [
          { role: 'user', text: '群里统一在周五发版', entryId: 'e1' },
          { role: 'assistant', text: '明白', entryId: 'e2' },
        ],
        complete: async () =>
          JSON.stringify({
            actions: [
              {
                action: 'create',
                slug: 'workflows/release-day',
                title: '群发版节奏',
                type: 'workflows',
                description: '每周五统一发版',
                content: '团队约定每周五统一发版。',
                scope: 'chat',
              },
            ],
          }),
      });
      const chatList = listIndexedNotes(db, { spaceId: `chat:${chatId}`, limit: 10, offset: 0 });
      expect(chatList.total).toBe(1);
      expect(listPendingWrites(db)).toEqual([]);
    } finally {
      db.close();
    }
  });
});
