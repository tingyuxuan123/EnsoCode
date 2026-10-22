import { describe, expect, it, vi } from 'vitest';
import { CodeSearchHost } from './codeSearchHost';

const configured = () => {
  const host = new CodeSearchHost(2);
  host.configure({ accountKey: 'devin#2', revision: 1 });
  return host;
};
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

describe('代码搜索任务生命周期', () => {
  it('无配置不执行；精确绑定账号且重复同代配置不取消任务', async () => {
    const empty = new CodeSearchHost();
    const action = vi.fn();
    await expect(empty.run('s', undefined, action)).rejects.toThrow(/account/i);
    expect(action).not.toHaveBeenCalled();
    const host = configured();
    await host.run('s', undefined, async (key, signal) => {
      expect(key).toBe('devin#2');
      host.configure({ accountKey: 'devin#2', revision: 1 });
      expect(signal.aborted).toBe(false);
    });
  });

  it('切账号/同账号身份撤销均取消进行中任务并拒绝迟到结果', async () => {
    for (const next of [
      { accountKey: 'devin', revision: 2 },
      { accountKey: 'devin#2', revision: 2 },
      { accountKey: null, revision: 2 },
    ]) {
      const host = configured();
      const pending = deferred<string>();
      const started = deferred<AbortSignal>();
      const result = host.run('s', undefined, async (_key, signal) => {
        started.resolve(signal);
        return pending.promise;
      });
      const signal = await started.promise;
      host.configure(next);
      expect(signal.aborted).toBe(true);
      await expect(result).rejects.toThrow(/cancel/i);
      pending.resolve('stale');
      host.configure({ accountKey: 'devin', revision: 1 });
      expect(host.accountKey).toBe(next.accountKey);
    }
  });

  it('同一会话串行、全局有界；排队取消不执行也不占槽', async () => {
    const host = new CodeSearchHost(1);
    host.configure({ accountKey: 'devin', revision: 1 });
    const pending = deferred<void>();
    const started = deferred<void>();
    const first = host.run('one', undefined, async () => {
      started.resolve();
      await pending.promise;
    });
    await started.promise;
    const cancel = new AbortController();
    const queued = vi.fn();
    const second = host.run('two', cancel.signal, queued);
    cancel.abort();
    await expect(second).rejects.toThrow(/cancel/i);
    expect(queued).not.toHaveBeenCalled();
    pending.resolve();
    await first;
    expect(await host.run('two', undefined, async () => 'ok')).toBe('ok');
  });

  it('释放会话或用户停止会清理挂起调用，但不取消其他会话', async () => {
    const host = configured();
    const started = deferred<void>();
    const result = host.run('old-generation', undefined, async (_key, signal) => {
      started.resolve();
      return new Promise<void>((_resolve, reject) =>
        signal.addEventListener('abort', () => reject(new Error('cancelled')))
      );
    });
    await started.promise;
    host.cancelSession('old-generation');
    await expect(result).rejects.toThrow(/cancel/i);
    expect(await host.run('other', undefined, async () => 'ok')).toBe('ok');
  });
});
