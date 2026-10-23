import { describe, expect, it } from 'vitest';
import { resolveSidePanelDockConversationId } from './sidePanelDockId';

describe('side panel owner routing', () => {
  it('keeps ordinary sessions and routes btw to its existing owner', () => {
    expect(resolveSidePanelDockConversationId({ root: {} }, 'root')).toBe('root');
    expect(resolveSidePanelDockConversationId({ btw: { btwParentId: 'root' } }, 'btw')).toBe(
      'root'
    );
  });

  it('routes authoritative same-workspace child metadata through parent and btw owners', () => {
    const conversations = {
      root: { projectId: 'project', worktree: { path: '/repo' } },
      btw: { projectId: 'project', btwParentId: 'root', worktree: { path: '/repo' } },
      child: {
        projectId: 'project',
        parentId: 'btw',
        child: { parentId: 'btw', agentInstanceId: 'agent' },
      },
    };
    expect(resolveSidePanelDockConversationId(conversations, 'child')).toBe('root');
  });

  it('does not infer legacy, cross-project, mismatched or different-worktree child ownership', () => {
    const root = { projectId: 'p', worktree: { path: '/repo' } };
    const child = {
      projectId: 'p',
      parentId: 'root',
      child: { parentId: 'root', agentInstanceId: 'a' },
    };
    for (const invalid of [
      { projectId: 'p', parentId: 'root' },
      { ...child, projectId: 'foreign' },
      { ...child, child: { parentId: 'wrong', agentInstanceId: 'a' } },
      { ...child, worktree: { path: '/other' } },
    ])
      expect(resolveSidePanelDockConversationId({ root, child: invalid }, 'child')).toBe('child');
  });

  it('does not loop on malformed cyclic metadata', () => {
    const conversations = {
      a: { projectId: 'p', parentId: 'b', child: { parentId: 'b', agentInstanceId: 'a' } },
      b: { projectId: 'p', parentId: 'a', child: { parentId: 'a', agentInstanceId: 'b' } },
    };
    expect(resolveSidePanelDockConversationId(conversations, 'a')).toBe('a');
  });
});
