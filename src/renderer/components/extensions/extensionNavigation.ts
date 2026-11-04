interface SessionSelection {
  id: string | null;
  tab?: string;
}

export function isExtensionsSessionNavigation(
  previous: SessionSelection,
  next: SessionSelection
): boolean {
  // activeTabId can be cleared by background coworker cleanup, not just explicit navigation.
  return previous.id !== next.id;
}
