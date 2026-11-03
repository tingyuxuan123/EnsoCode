import type { PluginContext } from '@vetta-org/plugin-sdk';
import { beforeEach, expect, it, vi } from 'vitest';
import { runHistoryCommand } from '../vetta/src/history/runner-host';
import { bindDesignContextOwner } from './owned-context';

const fallback = vi.hoisted(() =>
  vi.fn(() => ({ root: { kind: 'project', projectId: 'wrong' }, rel: 'wrong.vetd' }))
);
vi.mock('./engine', () => ({ designEnginePath: fallback }));
const script = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  script.mockResolvedValue({ ok: true, result: { ok: true, files: 1 } });
  vi.stubGlobal('window', { electronAPI: { design: { script } } });
});

it('同一规范cwd的不同会话历史仍使用精确owner引用，不走最长路径匹配', async () => {
  for (const sessionId of ['a', 'b']) {
    const ctx = {} as PluginContext;
    bindDesignContextOwner(ctx, {
      root: { ref: { kind: 'session', sessionId }, path: '/canonical' },
      validate: async () => {},
    });
    await runHistoryCommand(ctx, { cmd: 'unpack', dir: '/canonical/app.vetd', from: '/untrusted' });
    expect(script).toHaveBeenLastCalledWith({
      script: 'history',
      root: { kind: 'session', sessionId },
      designRel: 'app.vetd',
      payload: { cmd: 'unpack' },
    });
  }
  expect(fallback).not.toHaveBeenCalled();
});
it('owner离开、worktree/symlink规范根改变后，既有context的历史操作拒绝且不回退授权', async () => {
  let canonicalRoot = '/canonical';
  const ctx = {} as PluginContext;
  bindDesignContextOwner(ctx, {
    root: { ref: { kind: 'session', sessionId: 'owner' }, path: canonicalRoot },
    validate: async () => {
      if (canonicalRoot !== '/canonical') throw new Error('workspace moved');
    },
  });
  canonicalRoot = '/new-real-worktree';
  await expect(
    runHistoryCommand(ctx, { cmd: 'unpack', dir: '/canonical/app.vetd' })
  ).rejects.toThrow();
  expect(script).not.toHaveBeenCalled();
  expect(fallback).not.toHaveBeenCalled();
});
it('普通工具context保持P2映射方式，pin不扩展根外路径权限', async () => {
  await runHistoryCommand({} as PluginContext, { cmd: 'log', dir: '/canonical/app.vetd' });
  expect(fallback).toHaveBeenCalledWith('/canonical/app.vetd');
  const ctx = {} as PluginContext;
  bindDesignContextOwner(ctx, {
    root: { ref: { kind: 'session', sessionId: 's' }, path: '/canonical' },
    validate: async () => {},
  });
  script.mockClear();
  fallback.mockClear();
  await expect(
    runHistoryCommand(ctx, { cmd: 'unpack', dir: '/canonical/../neighbor.vetd' })
  ).rejects.toThrow();
  await expect(
    runHistoryCommand(ctx, { cmd: 'unpack', dir: '/canonical-other/a.vetd' })
  ).rejects.toThrow();
  expect(script).not.toHaveBeenCalled();
  expect(fallback).not.toHaveBeenCalled();
});
