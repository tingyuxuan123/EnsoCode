import { conversationCwd } from '@shared/conversationCwd';

export function sessionWorkspaceCwd(
  project: { kind?: string; path: string } | undefined,
  conversationId: string,
  conversations: Record<
    string,
    { parentId?: string; btwParentId?: string; worktree?: { path: string } } | undefined
  >
): string | undefined {
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
    return (
      conversationCwd({
        kind: project.kind,
        canonicalPath: project.path,
        conversationId: id,
        worktreePath: conversation.worktree?.path,
      }) ?? undefined
    );
  }
}
