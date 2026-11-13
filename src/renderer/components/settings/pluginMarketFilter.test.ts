import { expect, it } from 'vitest';
import { filterMarketPlugins, marketSections } from './pluginMarketFilter';

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
