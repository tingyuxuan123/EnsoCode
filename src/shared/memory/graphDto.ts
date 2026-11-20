import type { NoteStatus } from './constants';

/**
 * 知识视图（[[wikilink]] 图谱 / 分类树）的数据契约。
 */

export interface GraphNodeDto {
  /** Canonical note ID (`${spaceId}::${relPath}`) */
  id: string;
  spaceId: string;
  spaceLabel: string;
  slug: string;
  title: string;
  noteType: string;
  status: NoteStatus;
  /** 入链 + 出链总数，决定节点视觉大小 */
  linkCount: number;
  isRaw: boolean;
  isArchived: boolean;
}

export interface GraphEdgeDto {
  source: string;
  target: string;
  label: string;
}

export interface MemoryGraphDto {
  nodes: GraphNodeDto[];
  edges: GraphEdgeDto[];
  totalNotes: number;
}

export interface GraphQuery {
  spaceId?: string | null;
  limit: number;
  includeOrphans?: boolean;
  includeArchived?: boolean;
}

export type TreeNodeKind = 'space' | 'group' | 'note';
export type TreeGrouping = 'type' | 'status' | 'space';

export interface TreeNodeDto {
  id: string;
  kind: TreeNodeKind;
  label: string;
  count: number;
  noteId?: string;
  slug?: string;
  status?: NoteStatus;
  children?: TreeNodeDto[];
}

export interface TreeQuery {
  spaceId?: string | null;
  groupBy: TreeGrouping;
  limitPerGroup: number;
  includeArchived?: boolean;
}

export function isGraphQuery(value: unknown): value is GraphQuery {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  if (
    !Number.isSafeInteger(row.limit) ||
    (row.limit as number) < 1 ||
    (row.limit as number) > 500
  ) {
    return false;
  }
  if (row.spaceId !== undefined && row.spaceId !== null && typeof row.spaceId !== 'string') {
    return false;
  }
  if (row.includeOrphans !== undefined && typeof row.includeOrphans !== 'boolean') return false;
  if (row.includeArchived !== undefined && typeof row.includeArchived !== 'boolean') return false;
  return true;
}

export function isTreeQuery(value: unknown): value is TreeQuery {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  if (row.groupBy !== 'type' && row.groupBy !== 'status' && row.groupBy !== 'space') return false;
  if (
    !Number.isSafeInteger(row.limitPerGroup) ||
    (row.limitPerGroup as number) < 1 ||
    (row.limitPerGroup as number) > 200
  ) {
    return false;
  }
  if (row.spaceId !== undefined && row.spaceId !== null && typeof row.spaceId !== 'string') {
    return false;
  }
  if (row.includeArchived !== undefined && typeof row.includeArchived !== 'boolean') return false;
  return true;
}
