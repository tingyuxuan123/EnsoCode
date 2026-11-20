import type { MemoryNoteSummary } from '@shared/memory/dto';

export type WikiTreeGroupMode = 'folder' | 'type';

export interface WikiTreeNode {
  id: string;
  kind: 'folder' | 'note';
  label: string;
  path: string;
  note?: MemoryNoteSummary;
  children: WikiTreeNode[];
}

function insertPath(
  root: WikiTreeNode[],
  segments: string[],
  fullPrefix: string,
  note: MemoryNoteSummary
): void {
  const [head, ...rest] = segments;
  if (!head) return;
  if (rest.length === 0) {
    root.push({
      id: `file:${note.id}`,
      kind: 'note',
      label: note.title || head.replace(/\.md$/i, ''),
      path: note.relPath,
      note,
      children: [],
    });
    return;
  }
  const folderPath = fullPrefix ? `${fullPrefix}/${head}` : head;
  let folder = root.find((item) => item.kind === 'folder' && item.path === folderPath);
  if (!folder) {
    folder = {
      id: `dir:${folderPath}`,
      kind: 'folder',
      label: head,
      path: folderPath,
      children: [],
    };
    root.push(folder);
  }
  insertPath(folder.children, rest, folderPath, note);
}

function sortFolderTree(nodes: WikiTreeNode[], topLevel = false): WikiTreeNode[] {
  const TOP_ORDER: Record<string, number> = { wiki: 0, raw: 1, archive: 2 };
  nodes.sort((a, b) => {
    if (topLevel) {
      const ra = TOP_ORDER[a.label] ?? 9;
      const rb = TOP_ORDER[b.label] ?? 9;
      if (ra !== rb) return ra - rb;
    }
    if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
    return a.label.localeCompare(b.label);
  });
  for (const node of nodes) {
    if (node.kind === 'folder') sortFolderTree(node.children, false);
  }
  return nodes;
}

export function buildWikiFileTree(
  notes: readonly MemoryNoteSummary[],
  opts: { groupMode: WikiTreeGroupMode }
): WikiTreeNode[] {
  if (opts.groupMode === 'type') {
    const active = notes.filter((n) => !n.isArchived && !n.isRaw);
    const raw = notes.filter((n) => !n.isArchived && n.isRaw);
    const archived = notes.filter((n) => n.isArchived);

    const byType = new Map<string, MemoryNoteSummary[]>();
    for (const note of active) {
      const key = note.type || 'notes';
      const bucket = byType.get(key) ?? [];
      bucket.push(note);
      byType.set(key, bucket);
    }

    const groups: WikiTreeNode[] = [...byType.keys()]
      .sort((a, b) => a.localeCompare(b))
      .map((type) => ({
        id: `type:${type}`,
        kind: 'folder',
        label: type,
        path: type,
        children: [...(byType.get(type) ?? [])]
          .sort((a, b) => a.title.localeCompare(b.title))
          .map((note) => ({
            id: `file:${note.id}`,
            kind: 'note',
            label: note.title || note.slug,
            path: note.relPath,
            note,
            children: [],
          })),
      }));

    if (raw.length > 0) {
      groups.push({
        id: 'type:raw',
        kind: 'folder',
        label: 'raw',
        path: 'raw',
        children: [...raw]
          .sort((a, b) => a.relPath.localeCompare(b.relPath))
          .map((note) => ({
            id: `file:${note.id}`,
            kind: 'note',
            label: note.title || note.slug,
            path: note.relPath,
            note,
            children: [],
          })),
      });
    }
    if (archived.length > 0) {
      groups.push({
        id: 'type:archive',
        kind: 'folder',
        label: 'archive',
        path: 'archive',
        children: [...archived]
          .sort((a, b) => a.title.localeCompare(b.title))
          .map((note) => ({
            id: `file:${note.id}`,
            kind: 'note',
            label: note.title || note.slug,
            path: note.relPath,
            note,
            children: [],
          })),
      });
    }
    return groups;
  }

  const root: WikiTreeNode[] = [];
  for (const note of notes) {
    const segments = note.relPath.split('/').filter(Boolean);
    if (segments.length === 1) {
      root.push({
        id: `file:${note.id}`,
        kind: 'note',
        label: note.title || segments[0].replace(/\.md$/i, ''),
        path: note.relPath,
        note,
        children: [],
      });
    } else {
      insertPath(root, segments, '', note);
    }
  }
  return sortFolderTree(root, true);
}
