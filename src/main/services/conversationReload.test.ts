import { describe, expect, it } from 'vitest';
import { reloadConversation } from './conversationReload';

const snapshot = {
  identity: { sessionId: 'c1', generation: 'g1' },
  status: 'idle' as const,
  messages: [],
  commands: [],
};
const projection = { records: [], partial: false };
const tail = {
  messages: [{ role: 'assistant' as const, content: [{ type: 'text' as const, text: 'hi' }] }],
  baseIndex: 12,
};

const never = async (): Promise<never> => {
  throw new Error('should not be called');
};

describe('reloadConversation 来源选择', () => {
  it('普通 child 在 worker 退出后回落到 pi 尾窗，保留来源和游标', async () => {
    const result = await reloadConversation('child', {
      isLive: () => true,
      isChild: () => true,
      reloadLive: async () => ({ ok: false, error: 'Worker exited' }),
      readHistory: async () => ({ ok: true, source: 'tail', ...tail }),
      readParentTail: never,
    });
    expect(result).toEqual({ ok: true, source: 'tail', ...tail });
  });
  it('不在 worker 里的根会话 → 读 pi jsonl 尾窗（不碰 safe journal）', async () => {
    const result = await reloadConversation('root', {
      isLive: () => false,
      isChild: () => false,
      reloadLive: never,
      readHistory: never,
      readParentTail: async () => ({ ok: true, ...tail }),
    });
    expect(result).toEqual({ ok: true, source: 'tail', ...tail });
  });

  it('live 失败的根会话 → 回落到 jsonl 尾窗', async () => {
    const result = await reloadConversation('root', {
      isLive: () => true,
      isChild: () => false,
      reloadLive: async () => ({ ok: false, error: 'Timed out' }),
      readHistory: never,
      readParentTail: async () => ({ ok: true, ...tail }),
    });
    expect(result).toEqual({ ok: true, source: 'tail', ...tail });
  });
  it('worker 里活着且就绪 → 走 live 快照，不读盘', async () => {
    let historyReads = 0;
    const result = await reloadConversation('c1', {
      isLive: () => true,
      isChild: () => true,
      reloadLive: async () => ({ ok: true, snapshot, seq: 9 }),
      readHistory: async () => {
        historyReads++;
        return { ok: true, source: 'history', projection };
      },
      readParentTail: never,
    });
    expect(result).toEqual({ ok: true, source: 'live', snapshot, seq: 9 });
    expect(historyReads).toBe(0);
  });

  it('不在 worker 里 → 走 safe journal 只读投影，不 spawn', async () => {
    let liveCalls = 0;
    const result = await reloadConversation('c1', {
      isLive: () => false,
      isChild: () => true,
      reloadLive: async () => {
        liveCalls++;
        return { ok: false, error: 'unused' };
      },
      readHistory: async () => ({ ok: true, source: 'history', projection }),
      readParentTail: never,
    });
    expect(result).toEqual({ ok: true, source: 'history', projection });
    expect(liveCalls).toBe(0);
  });

  it('live 读取失败（超时 / worker 退出）→ 回落到 safe journal', async () => {
    const result = await reloadConversation('c1', {
      isLive: () => true,
      isChild: () => true,
      reloadLive: async () => ({ ok: false, error: 'Timed out' }),
      readHistory: async () => ({ ok: true, source: 'history', projection }),
      readParentTail: never,
    });
    expect(result).toEqual({ ok: true, source: 'history', projection });
  });

  it('两路都失败 → 返回历史读取的原因，不抛', async () => {
    const result = await reloadConversation('c1', {
      isLive: () => true,
      isChild: () => true,
      reloadLive: async () => ({ ok: false, error: 'Timed out' }),
      readHistory: async () => ({
        ok: false,
        code: 'not-found',
        error: 'History file is missing.',
      }),
      readParentTail: never,
    });
    expect(result).toEqual({ ok: false, error: 'History file is missing.' });
  });

  it('读盘抛异常 → 转成失败结果', async () => {
    const result = await reloadConversation('c1', {
      isLive: () => false,
      isChild: () => true,
      reloadLive: async () => ({ ok: false, error: 'unused' }),
      readHistory: async () => {
        throw new Error('EACCES');
      },
      readParentTail: never,
    });
    expect(result).toEqual({ ok: false, error: 'EACCES' });
  });
});
