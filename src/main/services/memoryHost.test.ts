import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: () => os.tmpdir() },
}));

import {
  awaitMemoryDistill,
  closeMemoryDb,
  configureMemoryDistill,
  distillSessionNow,
  invokeMemory,
  memoryBindings,
  memoryDatabase,
  memoryLanguage,
  rebuildMemoryIndex,
  removeSpaceCompletely,
  scheduleMemoryDistill,
  setMemoryRootForTest,
  syncMemoryFromSettings,
} from './memoryHost';

const dirs: string[] = [];
function tmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'enso-memory-host-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  closeMemoryDb();
  setMemoryRootForTest(null);
  configureMemoryDistill({ enabled: false, complete: null });
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('memoryHost wiki integration', () => {
  it('invokes upsert/read/search, rebuilds index from markdown SoT, and cleans managed space safely', async () => {
    const root = tmpDir();
    setMemoryRootForTest(root);
    syncMemoryFromSettings({ memoryDistillEnabled: false, memoryLanguage: 'zh' });

    const up = (await invokeMemory(
      'upsert',
      {
        note: 'decisions/wiki-format',
        title: '采用 OKF Markdown 格式',
        type: 'decisions',
        description: '以本地 Markdown 为权威源',
        content: '放弃黑盒数据库，全面采用 [[systems/vault]]。',
      },
      { projectId: 'p1' }
    )) as { status: string; slug: string };
    expect(up.status).toBe('created');
    expect(up.slug).toBe('decisions/wiki-format');

    // Rebuild index.db from scratch and verify search still finds the Markdown note
    rebuildMemoryIndex();
    const res = (await invokeMemory('search', { query: 'OKF' }, { projectId: 'p1' })) as {
      results: { slug: string }[];
    };
    expect(res.results.map((r) => r.slug)).toContain('decisions/wiki-format');

    // Remove managed space deletes managed folder & index rows
    const managedDir = memoryBindings().resolveSpace('proj:p1').rootPath;
    expect(fs.existsSync(managedDir)).toBe(true);
    await removeSpaceCompletely('proj:p1');
    expect(fs.existsSync(managedDir)).toBe(false);
    const after = memoryDatabase()
      .prepare('SELECT count(*) AS c FROM notes WHERE space_id = ?')
      .get('proj:p1') as { c: number };
    expect(after.c).toBe(0);
  });

  it('never deletes files in an external Obsidian vault when removing a space', async () => {
    const root = tmpDir();
    const external = tmpDir();
    fs.writeFileSync(path.join(external, 'precious.md'), '# Precious\n');
    setMemoryRootForTest(root);
    memoryBindings().bindExternal('proj:ext', external);

    await removeSpaceCompletely('proj:ext');
    expect(fs.existsSync(path.join(external, 'precious.md'))).toBe(true);
  });

  it('runs manual wiki compilation even when auto-compile toggle is off', async () => {
    const root = tmpDir();
    setMemoryRootForTest(root);
    syncMemoryFromSettings({ memoryDistillEnabled: false, memoryLanguage: 'zh' });
    configureMemoryDistill({
      readTranscript: async () => [
        { role: 'user', text: '以后所有文档都采用 OKF v0.2', entryId: 'e1' },
        { role: 'assistant', text: '收到', entryId: 'e2' },
      ],
      complete: () => async () =>
        JSON.stringify({
          actions: [
            {
              action: 'create',
              slug: 'practices/okf',
              title: 'OKF 规范',
              type: 'practices',
              description: '统一使用 OKF v0.2 Frontmatter',
              content: '文档头部统一写入 OKF v0.2 字段。',
            },
          ],
        }),
    });

    const started = await distillSessionNow({
      sessionId: 'sess-manual',
      sessionFile: '/fake/s.jsonl',
      projectId: 'p2',
    });
    await awaitMemoryDistill();
    expect(started).toBe(true);
    const search = (await invokeMemory('search', { query: 'OKF' }, { projectId: 'p2' })) as {
      results: { slug: string }[];
    };
    expect(search.results.map((r) => r.slug)).toContain('practices/okf');
  });

  it('defaults syncMemoryFromSettings({}) to auto-compile enabled and Simplified Chinese', async () => {
    const root = tmpDir();
    setMemoryRootForTest(root);
    syncMemoryFromSettings({});
    expect(memoryLanguage()).toBe('zh');

    configureMemoryDistill({
      readTranscript: async () => [
        { role: 'user', text: '记住以后统一用 pnpm test 验证。', entryId: 'e1' },
      ],
      complete: () => async () =>
        JSON.stringify({
          actions: [
            {
              action: 'create',
              slug: 'practices/testing',
              title: '测试命令规范',
              type: 'practices',
              description: '提交前运行 pnpm test',
              content: '始终使用 pnpm test 运行完整测试集。',
            },
          ],
        }),
    });

    await scheduleMemoryDistill({
      sessionId: 'sess-auto-default',
      sessionFile: '/fake/auto.jsonl',
      projectId: 'p3',
    });
    await awaitMemoryDistill();

    const search = (await invokeMemory('search', { query: 'pnpm' }, { projectId: 'p3' })) as {
      results: { slug: string }[];
    };
    expect(search.results.map((r) => r.slug)).toContain('practices/testing');
  });
});
