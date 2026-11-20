import { conversationCwd } from '@shared/conversationCwd';

export interface SessionWorkspaceTarget {
  rootConversationId: string;
  cwd: string | undefined;
  worktreeMissing: boolean;
}

/** 追溯所属根会话并返回当前工作目录与 worktree 缺失状态（避免把无关分支逻辑散落到多处）。 */
export function resolveSessionWorkspace(
  project: { kind?: string; path: string } | undefined,
  conversationId: string,
  conversations: Record<
    string,
    | {
        parentId?: string;
        btwParentId?: string;
        worktree?: { path: string };
        worktreeMissing?: boolean;
      }
    | undefined
  >
): SessionWorkspaceTarget | undefined {
  if (!project) return undefined;
  const seen = new Set<string>();
  let id = conversationId;
  for (;;) {
    const conversation = conversations[id];
    if (!conversation || seen.has(id)) return undefined;
    seen.add(id);
    const parentId = conversation.parentId ?? conversation.btwParentId;
    if (parentId) {
      id = parentId;
      continue;
    }
    return {
      rootConversationId: id,
      cwd:
        conversationCwd({
          kind: project.kind,
          canonicalPath: project.path,
          conversationId: id,
          worktreePath: conversation.worktree?.path,
        }) ?? undefined,
      worktreeMissing: Boolean(conversation.worktreeMissing),
    };
  }
}

export function sessionWorkspaceCwd(
  project: { kind?: string; path: string } | undefined,
  conversationId: string,
  conversations: Record<
    string,
    { parentId?: string; btwParentId?: string; worktree?: { path: string } } | undefined
  >
): string | undefined {
  return resolveSessionWorkspace(project, conversationId, conversations)?.cwd;
}
