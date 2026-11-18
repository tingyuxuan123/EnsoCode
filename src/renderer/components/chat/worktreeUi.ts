import type { SessionWorktree, WorktreeStatus } from '@shared/types/worktree';

export function worktreeDisplayName(worktree: SessionWorktree): string {
  return worktree.name?.trim() || worktree.branch;
}

export interface WorkspaceTriggerLabel {
  text: string;
  /** `branch` 表示文字是分支/工作区名，`house` 表示只代表「本地」。 */
  icon: 'branch' | 'house';
}

/**
 * composer 工作区选择器按钮上的文字。
 *
 * 本地工作区（主工作树）不写「本地」——主工作树叫什么不重要，用户要确认的是
 * 「我改的是不是 main」。只有拿不到分支（非 git、还没读到）时才回落到「本地」。
 * 隔离工作区仍以工作区显示名为准，分支和名字不同且不是默认分支时才补一个后缀。
 */
export function workspaceTriggerLabel(
  input: {
    /** 隔离 worktree 的显示名；本地工作区为 null。 */
    worktreeName: string | null;
    currentBranch?: string | null;
    /** 有 head commit 但没分支 = detached HEAD。 */
    headCommit?: string | null;
    defaultBranch?: string | null;
  },
  labels: { local: string; detached: string }
): WorkspaceTriggerLabel {
  const branch = input.currentBranch ?? (input.headCommit ? labels.detached : null);
  if (!input.worktreeName)
    return branch ? { text: branch, icon: 'branch' } : { text: labels.local, icon: 'house' };
  const suffix =
    branch &&
    branch !== input.worktreeName &&
    (!input.defaultBranch || input.currentBranch !== input.defaultBranch)
      ? ` · ${branch}`
      : '';
  return { text: `${input.worktreeName}${suffix}`, icon: 'branch' };
}

type WorktreeConversation = {
  projectId: string;
  worktree?: SessionWorktree;
  parentId?: string;
  child?: unknown;
  archived?: boolean;
  worktreeMissing?: boolean;
  ended?: boolean;
  historyOnly?: boolean;
  workspaceMigrating?: boolean;
};

export function existingProjectWorktrees(
  conversations: Record<string, WorktreeConversation>,
  projectId: string,
  statuses: Record<string, WorktreeStatus>
): { conversationId: string; worktree: SessionWorktree }[] {
  const seen = new Set<string>();
  const result: { conversationId: string; worktree: SessionWorktree }[] = [];
  for (const [conversationId, conversation] of Object.entries(conversations)) {
    const { worktree } = conversation;
    if (
      conversation.projectId !== projectId ||
      !worktree ||
      conversation.parentId ||
      conversation.child ||
      conversation.worktreeMissing ||
      conversation.ended ||
      conversation.historyOnly ||
      conversation.workspaceMigrating ||
      statuses[conversationId]?.exists === false ||
      seen.has(worktree.path)
    )
      continue;
    seen.add(worktree.path);
    result.push({ conversationId, worktree });
  }
  return result;
}

export function canAttachWorktree(conversation: {
  worktree?: SessionWorktree;
  parentId?: string;
  child?: unknown;
  started?: boolean;
  sessionFile?: string;
  messages: readonly unknown[];
  spawning?: boolean;
  status: string;
  workspaceMigrating?: boolean;
  reloading?: boolean;
  ended?: boolean;
  historyOnly?: boolean;
  archived?: boolean;
  forkedFromConversationId?: string;
}): boolean {
  return (
    !conversation.worktree &&
    !conversation.parentId &&
    !conversation.child &&
    !conversation.started &&
    !conversation.sessionFile &&
    conversation.messages.length === 0 &&
    !conversation.spawning &&
    conversation.status !== 'running' &&
    !conversation.workspaceMigrating &&
    !conversation.reloading &&
    !conversation.ended &&
    !conversation.historyOnly &&
    !conversation.archived &&
    !conversation.forkedFromConversationId
  );
}
