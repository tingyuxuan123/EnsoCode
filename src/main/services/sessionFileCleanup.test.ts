import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { removeConversationSessionFiles } from './sessionFileCleanup';

const CONVERSATION_ID = '11111111-1111-4111-8111-111111111111';

describe('removeConversationSessionFiles', () => {
  let root: string;
  let sessionDir: string;

  beforeEach(() => {
    root = realpathSync(mkdtempSync(path.join(tmpdir(), 'enso-session-cleanup-')));
    sessionDir = path.join(root, 'agent', 'sessions');
    mkdirSync(sessionDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('删除父会话 jsonl 与 coworker safe journal，保留无关文件', () => {
    const parentFile = path.join(sessionDir, '2026-08-29T00-00-00-000Z_abc.jsonl');
    const coworkerFile = path.join(sessionDir, `enso-${CONVERSATION_ID}__cw-deadbeef-gen.jsonl`);
    const otherParent = path.join(sessionDir, '2026-08-29T00-00-00-000Z_other.jsonl');
    const otherCoworker = path.join(
      sessionDir,
      'enso-22222222-2222-4222-8222-222222222222__cw-x-gen.jsonl'
    );
    for (const file of [parentFile, coworkerFile, otherParent, otherCoworker]) {
      writeFileSync(file, '{}\n');
    }

    removeConversationSessionFiles({
      sessionDir,
      conversationId: CONVERSATION_ID,
      sessionFile: parentFile,
    });

    expect(existsSync(parentFile)).toBe(false);
    expect(existsSync(coworkerFile)).toBe(false);
    expect(existsSync(otherParent)).toBe(true);
    expect(existsSync(otherCoworker)).toBe(true);
  });

  it('sessionFile 落在 sessions 目录外时拒绝删除（防穿越）', () => {
    const outside = path.join(root, 'outside.jsonl');
    writeFileSync(outside, '{}\n');

    removeConversationSessionFiles({
      sessionDir,
      conversationId: CONVERSATION_ID,
      sessionFile: outside,
    });

    expect(existsSync(outside)).toBe(true);
  });

  it('sessionFile 带 .. 分量穿越到目录外时拒绝删除', () => {
    const outside = path.join(root, 'escape.jsonl');
    writeFileSync(outside, '{}\n');

    removeConversationSessionFiles({
      sessionDir,
      conversationId: CONVERSATION_ID,
      sessionFile: path.join(sessionDir, '..', '..', 'escape.jsonl'),
    });

    expect(existsSync(outside)).toBe(true);
  });

  it('无 sessionFile（draft 会话）时仍清理 coworker 文件且不抛错', () => {
    const coworkerFile = path.join(sessionDir, `enso-${CONVERSATION_ID}__cw-a-gen.jsonl`);
    writeFileSync(coworkerFile, '{}\n');

    expect(() =>
      removeConversationSessionFiles({ sessionDir, conversationId: CONVERSATION_ID })
    ).not.toThrow();
    expect(existsSync(coworkerFile)).toBe(false);
  });

  it('sessions 目录不存在时不抛错', () => {
    expect(() =>
      removeConversationSessionFiles({
        sessionDir: path.join(root, 'missing'),
        conversationId: CONVERSATION_ID,
        sessionFile: path.join(root, 'missing', 'a.jsonl'),
      })
    ).not.toThrow();
  });

  it('删除父子未投递通知，保留相似前缀、无关与坏名字文件，不跟随目录链接', () => {
    const pending = path.join(sessionDir, 'pending-notifications');
    mkdirSync(pending);
    const own = path.join(pending, `${CONVERSATION_ID}.json`);
    const child = path.join(pending, `${encodeURIComponent(`${CONVERSATION_ID}::cw-child`)}.json`);
    const unrelated = path.join(pending, `${CONVERSATION_ID}extra.json`);
    const bad = path.join(pending, '%bad.json');
    for (const file of [own, child, unrelated, bad]) writeFileSync(file, '["pending"]');
    removeConversationSessionFiles({ sessionDir, conversationId: CONVERSATION_ID });
    expect(existsSync(own)).toBe(false);
    expect(existsSync(child)).toBe(false);
    expect(existsSync(unrelated)).toBe(true);
    expect(existsSync(bad)).toBe(true);
    rmSync(pending, { recursive: true });
    const outside = path.join(root, 'outside');
    mkdirSync(outside);
    const protectedFile = path.join(outside, `${CONVERSATION_ID}.json`);
    writeFileSync(protectedFile, 'keep');
    symlinkSync(outside, pending);
    removeConversationSessionFiles({ sessionDir, conversationId: CONVERSATION_ID });
    expect(existsSync(protectedFile)).toBe(true);
  });

  it('删除scratch仅删除该UUID目录，即使sessions目录不存在也保留相邻会话', () => {
    const scratch = path.join(root, 'scratch');
    const own = path.join(scratch, CONVERSATION_ID);
    const other = path.join(scratch, '22222222-2222-4222-8222-222222222222');
    mkdirSync(own, { recursive: true });
    mkdirSync(other, { recursive: true });
    removeConversationSessionFiles({
      sessionDir: path.join(root, 'missing'),
      conversationId: CONVERSATION_ID,
      scratchRoot: scratch,
    });
    expect(existsSync(own)).toBe(false);
    expect(existsSync(other)).toBe(true);
  });

  it('删除该会话及其子会话的 tool-output 目录，保留其他会话的', () => {
    const toolRoot = path.join(sessionDir, 'tool-output');
    const own = path.join(toolRoot, CONVERSATION_ID);
    const child = path.join(toolRoot, `${CONVERSATION_ID}-child`);
    const other = path.join(toolRoot, '22222222-2222-4222-8222-222222222222');
    for (const dir of [own, child, other]) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, 'toolu_1.txt'), 'x');
    }

    removeConversationSessionFiles({ sessionDir, conversationId: CONVERSATION_ID });

    expect(existsSync(own)).toBe(false);
    expect(existsSync(child)).toBe(false);
    expect(existsSync(other)).toBe(true);
  });
});
