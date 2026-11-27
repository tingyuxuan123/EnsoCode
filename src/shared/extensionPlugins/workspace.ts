/** A UI-only selection. Main derives the root; callers never supply filesystem paths. */
export interface PluginWorkspaceContext {
  projectId: string;
  /** Only registered local root conversations may identify an isolated worktree. */
  conversationId?: string;
}

export interface PluginWorkspaceProject {
  key: string;
  name: string;
  kind: 'project' | 'worktree';
  context: PluginWorkspaceContext;
}

export interface PluginWorkspaceProjects {
  current: PluginWorkspaceContext | null;
  projects: PluginWorkspaceProject[];
}

/** null is explicitly global; undefined means invalid input. */
export function parsePluginWorkspaceContext(
  raw: unknown
): PluginWorkspaceContext | null | undefined {
  if (raw === null) return null;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const value = raw as Record<string, unknown>;
  const validId = (id: unknown): id is string =>
    typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id);
  if (
    Object.keys(value).some((key) => key !== 'projectId' && key !== 'conversationId') ||
    !validId(value.projectId) ||
    (value.conversationId !== undefined && !validId(value.conversationId))
  )
    return undefined;
  return {
    projectId: value.projectId,
    ...(typeof value.conversationId === 'string' ? { conversationId: value.conversationId } : {}),
  };
}

export function workspaceContextKey(context: PluginWorkspaceContext | null): string {
  return context === null ? 'global' : JSON.stringify(context);
}
