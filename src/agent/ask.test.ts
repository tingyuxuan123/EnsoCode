import type { AskRequestInfo } from '@shared/types/agent';
import { describe, expect, it, vi } from 'vitest';
import { AskManager } from './ask';

const make = (humanTimeoutMs?: number) => {
  const infos: AskRequestInfo[] = [];
  const resolved: string[] = [];
  const manager = new AskManager(
    (info) => {
      infos.push(info);
    },
    (id) => resolved.push(id),
    humanTimeoutMs
  );
  return { manager, infos, resolved };
};

describe('AskManager 等人超时', () => {
  it('开启时提问带 expiresAt；expire 后按「提问超时」收尾并发出 resolved', async () => {
    const { manager, infos, resolved } = make(600_000);
    const before = Date.now();
    const run = manager.ask('选哪个？', ['a', 'b']);
    expect(infos[0].expiresAt).toBeGreaterThanOrEqual(before + 600_000);
    expect(manager.snapshot()[0].expiresAt).toBe(infos[0].expiresAt);
    manager.expire(infos[0].requestId);
    await expect(run).rejects.toThrow(/^提问超时（10 分钟未回答）/);
    expect(resolved).toEqual([infos[0].requestId]);
    manager.expire(infos[0].requestId);
    expect(resolved).toHaveLength(1);
  });

  it('带默认答案时超时按默认答案', async () => {
    const { manager, infos } = make(600_000);
    const run = manager.ask('继续吗？', undefined, { defaultAnswer: '继续' });
    manager.expire(infos[0].requestId);
    await expect(run).resolves.toMatch(/^继续/);
  });

  it('未开启时不带 expiresAt', () => {
    const { manager, infos } = make();
    void manager.ask('q').catch(() => undefined);
    expect(infos[0].expiresAt).toBeUndefined();
    manager.cancelAll();
  });
});

describe('AskManager 请求只收尾一次', () => {
  it('普通问题忽略空白回答，正常回答后移除监听和计时器', async () => {
    vi.useFakeTimers();
    try {
      const { manager, infos, resolved } = make();
      const controller = new AbortController();
      const remove = vi.spyOn(controller.signal, 'removeEventListener');
      const run = manager.ask('q', undefined, { signal: controller.signal, timeoutMs: 50 });
      manager.respond(infos[0].requestId, '  ');
      manager.respond(infos[0].requestId, '');
      expect(manager.snapshot()).toHaveLength(1);
      manager.respond(infos[0].requestId, ' answer ');
      await expect(run).resolves.toBe(' answer ');
      expect(resolved).toHaveLength(1);
      expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('请求回调拒绝或抛错时立即清理，不挂起', async () => {
    for (const onRequest of [
      () => false,
      () => {
        throw new Error('stale');
      },
    ]) {
      const resolved = vi.fn();
      const manager = new AskManager(onRequest, resolved);
      await expect(manager.ask('q')).rejects.toThrow();
      expect(manager.snapshot()).toEqual([]);
      expect(resolved).toHaveBeenCalledTimes(1);
    }
  });
  it('预先取消的 signal 直接拒绝，不发出 request 或 resolved', async () => {
    const { manager, infos, resolved } = make();
    const controller = new AbortController();
    controller.abort();

    let status = 'pending';
    void manager.ask('q', undefined, { signal: controller.signal }).then(
      () => {
        status = 'fulfilled';
      },
      () => {
        status = 'rejected';
      }
    );
    await Promise.resolve();

    expect.soft(status).toBe('rejected');
    expect.soft(infos).toEqual([]);
    expect.soft(resolved).toEqual([]);
    expect.soft(manager.snapshot()).toEqual([]);
    manager.cancelAll();
  });

  it('回复只发出一次 resolved，随后取消不再产生事件', async () => {
    const { manager, infos, resolved } = make();
    const controller = new AbortController();
    const run = manager.ask('q', undefined, { signal: controller.signal });
    const requestId = infos[0].requestId;

    manager.respond(requestId, 'answer');
    await expect(run).resolves.toBe('answer');
    expect.soft(resolved).toEqual([requestId]);
    expect.soft(manager.snapshot()).toEqual([]);

    controller.abort();
    expect.soft(infos).toHaveLength(1);
    expect.soft(resolved).toEqual([requestId]);
    expect.soft(manager.snapshot()).toEqual([]);
  });

  it('cancelAll 清空多个请求，每个请求只发出一次 resolved', async () => {
    const { manager, infos, resolved } = make();
    const first = manager.ask('first');
    const second = manager.ask('second');
    const requestIds = infos.map((info) => info.requestId);
    const settled = Promise.allSettled([first, second]);

    manager.cancelAll();

    expect.soft((await settled).map((result) => result.status)).toEqual(['rejected', 'rejected']);
    expect.soft(manager.snapshot()).toEqual([]);
    expect.soft(resolved).toEqual(requestIds);
    manager.cancelAll();
    expect.soft(infos).toHaveLength(2);
    expect.soft(resolved).toEqual(requestIds);
  });

  it('显式超时拒绝并清空请求，迟到的回复和取消不能再次收尾', async () => {
    vi.useFakeTimers();
    try {
      const { manager, infos, resolved } = make();
      const controller = new AbortController();
      const run = manager.ask('q', undefined, { signal: controller.signal, timeoutMs: 25 });
      const requestId = infos[0].requestId;
      const rejection = expect(run).rejects.toThrow();

      await vi.advanceTimersByTimeAsync(25);
      await rejection;
      expect.soft(manager.snapshot()).toEqual([]);
      expect.soft(resolved).toEqual([requestId]);

      manager.respond(requestId, 'late answer');
      controller.abort();
      await vi.runAllTimersAsync();
      expect.soft(infos).toHaveLength(1);
      expect.soft(resolved).toEqual([requestId]);
      expect.soft(manager.snapshot()).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('AskManager 严格选择', () => {
  it('保留全部选项和标签空格，只返回精确匹配项', async () => {
    const { manager, infos, resolved } = make();
    const options = [' a ', 'a', 'b', 'c', 'd'];
    const run = manager.select('pick', options);
    expect(infos[0]).toMatchObject({ question: 'pick', options, selectionOnly: true });
    manager.respond(infos[0].requestId, ' a ');
    await expect(run).resolves.toBe(' a ');
    expect(resolved).toHaveLength(1);
  });

  it.each(['', 'missing', ' a'])('非精确选项 %j 作为取消处理且只收尾一次', async (answer) => {
    const { manager, infos, resolved } = make();
    const run = manager.select('pick', [' a ']);
    manager.respond(infos[0].requestId, answer);
    manager.respond(infos[0].requestId, ' a ');
    manager.cancelAll();
    await expect(run).resolves.toBeUndefined();
    expect(manager.snapshot()).toEqual([]);
    expect(resolved).toHaveLength(1);
  });

  it('非法问题或选项不发布请求', async () => {
    const { manager, infos } = make();
    for (const [question, options] of [
      ['', ['a']],
      [' ', ['a']],
      ['q', []],
      ['q', ['']],
      ['q', ['  ']],
      ['q', ['a', 'a']],
    ] as [string, string[]][]) {
      await expect(manager.select(question, options)).resolves.toBeUndefined();
    }
    expect(infos).toEqual([]);
  });

  it('提前取消、取消全部和 Main 超时都不默认选择', async () => {
    const { manager, infos } = make(100);
    const controller = new AbortController();
    controller.abort();
    await expect(
      manager.select('q', ['a'], { signal: controller.signal })
    ).resolves.toBeUndefined();
    expect(infos).toEqual([]);
    const cancelled = manager.select('q', ['a']);
    manager.cancelAll();
    await expect(cancelled).resolves.toBeUndefined();
    const expired = manager.select('q', ['a']);
    manager.expire(infos.at(-1)!.requestId);
    await expect(expired).resolves.toBeUndefined();
  });

  it('显式有限正超时反映在 expiresAt 且不超过等人上限', async () => {
    vi.useFakeTimers();
    try {
      const { manager, infos } = make(100);
      const run = manager.select('q', ['a'], { timeoutMs: 25 });
      expect(infos[0].expiresAt).toBe(Date.now() + 25);
      await vi.advanceTimersByTimeAsync(25);
      await expect(run).resolves.toBeUndefined();
      const longer = manager.select('q', ['a'], { timeoutMs: 200 });
      expect(infos[1].expiresAt).toBe(Date.now() + 100);
      manager.cancelAll();
      await longer;
      const infinite = manager.select('q', ['a'], { timeoutMs: Number.POSITIVE_INFINITY });
      expect(infos[2].expiresAt).toBe(Date.now() + 100);
      expect(vi.getTimerCount()).toBe(0);
      manager.cancelAll();
      await infinite;
    } finally {
      vi.useRealTimers();
    }
  });

  it('截止已过但计时器尚未执行时，迟到的允许答复也不能授权', async () => {
    vi.useFakeTimers();
    try {
      const { manager, infos, resolved } = make();
      const run = manager.select('授权？', ['Allow'], { timeoutMs: 25 });
      vi.setSystemTime(Date.now() + 26);
      manager.respond(infos[0].requestId, 'Allow');
      await expect(run).resolves.toBeUndefined();
      expect(manager.snapshot()).toEqual([]);
      expect(resolved).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
