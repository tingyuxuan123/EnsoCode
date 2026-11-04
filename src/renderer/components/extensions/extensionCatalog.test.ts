import { describe, expect, it } from 'vitest';
import {
  type ExtensionCatalogEntry,
  filterExtensionCatalog,
  mcpExtensionStatus,
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
