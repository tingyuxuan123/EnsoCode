import {
  MARKET_CATEGORIES,
  MARKET_CATEGORY_LABELS,
} from '@shared/extensionPlugins/marketCategories';
import { expect, it } from 'vitest';
import {
  filterMarketPlugins,
  type MarketSection,
  marketSectionLabel,
  marketSections,
} from './pluginMarketFilter';

it('filters market categories, installed/updates and searches tags while keeping official first', () => {
  const plugins = [
    {
      id: 'local.b',
      name: 'B',
      description: '',
      tier: 'community' as const,
      tags: ['csv'],
      updateAvailable: false,
    },
    {
      id: 'local.a',
      name: 'A',
      description: '',
      tier: 'official' as const,
      tags: ['csv'],
      installedVersion: '1',
      updateAvailable: true,
    },
  ];
  expect(filterMarketPlugins(plugins, { query: 'CSV', section: 'all' }).map((p) => p.id)).toEqual([
    'local.a',
    'local.b',
  ]);
  expect(filterMarketPlugins(plugins, { query: '', section: 'updates' })).toHaveLength(1);
  expect(marketSections(plugins).find((section) => section.id === 'installed')?.count).toBe(1);
});

it('分段标签按界面语言取名称，不回退成内核小写 id', () => {
  expect(marketSectionLabel('themes', 'zh')).toBe('主题外观');
  expect(marketSectionLabel('themes', 'en')).toBe('Themes');
  expect(marketSectionLabel('agent', 'zh')).toBe('Agent 能力');
  expect(marketSectionLabel('all', 'zh')).toBe('全部');
  expect(marketSectionLabel('all', 'en')).toBe('All');
  expect(marketSectionLabel('installed', 'zh')).toBe('已安装');
  expect(marketSectionLabel('updates', 'en')).toBe('Updates');
  expect(marketSectionLabel('other', 'zh')).toBe('其他');
});

it('每个分段在中英文下都有非空、互不相同的标签', () => {
  const sections: MarketSection[] = ['all', 'installed', 'updates', ...MARKET_CATEGORIES, 'other'];
  for (const locale of ['zh', 'en'] as const) {
    const labels = sections.map((section) => marketSectionLabel(section, locale));
    expect(new Set(labels).size).toBe(sections.length);
    labels.forEach((label, index) => {
      expect(label.trim()).not.toBe('');
      // 直接 t(raw id) 时这里拿到的就是小写 id
      expect(label).not.toBe(sections[index]);
    });
  }
  // 中文分类沿用 shared 里唯一的分类表，中文界面不出现英文原文回退
  for (const section of sections)
    expect(marketSectionLabel(section, 'zh')).toMatch(/[\u4e00-\u9fa5]/);
  for (const section of MARKET_CATEGORIES)
    expect(marketSectionLabel(section, 'zh')).toBe(MARKET_CATEGORY_LABELS[section]);
});
