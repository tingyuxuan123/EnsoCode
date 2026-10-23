interface DockConversation {
  btwParentId?: string;
  projectId?: string;
  parentId?: string;
  child?: { parentId: string; agentInstanceId: string };
  worktree?: { path?: string };
}

export function resolveSidePanelDockConversationId(
  conversations: Record<string, DockConversation | undefined>,
  conversationId: string
): string {
  const seen = new Set<string>();
  let ownerId = conversationId;
  while (!seen.has(ownerId)) {
    seen.add(ownerId);
    const conversation = conversations[ownerId];
    if (conversation?.btwParentId) {
      ownerId = conversation.btwParentId;
      continue;
    }
    const parentId = conversation?.child?.parentId;
    const parent = parentId ? conversations[parentId] : undefined;
    if (
      !parentId ||
      !parent ||
      !conversation?.child?.agentInstanceId ||
      conversation.parentId !== parentId ||
      !conversation.projectId ||
      conversation.projectId !== parent.projectId ||
      (conversation.worktree?.path && conversation.worktree.path !== parent.worktree?.path)
    )
      return ownerId;
    ownerId = parentId;
  }
  return conversationId;
}
