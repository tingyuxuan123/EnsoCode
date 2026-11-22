import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { VaultBindingStore } from './bindings';
import {
  ensureCompileJob,
  parseCompilePlan,
  parseRewriteBody,
  parseVerifyVerdicts,
  recentCompiledNotes,
  runCompileJob,
  sliceTranscript,
} from './compiler';
import { listIndexedNotes, openIndexDb } from './indexDb';
import { listPendingWrites } from './pending';
import { readNoteFile, writeNoteAtomic } from './vault';

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

  it('accepts a rewritten page body from JSON, fenced markdown, or frontmatter output', () => {
    expect(parseRewriteBody('{"content":"# 标题\\n\\n正文"}')).toBe('# 标题\n\n正文');
    expect(parseRewriteBody('```md\n正文\n```')).toBe('正文');
    expect(parseRewriteBody('---\ntype: domains\n---\n\n正文')).toBe('正文');
    expect(parseRewriteBody('   ')).toBeNull();
    expect(parseRewriteBody('{"actions":[]}')).toBeNull();
  });

  it('parses audit verdicts and treats unknown or missing verdicts as unsupported', () => {
    const verdicts = parseVerifyVerdicts(
      '```json\n{"verdicts":[{"slug":"a/one","verdict":"supported","reason":"ok"},{"slug":"a/two","verdict":"unsupported","reason":"no evidence"},{"slug":"a/three","verdict":"maybe"}]}\n```'
    );
    expect(verdicts.map((v) => [v.slug, v.supported])).toEqual([
      ['a/one', true],
      ['a/two', false],
      ['a/three', false],
    ]);
    expect(parseVerifyVerdicts('{"actions":[]}')).toEqual([]);
    expect(parseVerifyVerdicts('not json')).toEqual([]);
  });

  it('verifies compiled notes against the evidence and keeps unsupported notes as drafts', async () => {
    const work = tmpDir();
    const bindings = new VaultBindingStore(work);
    const db = openIndexDb(path.join(work, 'index.db'));
    try {
      const space = bindings.resolveSpace('proj:p1');
      const jobId = ensureCompileJob(db, {
        sessionId: 'sess-verify',
        sessionFile: '/fake/verify.jsonl',
        projectId: 'p1',
      });

      let auditCalls = 0;
      await runCompileJob(db, jobId, {
        bindings,
        language: 'zh',
        readTranscript: async () => [
          { role: 'user', text: '仓库统一用 pnpm，不要用 npm。', entryId: 'e1' },
          { role: 'assistant', text: '明白。', entryId: 'e2' },
        ],
        complete: async (_system, userText) => {
          if (userText.includes('## Notes to audit')) {
            auditCalls += 1;
            expect(userText).toContain('pnpm');
            expect(userText).toContain('## Evidence');
            return JSON.stringify({
              verdicts: [
                { slug: 'practices/pnpm', verdict: 'supported', reason: '用户明确要求' },
                { slug: 'systems/deploy', verdict: 'unsupported', reason: '证据没有给出端口号' },
              ],
            });
          }
          return JSON.stringify({
            actions: [
              {
                action: 'create',
                slug: 'practices/pnpm',
                title: '包管理器',
                type: 'practices',
                description: '统一使用 pnpm',
                content: '仓库统一使用 pnpm 安装依赖。',
              },
              {
                action: 'create',
                slug: 'systems/deploy',
                title: '部署端口',
                type: 'systems',
                description: '部署监听 4173',
                content: '部署脚本监听 4173 端口。',
              },
            ],
          });
        },
      });

      expect(auditCalls).toBe(1);
      const kept = readNoteFile(space.rootPath, 'wiki/practices/pnpm.md') ?? '';
      expect(kept).toContain('status: verified');
      expect(kept).toContain('collabra-verifier');
      expect(kept).toContain('仓库统一使用 pnpm 安装依赖。');

      const held = readNoteFile(space.rootPath, 'wiki/systems/deploy.md') ?? '';
      expect(held).toContain('status: draft');
      expect(held).not.toContain('collabra-verifier');
    } finally {
      db.close();
    }
  });

  it('rewrites an existing page in place instead of appending superseded statements', async () => {
    const work = tmpDir();
    const bindings = new VaultBindingStore(work);
    const db = openIndexDb(path.join(work, 'index.db'));
    try {
      const space = bindings.resolveSpace('proj:p1');
      writeNoteAtomic(
        space.rootPath,
        'wiki/domains/voxel-hash.md',
        [
          '---',
          'type: domains',
          'title: 体素哈希',
          'description: 哈希表参数',
          'status: verified',
          '---',
          '',
          '# 体素哈希',
          '',
          '哈希表装载因子保持在 0.85 以下。',
        ].join('\n')
      );

      const jobId = ensureCompileJob(db, {
        sessionId: 'sess-rewrite',
        sessionFile: '/fake/rewrite.jsonl',
        projectId: 'p1',
      });

      let planCalls = 0;
      await runCompileJob(db, jobId, {
        bindings,
        language: 'zh',
        readTranscript: async () => [
          { role: 'user', text: '街景数据下 0.85 会卡死，装载因子改成 0.70。', entryId: 'e1' },
          { role: 'assistant', text: '已记录。', entryId: 'e2' },
        ],
        complete: async (_system, userText) => {
          if (userText.includes('## Existing page')) {
            expect(userText).toContain('0.85');
            return ['# 体素哈希', '', '哈希表装载因子保持在 0.70 以下。'].join('\n');
          }
          if (userText.includes('## Notes to audit')) return '{"verdicts":[]}';
          planCalls += 1;
          return JSON.stringify({
            actions: [
              {
                action: 'update',
                slug: 'domains/voxel-hash',
                title: '体素哈希',
                type: 'domains',
                description: '哈希表参数',
                content: '街景数据下装载因子必须降到 0.70。',
                tags: [],
              },
            ],
          });
        },
      });

      expect(planCalls).toBe(1);
      const note = readNoteFile(space.rootPath, 'wiki/domains/voxel-hash.md') ?? '';
      expect(note).toContain('0.70');
      expect(note).not.toContain('0.85');
    } finally {
      db.close();
    }
  });

  it('appends instead of replacing when the existing page is too long to rewrite safely', async () => {
    const work = tmpDir();
    const bindings = new VaultBindingStore(work);
    const db = openIndexDb(path.join(work, 'index.db'));
    try {
      const space = bindings.resolveSpace('proj:p1');
      const longBody = `${'LONG_SENTINEL\n'.repeat(500)}tail`;
      writeNoteAtomic(
        space.rootPath,
        'wiki/domains/long-page.md',
        [
          '---',
          'type: domains',
          'title: 长页面',
          'description: 测试',
          'status: verified',
          '---',
          '',
          longBody,
        ].join('\n')
      );

      const jobId = ensureCompileJob(db, {
        sessionId: 'sess-long',
        sessionFile: '/fake/long.jsonl',
        projectId: 'p1',
      });
      await runCompileJob(db, jobId, {
        bindings,
        language: 'zh',
        readTranscript: async () => [{ role: 'user', text: '补充一点新结论。', entryId: 'e1' }],
        complete: async (_system, userText) => {
          if (userText.includes('## Notes to audit')) return '{"verdicts":[]}';
          if (userText.includes('## Existing page'))
            throw new Error('must not rewrite a huge page');
          return JSON.stringify({
            actions: [
              {
                action: 'update',
                slug: 'domains/long-page',
                title: '长页面',
                type: 'domains',
                mode: 'replace',
                content: '新增结论：增量补充。',
              },
            ],
          });
        },
      });

      const note = readNoteFile(space.rootPath, 'wiki/domains/long-page.md') ?? '';
      expect(note).toContain('LONG_SENTINEL');
      expect(note).toContain('新增结论');
    } finally {
      db.close();
    }
  });

  it('appends only the increment when the page was edited while the rewrite was running', async () => {
    const work = tmpDir();
    const bindings = new VaultBindingStore(work);
    const db = openIndexDb(path.join(work, 'index.db'));
    try {
      const space = bindings.resolveSpace('proj:p1');
      const filePath = path.join(space.rootPath, 'wiki/domains/edited.md');
      writeNoteAtomic(
        space.rootPath,
        'wiki/domains/edited.md',
        [
          '---',
          'type: domains',
          'title: 会被外部编辑的页面',
          'description: 测试',
          'status: verified',
          '---',
          '',
          '旧结论：装载因子 0.85。',
        ].join('\n')
      );

      const jobId = ensureCompileJob(db, {
        sessionId: 'sess-race',
        sessionFile: '/fake/race.jsonl',
        projectId: 'p1',
      });
      await runCompileJob(db, jobId, {
        bindings,
        language: 'zh',
        readTranscript: async () => [{ role: 'user', text: '街景下改成 0.70。', entryId: 'e1' }],
        complete: async (_system, userText) => {
          if (userText.includes('## Notes to audit')) return '{"verdicts":[]}';
          if (userText.includes('## Existing page')) {
            // 模型思考期间，用户在 Obsidian 里改了这页
            fs.writeFileSync(
              filePath,
              [
                '---',
                'type: domains',
                'title: 会被外部编辑的页面',
                'description: 测试',
                'status: verified',
                '---',
                '',
                '用户刚写的一句话。',
                '',
                '旧结论：装载因子 0.85。',
              ].join('\n')
            );
            return ['# 会被外部编辑的页面', '', '街景下装载因子改为 0.70。'].join('\n');
          }
          return JSON.stringify({
            actions: [
              {
                action: 'update',
                slug: 'domains/edited',
                title: '会被外部编辑的页面',
                type: 'domains',
                mode: 'replace',
                content: '街景下装载因子改为 0.70。',
              },
            ],
          });
        },
      });

      const note = readNoteFile(space.rootPath, 'wiki/domains/edited.md') ?? '';
      expect(note).toContain('用户刚写的一句话。');
      expect(note).toContain('街景下装载因子改为 0.70。');
      // 整页重写结果没有被追加进来，旧结论只出现一次
      expect(note.split('旧结论').length - 1).toBe(1);
      expect(note).toContain('status: draft');
    } finally {
      db.close();
    }
  });

  it('drops a pending audit when a later write to the same page is downgraded', async () => {
    const work = tmpDir();
    const bindings = new VaultBindingStore(work);
    const db = openIndexDb(path.join(work, 'index.db'));
    try {
      const space = bindings.resolveSpace('proj:p1');
      const filePath = path.join(space.rootPath, 'wiki/domains/dual.md');
      const jobId = ensureCompileJob(db, {
        sessionId: 'sess-dual',
        sessionFile: '/fake/dual.jsonl',
        projectId: 'p1',
      });

      let auditCalls = 0;
      await runCompileJob(db, jobId, {
        bindings,
        language: 'zh',
        readTranscript: async () => [
          { role: 'user', text: '记住 A，另外补一条 B。', entryId: 'e1' },
        ],
        complete: async (_system, userText) => {
          if (userText.includes('## Notes to audit')) {
            auditCalls += 1;
            return '{"verdicts":[{"slug":"domains/dual","verdict":"supported","reason":"ok"}]}';
          }
          if (userText.includes('## Existing page')) {
            fs.writeFileSync(
              filePath,
              [
                '---',
                'type: domains',
                'title: 双写',
                'description: d',
                'status: draft',
                '---',
                '',
                '外部编辑。',
              ].join('\n')
            );
            return 'B 结论。';
          }
          return JSON.stringify({
            actions: [
              {
                action: 'create',
                slug: 'domains/dual',
                title: '双写',
                type: 'domains',
                content: 'A 结论。',
              },
              {
                action: 'update',
                slug: 'domains/dual',
                title: '双写',
                type: 'domains',
                mode: 'replace',
                content: 'B 结论。',
              },
            ],
          });
        },
      });

      expect(auditCalls).toBe(0);
      const note = readNoteFile(space.rootPath, 'wiki/domains/dual.md') ?? '';
      expect(note).toContain('外部编辑。');
      expect(note).toContain('B 结论。');
      expect(note).toContain('status: draft');
    } finally {
      db.close();
    }
  });
});
