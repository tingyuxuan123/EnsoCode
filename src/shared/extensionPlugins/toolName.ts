const EXTERNAL = /^plugin_([a-z][a-z0-9]*(?:-[a-z0-9]+)+)__([a-z][a-z0-9_]*)$/;
export function pluginToolName(pluginId: string, toolName: string): string {
  return `plugin_${pluginId.replaceAll('.', '-')}__${toolName}`;
}
export function parsePluginToolName(name: string): { pluginId: string; toolName: string } | null {
  const match = EXTERNAL.exec(name);
  if (!match?.[1] || !match[2] || match[2].includes('__') || name.length > 64) return null;
  return { pluginId: match[1].replaceAll('-', '.'), toolName: match[2] };
}
