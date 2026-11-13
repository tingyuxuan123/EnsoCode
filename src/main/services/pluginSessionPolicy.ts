/** 会话目录已经 Main 来源权威过滤；不接受插件自报的路径或 ID 前缀。 */
export function pluginUiSessionAllowed(
  sessionId: string,
  sessions: readonly { id: string }[] | null
): boolean {
  return sessions?.some((session) => session.id === sessionId) ?? false;
}
