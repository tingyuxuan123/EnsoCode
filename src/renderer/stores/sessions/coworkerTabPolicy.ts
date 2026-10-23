function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** 交互标签只对应直属、在编、未结束的持久协作者；关闭视图不改变这份资格。 */
export function canSelectCoworkerTab(
  conversations: Record<string, unknown>,
  parentId: string,
  childId: string
): boolean {
  const parent = record(conversations[parentId]);
  const child = record(conversations[childId]);
  const metadata = record(child?.child);
  return Boolean(
    parent &&
      child &&
      childId !== parentId &&
      !parent.parentId &&
      !parent.btwParentId &&
      !parent.child &&
      child.parentId === parentId &&
      (!metadata?.parentId || metadata.parentId === parentId) &&
      Array.isArray(parent.coworkerIds) &&
      parent.coworkerIds.includes(childId) &&
      (metadata?.mode === undefined || metadata.mode === 'coworker') &&
      child.ended !== true &&
      child.historyOnly !== true
  );
}
