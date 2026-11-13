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

/** 会话预设可以叠加插件预设；自建预设里的插件预设字段由 agentHost 注入 */
export interface PluginPresetOverlaySource {
  pluginPresetId?: string;
}

/**
 * 会话预设拆成「自建预设」和「插件预设」两层：
 * 直接选插件预设时它必须可用；自建预设叠加的插件预设可缺省。
 */
export function presetOverlay<T extends PluginPresetOverlaySource>(
  presetId: string | undefined,
  resolve: (id?: string) => T | undefined
): { preset?: T; pluginPresetId?: string; required: boolean } {
  if (presetId && isPluginPresetId(presetId)) return { pluginPresetId: presetId, required: true };
  const preset = resolve(presetId);
  const pluginPresetId =
    preset?.pluginPresetId && isPluginPresetId(preset.pluginPresetId)
      ? preset.pluginPresetId
      : undefined;
  return {
    ...(preset ? { preset } : {}),
    ...(pluginPresetId ? { pluginPresetId } : {}),
    required: false,
  };
}
