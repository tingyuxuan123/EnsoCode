import { parsePluginInstallUrl } from './extensionPlugins/installUrl';
export const SETTINGS_CATEGORIES = [
  'general',
  'shortcuts',
  'voice',
  'appearance',
  'providers',
  'skills',
  'plugins',
  'mcp',
  'instructions',
  'presets',
  'agents',
  'workflows',
  'tools',
  'memory',
  'phone',
  'ssh',
  'usage',
  'resources',
  'experimental',
  'bots',
  'botTemplates',
] as const;

export type SettingsCategory = (typeof SETTINGS_CATEGORIES)[number];

export interface SettingsDeepLink {
  category: SettingsCategory;
  rowId: string;
  pluginInstallUrl?: string;
  pluginId?: string;
}

const CATEGORY_SET = new Set<string>(SETTINGS_CATEGORIES);

export function parseSettingsDeepLink(raw: unknown): SettingsDeepLink | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const category = (raw as { category?: unknown }).category;
  const rowId = (raw as { rowId?: unknown }).rowId;
  if (typeof category !== 'string' || !CATEGORY_SET.has(category)) return null;
  if (typeof rowId !== 'string' || !rowId) return null;
  const record = raw as Record<string, unknown>;
  const extras: Pick<SettingsDeepLink, 'pluginId' | 'pluginInstallUrl'> = {};
  if (record.pluginInstallUrl !== undefined) {
    if (
      category !== 'plugins' ||
      rowId !== 'plugins.enso' ||
      typeof record.pluginInstallUrl !== 'string' ||
      record.pluginInstallUrl.length > 2048
    )
      return null;
    const parsed = parsePluginInstallUrl(record.pluginInstallUrl);
    if (!parsed.ok) return null;
    extras.pluginInstallUrl = parsed.url.href;
  }
  if (record.pluginId !== undefined) {
    if (
      category !== 'plugins' ||
      typeof record.pluginId !== 'string' ||
      record.pluginId.length > 40 ||
      !/^[a-z][a-z0-9]*(\.[a-z0-9]+)+$/.test(record.pluginId)
    )
      return null;
    extras.pluginId = record.pluginId;
  }
  return { category: category as SettingsCategory, rowId, ...extras };
}
