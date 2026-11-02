/** User-configured MCP names are not restricted to plugin-local ASCII identifiers. */
export function isPluginMcpServerName(value: unknown): value is string {
  return (
    typeof value === 'string' && value.length > 0 && value.length <= 128 && !/\p{Cc}/u.test(value)
  );
}
export function parsePluginMcpGrant(value: unknown): { server: string; tool: string } | null {
  if (typeof value !== 'string') return null;
  const separator = value.lastIndexOf('/');
  const server = value.slice(0, separator);
  const tool = value.slice(separator + 1);
  return separator > 0 && isPluginMcpServerName(server) && /^[A-Za-z0-9_.-]{1,64}$/.test(tool)
    ? { server, tool }
    : null;
}
export function hasPluginMcpGrant(
  grants: readonly string[],
  server: string,
  tool: string
): boolean {
  return grants.some((grant) => {
    const parsed = parsePluginMcpGrant(grant);
    return parsed?.server === server && parsed.tool === tool;
  });
}
