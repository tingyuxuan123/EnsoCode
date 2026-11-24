import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { removePastedTextFiles, savePastedTextFile } from './pastedTextFiles';
import { removeConversationSessionFiles } from './sessionFileCleanup';

const ID = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const LONG = `${'x'.repeat(30_000)}\r\n${'y'.repeat(30_000)}`;

describe('pastedTextFiles', () => {
  let sessionDir: string;

  beforeEach(() => {
    sessionDir = mkdtempSync(path.join(tmpdir(), 'enso-pasted-'));
  });

  afterEach(() => {
    rmSync(sessionDir, { recursive: true, force: true });
  });

  it('写到 pasted-text/<会话>/ 下，内容统一换行，返回字数与行数', async () => {
    const result = await savePastedTextFile(sessionDir, ID, LONG);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(path.basename(result.path)).toBe('pasted-text.txt');
    expect(result.path.startsWith(path.join(sessionDir, 'pasted-text', ID) + path.sep)).toBe(true);
    expect(readFileSync(result.path, 'utf8')).toBe(`${'x'.repeat(30_000)}\n${'y'.repeat(30_000)}`);
    expect(result).toMatchObject({ chars: 60_001, lines: 2 });
    const again = await savePastedTextFile(sessionDir, ID, LONG);
    expect(again.ok && again.path).not.toBe(result.path);
  });

  it('拒绝低于门槛的文本与越界 / 非法的会话标识', async () => {
    expect((await savePastedTextFile(sessionDir, ID, 'short')).ok).toBe(false);
    for (const owner of ['', '..', '../x', `${ID}/../..`, 'a/b', `bot-${ID}`, '/abs', `${ID}\\x`]) {
      expect((await savePastedTextFile(sessionDir, owner, LONG)).ok).toBe(false);
    }
    expect(existsSync(path.join(sessionDir, 'pasted-text'))).toBe(false);
  });

  it('只清理该会话自己的粘贴文件；非法标识不删任何东西', async () => {
    const mine = await savePastedTextFile(sessionDir, ID, LONG);
    const other = await savePastedTextFile(sessionDir, OTHER, LONG);
    removePastedTextFiles(sessionDir, '..');
    expect(mine.ok && existsSync(mine.path)).toBe(true);
    expect(other.ok && existsSync(other.path)).toBe(true);
  });

  it('删除会话时 removeConversationSessionFiles 一并清理粘贴文件', async () => {
    const mine = await savePastedTextFile(sessionDir, ID, LONG);
    const other = await savePastedTextFile(sessionDir, OTHER, LONG);
    const keep = path.join(sessionDir, 'keep.jsonl');
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(keep, '{}\n');
    removeConversationSessionFiles({ sessionDir, conversationId: ID });
    expect(mine.ok && existsSync(mine.path)).toBe(false);
    expect(other.ok && existsSync(other.path)).toBe(true);
    expect(existsSync(keep)).toBe(true);
  });
});
