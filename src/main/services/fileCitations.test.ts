import { createHash } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { externalCitationPath } from '@shared/markdownLinks';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openFileCitation, parseOpenFileCitationRequest, saveFileCitation } from './fileCitations';

const timestamp = new Date(0).toISOString();
const reveal = vi.fn();
let root = '';
let original = '';
let sessionDir = '';
let sessionFile = '';

beforeEach(async () => {
  root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'file-citation-')));
  original = path.join(root, 'the original.ts');
  sessionDir = path.join(root, 'sessions');
  sessionFile = path.join(sessionDir, 'active.jsonl');
  await mkdir(sessionDir);
  await writeFile(original, 'export const original = true;\n');
  reveal.mockReset();
});
afterEach(async () => rm(root, { recursive: true, force: true }));

const answer = (text: string, id = '01', parentId: string | null = null) => ({
  type: 'message',
  id,
  parentId,
  timestamp,
  message: { role: 'assistant', content: [{ type: 'text', text }] },
});

async function journal(entries: ReturnType<typeof answer>[]) {
  const records = [
    { type: 'session', version: 3, id: 'session', cwd: root, timestamp },
    ...entries,
  ];
  await writeFile(sessionFile, records.map((entry) => JSON.stringify(entry)).join('\n'));
}

function citation(action: 'preview' | 'reveal' = 'preview', file = original) {
  const absolute = externalCitationPath(file) ?? file;
  return {
    conversationId: 'chat',
    projectId: 'project',
    citationId: createHash('sha256').update(absolute).digest('hex'),
    action,
  };
}

const deps = () => ({
  sessionDir,
  sessionFile,
  origin: 'window:1',
  protectedRoots: [sessionDir],
  reveal,
  stillAuthorized: () => true,
});

async function openOriginal() {
  await journal([answer(`[source](${pathToFileURL(original).href}:2)`)]);
  const opened = await openFileCitation(citation(), deps());
  if (!opened.ok || opened.target !== 'text' || !opened.revision)
    throw new Error('Expected editable text');
  return { ...opened, revision: opened.revision };
}

function edit(revision: string, content = 'edited\n') {
  const { conversationId, projectId, citationId } = citation();
  return { conversationId, projectId, citationId, revision, content };
}

describe('工作区外聊天文件引用', () => {
  it('只接受引用标识，不接收渲染进程传来的文件或会话路径', () => {
    expect(parseOpenFileCitationRequest(citation())).toEqual(citation());
    expect(parseOpenFileCitationRequest({ ...citation(), path: original })).toBeNull();
    expect(parseOpenFileCitationRequest({ ...citation(), sessionFile })).toBeNull();
    expect(parseOpenFileCitationRequest({ ...citation(), citationId: original })).toBeNull();
  });

  it('从当前会话的真实 Markdown 引用恢复路径，直接返回可编辑原件', async () => {
    await journal([answer(`[source](${pathToFileURL(original).href}:2)`)]);
    expect(await openFileCitation(citation(), deps())).toEqual({
      ok: true,
      target: 'text',
      citationId: citation().citationId,
      path: externalCitationPath(original),
      content: 'export const original = true;\n',
      revision: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(reveal).not.toHaveBeenCalled();
  });

  it('主进程的数据根有系统别名时，仍认出同一根下的规范会话路径', async () => {
    const alias = path.join(root, 'session-alias');
    await symlink(sessionDir, alias, 'junction');
    await journal([answer(`[source](${pathToFileURL(original).href})`)]);
    expect(await openFileCitation(citation(), { ...deps(), sessionDir: alias })).toMatchObject({
      ok: true,
      target: 'text',
    });
  });

  it('不接受其它分支、代码示例或聊天中不存在的目标', async () => {
    const link = `[source](${pathToFileURL(original).href})`;
    await journal([answer(link, '01'), answer(`\`\`\`md\n${link}\n\`\`\``, '02')]);
    expect(await openFileCitation(citation(), deps())).toEqual({
      ok: false,
      error: 'citation-unavailable',
    });
    expect(reveal).not.toHaveBeenCalled();
  });

  it('拒绝已移除的会话', async () => {
    await journal([answer(`[source](${pathToFileURL(original).href})`)]);
    expect(
      await openFileCitation(citation(), { ...deps(), stillAuthorized: () => false })
    ).toMatchObject({ ok: false });
    expect(reveal).not.toHaveBeenCalled();
  });

  it('显式保存只写回被打开的同一文件，支持连续保存', async () => {
    const { revision } = await openOriginal();
    const first = await saveFileCitation(edit(revision), deps());
    expect(first).toMatchObject({ ok: true, revision: expect.any(String) });
    expect(await readFile(original, 'utf8')).toBe('edited\n');
    if (!first.ok) throw new Error('Save failed');
    expect(await saveFileCitation(edit(first.revision, 'second edit'), deps())).toMatchObject({
      ok: true,
    });
    expect(await readFile(original, 'utf8')).toBe('second edit');
  });

  it('不覆盖别的窗口、伪造版本、以及磁盘上已修改或换掉的文件', async () => {
    const { revision } = await openOriginal();
    expect(
      await saveFileCitation(edit(revision), { ...deps(), origin: 'wrong-window' })
    ).toMatchObject({ ok: false });
    expect(await saveFileCitation(edit('0'.repeat(64)), deps())).toMatchObject({ ok: false });
    await writeFile(original, 'external edit');
    expect(await saveFileCitation(edit(revision), deps())).toEqual({
      ok: false,
      error: 'conflict',
    });
    expect(await readFile(original, 'utf8')).toBe('external edit');
    const fresh = await openOriginal();
    await rename(original, `${original}.old`);
    await writeFile(original, 'external edit');
    expect(await saveFileCitation(edit(fresh.revision), deps())).toEqual({
      ok: false,
      error: 'conflict',
    });
  });

  it('不直接读取应用内部文件或凭据文件', async () => {
    const settings = path.join(sessionDir, 'settings.json');
    const secrets = path.join(root, '.env');
    await writeFile(settings, '{"private":true}');
    await writeFile(secrets, 'SECRET=value');
    await journal([
      answer(`[a](${pathToFileURL(settings).href}) [b](${pathToFileURL(secrets).href})`),
    ]);
    for (const file of [settings, secrets]) {
      expect(await openFileCitation(citation('preview', file), deps())).toMatchObject({
        ok: false,
      });
    }
  });

  it('对不能预览的文件只定位原件，不交给系统打开', async () => {
    const executable = path.join(root, 'not-run.exe');
    await writeFile(executable, 'not an executable');
    await journal([answer(`[file][download]\n\n[download]: ${pathToFileURL(executable).href}`)]);
    expect(await openFileCitation(citation('preview', executable), deps())).toEqual({
      ok: true,
      target: 'handled',
    });
    expect(reveal).toHaveBeenCalledWith(externalCitationPath(executable));
  });
});
