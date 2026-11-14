import { describe, expect, it } from 'vitest';
import {
  type ExtensionCatalogEntry,
  filterExtensionCatalog,
  mcpExtensionStatus,
  resolveExtensionEmptyState,
} from './extensionCatalog';

const catalog: ExtensionCatalogEntry[] = [
  {
    kind: 'skill',
    id: 'shared',
    name: 'Review Changes',
    description: 'Inspect diffs',
    source: 'Claude Code',
    status: 'Enabled',
  },
  {
    kind: 'mcp',
    id: 'shared',
    name: 'Docs',
    description: '官方组件文档',
    source: 'Manual',
    status: 'Connected',
  },
  {
    kind: 'plugin',
    id: 'demo.notes',
    name: 'Local Notes',
    description: '',
    source: 'Enso plugins',
    version: '1.2.3',
    status: 'Disabled',
  },
];

describe('extension catalog', () => {
  it('联合分类和关键词筛选，不把不同类型的同 ID 条目混为一项', () => {
    expect(filterExtensionCatalog(catalog, 'mcp', ' 官方 ')).toEqual([catalog[1]]);
    expect(filterExtensionCatalog(catalog, 'all', 'SHARED')).toEqual(catalog.slice(0, 2));
    expect(filterExtensionCatalog(catalog, 'skill', '官方')).toEqual([]);
  });

  it('支持按来源、版本和多个关键词查找', () => {
    expect(filterExtensionCatalog(catalog, 'all', 'claude diff')).toEqual([catalog[0]]);
    expect(filterExtensionCatalog(catalog, 'plugin', '1.2.3 notes')).toEqual([catalog[2]]);
  });

  it('已启用但没有连接事件不显示已连接；停用优先于旧连接状态', () => {
    expect(mcpExtensionStatus(true)).toBe('Not connected');
    expect(mcpExtensionStatus(true, 'ready')).toBe('Connected');
    expect(mcpExtensionStatus(false, 'ready')).toBe('Disabled');
    expect(mcpExtensionStatus(true, 'unauthorized')).toBe('Not authorized');
    expect(mcpExtensionStatus(true, 'error')).toBe('Connection failed');
  });
});

describe('extension empty state', () => {
  it('有可见条目时不进入空态', () => {
    expect(
      resolveExtensionEmptyState({ total: 2, visible: 1, filter: 'all', query: '' })
    ).toBeNull();
  });

  it('目录为空、无关键词、全部分类时是首次空态', () => {
    expect(resolveExtensionEmptyState({ total: 0, visible: 0, filter: 'all', query: '  ' })).toBe(
      'first-run'
    );
  });

  it('有关键词时即使目录为空也按搜索无结果提示', () => {
    expect(resolveExtensionEmptyState({ total: 0, visible: 0, filter: 'all', query: 'zzz' })).toBe(
      'no-results'
    );
    expect(
      resolveExtensionEmptyState({ total: 3, visible: 0, filter: 'skill', query: 'zzz' })
    ).toBe('no-results');
  });

  it('只切了分类且该分类没有条目时是分类空态，不与首次空态混用', () => {
    expect(resolveExtensionEmptyState({ total: 0, visible: 0, filter: 'mcp', query: '' })).toBe(
      'category-empty'
    );
    expect(resolveExtensionEmptyState({ total: 4, visible: 0, filter: 'plugin', query: '' })).toBe(
      'category-empty'
    );
  });
});
