import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { emptyUsage } from '@shared/providers/piProviderTypes';
import { describe, expect, it } from 'vitest';
import { projectMessages, projectResumeTail } from './resumeSnapshots';

const msg = (text: string) => ({
  role: 'user',
  content: [{ type: 'text', text }],
});

describe('projectResumeTail', () => {
  it('JSONL 恢复的尾窗与全量沿用实时设计卡片白名单投影', () => {
    const card = {
      type: 'screenshot',
      key: 'a',
      title: 'A',
      payload: { dirPath: '/project/a.vetd', frameId: 'home' },
    };
    const root = mkdtempSync(join(tmpdir(), 'enso-design-resume-'));
    try {
      const session = SessionManager.create(root, root);
      session.appendMessage({
        role: 'assistant',
        content: [{ type: 'text', text: 'take screenshot' }],
        api: 'openai-completions',
        provider: 'fixture',
        model: 'fixture',
        stopReason: 'stop',
        usage: emptyUsage(),
        timestamp: 1,
      });
      session.appendMessage({
        role: 'toolResult',
        toolName: 'vetd_screenshot',
        toolCallId: 'capture',
        content: [],
        details: { cards: [null, card, { ...card, payload: 'bad' }] },
        isError: false,
        timestamp: 2,
      });
      const restored = SessionManager.open(session.getSessionFile()!, root);
      const raw = restored
        .getBranch()
        .flatMap((entry) => (entry.type === 'message' ? [entry.message] : []));
      expect(projectResumeTail(raw).immediate.messages.at(-1)?.designCards).toEqual([card]);
      expect(projectMessages(raw).at(-1)?.designCards).toEqual([card]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it('短历史只投一次，不拆全量', () => {
    const raw = [msg('a'), msg('b')];
    const { immediate, deferFull } = projectResumeTail(raw);
    expect(deferFull).toBe(false);
    expect(immediate.baseIndex).toBe(0);
    expect(immediate.messages).toHaveLength(2);
  });

  it('长历史立刻只投尾窗，全量另包', () => {
    const raw = Array.from({ length: 80 }, (_, i) => msg(`m${i}`));
    const { immediate, deferFull } = projectResumeTail(raw);
    expect(deferFull).toBe(true);
    expect(immediate.baseIndex).toBe(20);
    expect(immediate.messages).toHaveLength(60);
  });
});
