const PLUGIN_ID = /^[a-z][a-z0-9]*(\.[a-z0-9]+)+$/;
const LOCAL_ID = /^[a-z][a-z0-9-]{0,31}$/;
export function pluginPresetId(pluginId: string, localId: string): string {
  return `plugin:${pluginId}:${localId}`;
}
export function parsePluginPresetId(id: string): { pluginId: string; localId: string } | undefined {
  const parts = id.split(':');
  if (
    parts.length !== 3 ||
    parts[0] !== 'plugin' ||
    parts[1].length > 40 ||
    !PLUGIN_ID.test(parts[1]) ||
    !LOCAL_ID.test(parts[2])
  )
    return undefined;
  return { pluginId: parts[1], localId: parts[2] };
}
export function isPluginPresetId(id: string): boolean {
  return parsePluginPresetId(id) !== undefined;
}
