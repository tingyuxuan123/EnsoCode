import { expect, it } from 'vitest';
import { resolveSessionWorkspace, sessionWorkspaceCwd } from './workspaceCwd';

it('scratch 文件/变更面板的 child 与父共享 cwd，但不暴露相邻会话目录', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const other = '22222222-2222-4222-8222-222222222222';
  const project = { kind: 'scratch', path: '/data/scratch' };
  const conversations = {
    [id]: { worktree: { path: '/wrong' } },
    child: { parentId: id },
    [other]: {},
  };
  expect(sessionWorkspaceCwd(project, 'child', conversations)).toBe(`/data/scratch/${id}`);
  expect(sessionWorkspaceCwd(project, other, conversations)).toBe(`/data/scratch/${other}`);
  expect(sessionWorkspaceCwd(project, 'unknown', conversations)).toBeUndefined();
});

it('普通根/worktree/SSH 路径保留，循环坏 parent 数据拒绝', () => {
  expect(sessionWorkspaceCwd({ path: '/repo' }, 'root', { root: {} })).toBe('/repo');
  expect(
    sessionWorkspaceCwd({ path: '/repo' }, 'root', { root: { worktree: { path: '/wt' } } })
  ).toBe('/wt');
  expect(
    sessionWorkspaceCwd({ kind: 'ssh', path: '/remote' }, 'root', {
      root: { worktree: { path: '/wt' } },
    })
  ).toBe('/remote');
  expect(
    sessionWorkspaceCwd({ kind: 'scratch', path: '/data/scratch' }, 'child', {
      child: { parentId: 'child' },
    })
  ).toBeUndefined();
});

it('resolveSessionWorkspace 追溯根会话并保留 worktree 缺失状态', () => {
  const project = { kind: 'local', path: '/repo' };
  const conversations = {
    root: { worktree: { path: '/wt/feat' }, worktreeMissing: true },
    coworker: { parentId: 'root' },
    btw: { btwParentId: 'coworker' },
  };
  expect(resolveSessionWorkspace(project, 'btw', conversations)).toEqual({
    rootConversationId: 'root',
    cwd: '/wt/feat',
    worktreeMissing: true,
  });
  expect(resolveSessionWorkspace(undefined, 'btw', conversations)).toBeUndefined();
});
