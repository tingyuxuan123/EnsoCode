import { describe, expect, it, vi } from 'vitest';
import { createAppQuitDrain } from './appQuitDrain';

describe('createAppQuitDrain', () => {
  it('does not intercept quit when no step needs to wait', () => {
    const begin = vi.fn();
    const drain = createAppQuitDrain([
      { begin, shouldWait: () => false, wait: vi.fn(async () => {}) },
    ]);
    const preventDefault = vi.fn();
    const quit = vi.fn();
    drain.onWillQuit({ preventDefault }, quit);
    expect(begin).toHaveBeenCalledOnce();
    expect(preventDefault).not.toHaveBeenCalled();
    expect(quit).not.toHaveBeenCalled();
  });

  it('waits for every pending step before quit, then lets the second will-quit through', async () => {
    const order: string[] = [];
    let llama = true;
    let pty = true;
    const drain = createAppQuitDrain([
      {
        begin: () => order.push('pty-begin'),
        shouldWait: () => pty,
        wait: async () => {
          order.push('pty-wait');
          pty = false;
        },
      },
      {
        shouldWait: () => llama,
        wait: async () => {
          order.push('llama-wait');
          llama = false;
        },
      },
    ]);
    const preventDefault = vi.fn();
    const quit = vi.fn();
    drain.onWillQuit({ preventDefault }, quit);
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(quit).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(quit).toHaveBeenCalledOnce());
    expect(order).toEqual(['pty-begin', 'pty-wait', 'llama-wait']);

    const prevent2 = vi.fn();
    drain.onWillQuit({ preventDefault: prevent2 }, vi.fn());
    expect(prevent2).not.toHaveBeenCalled();
  });

  it('still quits if one waiter rejects', async () => {
    const drain = createAppQuitDrain([
      {
        shouldWait: () => true,
        wait: async () => {
          throw new Error('dispose failed');
        },
      },
    ]);
    const quit = vi.fn();
    drain.onWillQuit({ preventDefault: vi.fn() }, quit);
    await vi.waitFor(() => expect(quit).toHaveBeenCalledOnce());
  });

  // Electron 在 will-quit 监听器返回后才把 preventDefault 落成「取消退出」；
  // 同一宏任务内（含微任务）重入 app.quit() 会被当成「已在退出中」吞掉，进程挂住。
  it('re-quits on a later macrotask even when every waiter settles immediately', async () => {
    const drain = createAppQuitDrain([{ shouldWait: () => true, wait: async () => {} }]);
    const quit = vi.fn();
    drain.onWillQuit({ preventDefault: vi.fn() }, quit);
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(quit).not.toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(quit).toHaveBeenCalledOnce();
  });
});
