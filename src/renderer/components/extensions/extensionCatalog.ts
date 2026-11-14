import type { McpConnectionState } from '@shared/types/agent';

export const EXTENSION_KINDS = ['skill', 'mcp', 'plugin'] as const;
export type ExtensionKind = (typeof EXTENSION_KINDS)[number];
export type ExtensionFilter = 'all' | ExtensionKind;

export interface ExtensionCatalogEntry {
  kind: ExtensionKind;
  id: string;
  name: string;
  description: string;
  source: string;
  version?: string;
  status: string;
}

export function filterExtensionCatalog<T extends ExtensionCatalogEntry>(
  entries: readonly T[],
  filter: ExtensionFilter,
  query: string
): T[] {
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return entries.filter((entry) => {
    if (filter !== 'all' && entry.kind !== filter) return false;
    const text = [entry.name, entry.id, entry.description, entry.source, entry.version]
      .join(' ')
      .toLowerCase();
    return terms.every((term) => text.includes(term));
  });
}

export function mcpExtensionStatus(enabled: boolean, state?: McpConnectionState): string {
  if (!enabled) return 'Disabled';
  switch (state) {
    case 'ready':
      return 'Connected';
    case 'connecting':
      return 'Connecting';
    case 'unauthorized':
      return 'Not authorized';
    case 'idle':
      return 'Authorized, pending connection';
    case 'error':
      return 'Connection failed';
    default:
      return 'Not connected';
  }
}

export type ExtensionEmptyState = 'first-run' | 'no-results' | 'category-empty';

/** 区分首次空、搜索无结果和分类为空，避免把筛选失败说成还没有安装任何扩展。 */
export function resolveExtensionEmptyState({
  total,
  visible,
  filter,
  query,
}: {
  total: number;
  visible: number;
  filter: ExtensionFilter;
  query: string;
}): ExtensionEmptyState | null {
  if (visible > 0) return null;
  if (query.trim()) return 'no-results';
  if (filter !== 'all') return 'category-empty';
  return total === 0 ? 'first-run' : null;
}
