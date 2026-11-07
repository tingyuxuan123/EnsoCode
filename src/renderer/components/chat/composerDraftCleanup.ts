/** Subscribe to metadata removals only; empty/cold history is never a deletion. */
export function bindComposerDraftCleanup(
  subscribe: (
    listener: (
      state: { conversations: Record<string, unknown> },
      previous: { conversations: Record<string, unknown> }
    ) => void
  ) => () => void,
  remove: (key: string) => void
): () => void {
  return subscribe((state, previous) => {
    if (state.conversations === previous.conversations) return;
    for (const id of Object.keys(previous.conversations)) {
      if (!(id in state.conversations)) remove(id);
    }
  });
}
