import { MARKET_CATEGORIES, type MarketCategory } from '@shared/extensionPlugins/marketCategories';
export interface MarketFilterItem {
  id: string;
  name: string;
  description: string;
  tier: 'official' | 'community';
  tags: string[];
  category?: MarketCategory;
  installedVersion?: string;
  updateAvailable: boolean;
}
export type MarketSection = 'all' | 'installed' | 'updates' | MarketCategory | 'other';
function inSection(plugin: MarketFilterItem, section: MarketSection): boolean {
  if (section === 'all') return true;
  if (section === 'installed') return plugin.installedVersion !== undefined;
  if (section === 'updates') return plugin.updateAvailable;
  if (section === 'other') return plugin.category === undefined;
  return plugin.category === section;
}
export function marketSections(
  plugins: readonly MarketFilterItem[]
): { id: MarketSection; count: number }[] {
  const count = (section: MarketSection) =>
    plugins.filter((plugin) => inSection(plugin, section)).length;
  return [
    ...(['all', 'installed', 'updates'] as const).map((id) => ({ id, count: count(id) })),
    ...([...MARKET_CATEGORIES, 'other'] as const)
      .map((id) => ({ id, count: count(id) }))
      .filter((item) => item.count > 0),
  ];
}
export function filterMarketPlugins<T extends MarketFilterItem>(
  plugins: readonly T[],
  options: { query: string; section: MarketSection }
): T[] {
  const query = options.query.trim().toLowerCase();
  return plugins
    .filter(
      (plugin) =>
        inSection(plugin, options.section) &&
        (!query ||
          [plugin.id, plugin.name, plugin.description, ...plugin.tags].some((text) =>
            text.toLowerCase().includes(query)
          ))
    )
    .sort((a, b) =>
      a.tier !== b.tier ? (a.tier === 'official' ? -1 : 1) : a.name.localeCompare(b.name)
    );
}
