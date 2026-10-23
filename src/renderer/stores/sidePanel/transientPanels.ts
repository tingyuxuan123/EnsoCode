import type { SerializedDockview } from 'dockview-react';
import { filterSidePanelLayout, filterSidePanelTabGroups } from './layoutSanitize';

export function isSubagentPanel(id: string): boolean {
  return id.startsWith('subagent:') || id.startsWith('subagents:');
}

function isTransientPanel(id: string, panel: SerializedDockview['panels'][string]): boolean {
  return (
    isSubagentPanel(id) ||
    panel.contentComponent === 'subagent-session' ||
    panel.contentComponent === 'subagent-directory'
  );
}

/** Strip observers only at the persistence boundary; keep full layouts in renderer memory. */
export function stripTransientSidePanelLayouts(
  layouts: Record<string, SerializedDockview | undefined>
): Record<string, SerializedDockview | undefined> {
  return Object.fromEntries(
    Object.entries(layouts).map(([id, layout]) => {
      if (
        !layout ||
        !Object.entries(layout.panels).some(([key, panel]) => isTransientPanel(key, panel))
      ) {
        return [id, layout];
      }
      const panels = Object.fromEntries(
        Object.entries(layout.panels).filter(([key, panel]) => !isTransientPanel(key, panel))
      );
      // All remaining components, including future/custom ones, must survive unchanged.
      const sanitized = filterSidePanelLayout(layout, new Set(Object.keys(panels)));
      if (!sanitized) return [id, undefined];
      const groups: string[] = [];
      const keep = new Set(Object.keys(panels));
      const filterGroup = <T extends { views: string[]; activeView?: string; id: string }>(
        group: T
      ): T | undefined => {
        const views = group.views.filter((view) => keep.has(view));
        if (!views.length) return undefined;
        groups.push(group.id);
        return {
          ...group,
          views,
          activeView:
            group.activeView && views.includes(group.activeView) ? group.activeView : views[0],
          ...('tabGroups' in group
            ? { tabGroups: filterSidePanelTabGroups(group.tabGroups, keep) }
            : {}),
        };
      };
      const visit = (node: unknown): void => {
        if (!node || typeof node !== 'object') return;
        const value = node as { type?: unknown; data?: unknown };
        if (value.type === 'branch' && Array.isArray(value.data)) value.data.forEach(visit);
        if (
          value.type === 'leaf' &&
          value.data &&
          typeof value.data === 'object' &&
          'id' in value.data &&
          typeof value.data.id === 'string'
        )
          groups.push(value.data.id);
      };
      visit(sanitized.grid.root);
      const filterWindows = <
        T extends {
          data?: { views: string[]; activeView?: string; id: string };
          grid?: SerializedDockview['grid'];
        },
      >(
        windows: T[]
      ): T[] =>
        windows.flatMap((item) => {
          if (item.data) {
            const data = filterGroup(item.data);
            return data ? [{ ...item, data }] : [];
          }
          if (item.grid) {
            const shell = filterSidePanelLayout({ grid: item.grid, panels }, keep);
            if (!shell || (Array.isArray(shell.grid.root.data) && !shell.grid.root.data.length))
              return [];
            visit(shell.grid.root);
            return [{ ...item, grid: shell.grid }];
          }
          return [item];
        });
      if (sanitized.floatingGroups)
        sanitized.floatingGroups = filterWindows(sanitized.floatingGroups);
      if (sanitized.popoutGroups) sanitized.popoutGroups = filterWindows(sanitized.popoutGroups);
      if (sanitized.edgeGroups) {
        sanitized.edgeGroups = Object.fromEntries(
          Object.entries(sanitized.edgeGroups).flatMap(([position, edge]) => {
            if (
              !edge.group ||
              typeof edge.group !== 'object' ||
              !('views' in edge.group) ||
              !Array.isArray(edge.group.views) ||
              !('id' in edge.group) ||
              typeof edge.group.id !== 'string'
            )
              return [[position, edge]];
            const group = filterGroup(
              edge.group as { views: string[]; id: string; activeView?: string }
            );
            return group ? [[position, { ...edge, group }]] : [];
          })
        );
      }
      if (sanitized.activeGroup && !groups.includes(sanitized.activeGroup))
        sanitized.activeGroup = groups[0];
      return [id, sanitized];
    })
  );
}
