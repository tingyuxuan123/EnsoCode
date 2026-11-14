import {
  MARKET_CATEGORIES,
  MARKET_CATEGORY_EN_LABELS,
  MARKET_CATEGORY_LABELS,
  type MarketCategory,
} from '@shared/extensionPlugins/marketCategories';
import { getTranslation, type Locale } from '@shared/i18n';
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

/** 固定分段沿用 i18n 的英文原文 key；分类走两份已对齐的分类表 */
const FIXED_SECTION_KEYS = {
  all: 'All',
  installed: 'Installed',
  updates: 'Updates',
  other: 'Other',
} as const;

export function marketSectionLabel(section: MarketSection, locale: Locale): string {
  if (section === 'all' || section === 'installed' || section === 'updates' || section === 'other')
    return getTranslation(locale, FIXED_SECTION_KEYS[section]);
  return locale === 'zh' ? MARKET_CATEGORY_LABELS[section] : MARKET_CATEGORY_EN_LABELS[section];
}
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
