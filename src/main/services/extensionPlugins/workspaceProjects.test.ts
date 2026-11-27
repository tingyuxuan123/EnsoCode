import { describe, expect, it } from 'vitest';
import { listWorkspaceProjects, resolveWorkspaceProject } from './workspaceProjects';

const projects = [
  { projectId: 'a', canonicalPath: '/projects/a', kind: 'local', state: 'active' },
  { projectId: 'b', canonicalPath: '/projects/b', kind: 'local', state: 'active' },
  { projectId: 'remote', canonicalPath: '/remote', kind: 'ssh', state: 'active' },
  { projectId: 'removed', canonicalPath: '/removed', kind: 'local', state: 'removed' },
  { projectId: 'scratch', canonicalPath: '/scratch', kind: 'scratch', state: 'active' },
];
const conversations = [
  { conversationId: 'a-work', projectId: 'a', kind: 'root', lifecycle: 'active' },
  { conversationId: 'a-main', projectId: 'a', kind: 'root', lifecycle: 'active' },
  { conversationId: 'ended', projectId: 'a', kind: 'root', lifecycle: 'ended' },
  { conversationId: 'child', projectId: 'a', kind: 'child', lifecycle: 'active' },
];
const roots: Record<string, string> = {
  'a-work': '/worktrees/a-fix',
  'a-main': '/projects/a',
  ended: '/worktrees/old',
  child: '/worktrees/child',
};
const source = { projects, conversations, rootForSession: (id: string) => roots[id] ?? null };

describe('plugin workspace project selection', () => {
  it('lists local registered projects without manufacturing conversations, preserving worktree identity', () => {
    const result = listWorkspaceProjects(source, 'a-work');
    expect(result.projects.map((item) => item.context)).toEqual([
      { projectId: 'a' },
      { projectId: 'b' },
      { projectId: 'a', conversationId: 'a-work' },
    ]);
    expect(result.current).toEqual({ projectId: 'a', conversationId: 'a-work' });
    expect(JSON.stringify(result)).not.toContain('canonicalPath');
    expect(listWorkspaceProjects(source, null).current).toBeNull();
  });

  it('derives roots from authority, rejects paths, removed/remote projects and foreign worktrees', () => {
    expect(resolveWorkspaceProject(source, null)).toEqual({ projectRoot: null });
    expect(resolveWorkspaceProject(source, { projectId: 'b' })).toEqual({
      projectRoot: '/projects/b',
    });
    expect(resolveWorkspaceProject(source, { projectId: 'a', conversationId: 'a-work' })).toEqual({
      projectRoot: '/worktrees/a-fix',
    });
    for (const input of [
      '/projects/b',
      {},
      { projectId: 'missing' },
      { projectId: 'removed' },
      { projectId: 'remote' },
      { projectId: 'scratch' },
      { projectId: 'b', conversationId: 'a-work' },
      { projectId: 'a', conversationId: 'ended' },
      { projectId: 'a', conversationId: 'child' },
      { projectId: 'a', path: '/secret' },
    ])
      expect(resolveWorkspaceProject(source, input)).toBeNull();
  });
});
