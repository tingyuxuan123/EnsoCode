import type { SessionWorktree } from '@shared/types/worktree';
import { describe, expect, it } from 'vitest';
import {
  canAttachWorktree,
  existingProjectWorktrees,
  workspaceTriggerLabel,
  worktreeDisplayName,
} from './worktreeUi';

const LABELS = { local: '本地', detached: '分离 HEAD' };

describe('composer 工作区选择器的文字', () => {
  it('本地工作区显示当前分支，而不是「本地」', () => {
    // 主工作树叫什么不重要；用户要确认的是「我改的是不是 main」。
    expect(
      workspaceTriggerLabel(
        { worktreeName: null, currentBranch: 'main', defaultBranch: 'main' },
        LABELS
      )
    ).toEqual({ text: 'main', icon: 'branch' });
  });

  it('本地没有分支信息时才回落到「本地」', () => {
    expect(workspaceTriggerLabel({ worktreeName: null, currentBranch: null }, LABELS)).toEqual({
      text: '本地',
      icon: 'house',
    });
  });

  it('本地 detached HEAD 用文案说明，不显示空分支名', () => {
    expect(
      workspaceTriggerLabel({ worktreeName: null, currentBranch: null, headCommit: 'abc' }, LABELS)
    ).toEqual({ text: '分离 HEAD', icon: 'branch' });
  });

  it('隔离工作区仍以工作区名为准，分支不同才补在后面', () => {
    expect(
      workspaceTriggerLabel(
        { worktreeName: 'task-1', currentBranch: 'task-1', defaultBranch: 'main' },
        LABELS
      )
    ).toEqual({ text: 'task-1', icon: 'branch' });
    expect(
      workspaceTriggerLabel(
        { worktreeName: 'task-1', currentBranch: 'feature/x', defaultBranch: 'main' },
        LABELS
      )
    ).toEqual({ text: 'task-1 · feature/x', icon: 'branch' });
    // 分支就是默认分支时不重复一遍
    expect(
      workspaceTriggerLabel(
        { worktreeName: 'task-1', currentBranch: 'main', defaultBranch: 'main' },
        LABELS
      )
    ).toEqual({ text: 'task-1', icon: 'branch' });
  });
});

const worktree = (path: string, name?: string): SessionWorktree => ({
  conversationId: 'source',
  projectId: 'project',
  repoPath: '/repo',
  path,
  branch: 'feature/example',
  baseBranch: 'main',
  baseCommit: 'abc',
  createdAt: 1,
  name,
});
const conversation = (path: string) => ({ projectId: 'project', worktree: worktree(path) });

describe('worktree UI identity', () => {
  it('uses the trimmed display name, falling back to the unchanged branch', () => {
    expect(worktreeDisplayName(worktree('/one', '  My task  '))).toBe('My task');
    expect(worktreeDisplayName(worktree('/one', '  '))).toBe('feature/example');
    expect(worktreeDisplayName(worktree('/one'))).toBe('feature/example');
  });

  it('deduplicates paths within the project, includes archived sessions and excludes children and missing worktrees', () => {
    const candidates = existingProjectWorktrees(
      {
        first: conversation('/one'),
        duplicate: conversation('/one'),
        archived: { ...conversation('/two'), archived: true },
        otherProject: { ...conversation('/other'), projectId: 'other' },
        child: { ...conversation('/child'), parentId: 'first' },
        typedChild: { ...conversation('/typed'), child: {} },
        missing: { ...conversation('/missing'), worktreeMissing: true },
        absent: conversation('/absent'),
        local: { projectId: 'project' },
      },
      'project',
      { absent: { exists: false, dirty: false, ahead: 0 } }
    );
    expect(
      candidates.map(({ conversationId, worktree }) => [conversationId, worktree.path])
    ).toEqual([
      ['first', '/one'],
      ['archived', '/two'],
    ]);
  });

  it('skips unusable references before deduplicating a shared path', () => {
    const candidates = existingProjectWorktrees(
      {
        ended: { ...conversation('/one'), ended: true },
        history: { ...conversation('/one'), historyOnly: true },
        migrating: { ...conversation('/one'), workspaceMigrating: true },
        usable: conversation('/one'),
      },
      'project',
      {}
    );
    expect(candidates.map(({ conversationId }) => conversationId)).toEqual(['usable']);
  });

  it('does not merge different paths merely because their names or branches match', () => {
    expect(
      existingProjectWorktrees({ a: conversation('/a'), b: conversation('/b') }, 'project', {})
    ).toHaveLength(2);
  });
});

describe('existing worktree attachment eligibility', () => {
  const fresh = { started: false, messages: [], status: 'idle', spawning: false };
  it('only offers attachment to a fresh local parent session', () => {
    expect(canAttachWorktree(fresh)).toBe(true);
    for (const change of [
      { started: true },
      { sessionFile: '/history' },
      { messages: [{}] },
      { worktree: worktree('/one') },
      { parentId: 'parent' },
      { child: {} },
      { spawning: true },
      { status: 'running' },
      { workspaceMigrating: true },
      { reloading: true },
      { historyOnly: true },
      { ended: true },
      { archived: true },
      { forkedFromConversationId: 'source' },
    ])
      expect(canAttachWorktree({ ...fresh, ...change })).toBe(false);
  });
});
