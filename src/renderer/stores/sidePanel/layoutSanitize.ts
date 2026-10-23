import type { SerializedDockview } from 'dockview-react';

type GridNode = {
  type?: unknown;
  data?: unknown;
  size?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function keepPanel(id: string, panel: unknown, known: ReadonlySet<string>): boolean {
  if (!isRecord(panel)) return false;
  const kind =
    typeof panel.contentComponent === 'string'
      ? panel.contentComponent
      : typeof panel.component === 'string'
        ? panel.component
        : undefined;
  if (kind && known.has(kind)) return true;
  return id === 'browser' || id.startsWith('browser:');
}

export function filterSidePanelTabGroups(value: unknown, keep: ReadonlySet<string>): unknown {
  if (!Array.isArray(value)) return value;
  return value.flatMap((group) => {
    if (!isRecord(group) || !Array.isArray(group.panelIds)) return [group];
    const panelIds = group.panelIds.filter(
      (id): id is string => typeof id === 'string' && keep.has(id)
    );
    return panelIds.length ? [{ ...group, panelIds }] : [];
  });
}

function sanitizeNode(node: unknown, keep: ReadonlySet<string>): GridNode | undefined {
  if (!isRecord(node)) return undefined;
  if (node.type === 'leaf') {
    const data = isRecord(node.data) ? node.data : undefined;
    const views = Array.isArray(data?.views)
      ? data.views.filter((id): id is string => typeof id === 'string' && keep.has(id))
      : [];
    if (views.length === 0) return undefined;
    const activeView =
      typeof data?.activeView === 'string' && keep.has(data.activeView)
        ? data.activeView
        : views[0];
    return {
      ...node,
      type: 'leaf',
      data: {
        ...data,
        views,
        activeView,
        ...(data?.tabGroups ? { tabGroups: filterSidePanelTabGroups(data.tabGroups, keep) } : {}),
      },
      size: node.size,
    };
  }
  if (node.type === 'branch') {
    const children = Array.isArray(node.data)
      ? node.data.flatMap((child) => {
          const next = sanitizeNode(child, keep);
          return next ? [next] : [];
        })
      : [];
    if (children.length === 0) return undefined;
    return { ...node, type: 'branch', data: children, size: node.size };
  }
  return undefined;
}

/** Prune selected tab IDs without interpreting or dropping other component types. */
export function filterSidePanelLayout(
  layout: SerializedDockview,
  keep: ReadonlySet<string>
): SerializedDockview | undefined {
  const root = sanitizeNode(layout.grid.root, keep);
  if (keep.size === 0) return undefined;
  return {
    ...layout,
    panels: Object.fromEntries(Object.entries(layout.panels).filter(([id]) => keep.has(id))),
    grid: { ...layout.grid, root: root ?? { type: 'branch', data: [] } },
  } as SerializedDockview;
}

export function sanitizeSidePanelLayout(
  layout: unknown,
  knownComponents: ReadonlySet<string>
): SerializedDockview | undefined {
  if (!isRecord(layout) || !isRecord(layout.panels)) return undefined;
  const panels: Record<string, unknown> = {};
  for (const [id, panel] of Object.entries(layout.panels)) {
    if (keepPanel(id, panel, knownComponents)) panels[id] = panel;
  }
  const keep = new Set(Object.keys(panels));
  if (keep.size === 0) return undefined;
  const grid = isRecord(layout.grid) ? layout.grid : undefined;
  const root = grid ? sanitizeNode(grid.root, keep) : undefined;
  if (!root) return undefined;
  return {
    ...layout,
    panels,
    grid: { ...grid, root },
  } as SerializedDockview;
}
