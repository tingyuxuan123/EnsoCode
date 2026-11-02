/** Renderer-safe lexical projection. Main must additionally validate filesystem authority. */
export function conversationCwd(input: {
  kind?: string;
  canonicalPath: string;
  conversationId: string;
  worktreePath?: string;
}): string | null {
  if (input.kind === 'scratch') {
    if (
      !input.canonicalPath ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        input.conversationId
      )
    )
      return null;
    const sep = input.canonicalPath.includes('/') ? '/' : '\\';
    return `${input.canonicalPath.replace(/[\\/]+$/, '')}${sep}${input.conversationId}`;
  }
  if (input.kind === 'ssh') return input.canonicalPath || null;
  return input.worktreePath || input.canonicalPath || null;
}
