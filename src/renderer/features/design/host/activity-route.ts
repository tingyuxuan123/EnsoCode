/** Exact cwd matching: the currently viewed child/tab wins over sibling sessions. */
export function resolveDesignActivitySession(
  sessions: readonly { id: string; cwd: string | undefined }[],
  viewingId: string | null,
  cwd?: string
): string | null {
  const viewed = sessions.find((session) => session.id === viewingId);
  if (!cwd) return viewed?.id ?? null;
  return (
    (viewed?.cwd === cwd ? viewed.id : sessions.find((session) => session.cwd === cwd)?.id) ?? null
  );
}

export function viewedDesignSessionId(
  conversations: Record<string, { activeTabId?: string } | undefined>,
  parentId: string | null
): string | null {
  const child = parentId ? conversations[parentId]?.activeTabId : undefined;
  return child && conversations[child] ? child : parentId;
}

/** A late callback from a disposed canvas cannot act on the newly selected chat. */
export function resolveDesignPromptTarget(
  viewedId: string | null,
  canvasId: string | null,
  conversationId: string | null
): string | null {
  const target = canvasId ?? conversationId;
  return target && target === viewedId ? target : null;
}
