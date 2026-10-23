import type { SerializedDockview } from 'dockview-react';
import { describe, expect, it } from 'vitest';
import { isSubagentPanel, stripTransientSidePanelLayouts } from './transientPanels';

const layout = (panels: Record<string, unknown>, leaves: string[][]) =>
  ({
    panels,
    activeGroup: 'g0',
    grid: {
      width: 600,
      height: 800,
      orientation: 'HORIZONTAL',
      root: {
        type: 'branch',
        size: 600,
        data: leaves.map((views, i) => ({
          type: 'leaf',
          size: 300,
          data: { id: `g${i}`, views, activeView: views[0] },
        })),
      },
    },
  }) as SerializedDockview;

describe('transient observer panels', () => {
  it('recognizes detail and directory close branches without treating other resources as observers', () => {
    expect(isSubagentPanel('subagent:child')).toBe(true);
    expect(isSubagentPanel('subagents:parent')).toBe(true);
    for (const id of ['terminal', 'btw:child', 'browser:child', 'workflow', 'files']) {
      expect(isSubagentPanel(id)).toBe(false);
    }
  });

  it('strips only transient panels, preserving other layout geometry and params without mutation', () => {
    const source = layout(
      {
        'subagent:c': { contentComponent: 'subagent-session' },
        'subagents:p': { contentComponent: 'subagent-directory' },
        t: { contentComponent: 'terminal', params: { cwd: '/repo' } },
        files: { contentComponent: 'files' },
        custom: { contentComponent: 'future-component' },
      },
      [['subagent:c', 't', 'files'], ['subagents:p'], ['custom']]
    );
    const result = stripTransientSidePanelLayouts({ p: source }).p;
    expect(Object.keys(result?.panels ?? {})).toEqual(['t', 'files', 'custom']);
    expect(result?.grid.width).toBe(600);
    expect(result?.panels.t).toEqual(source.panels.t);
    expect(JSON.stringify(result)).not.toContain('subagent');
    expect(JSON.stringify(source)).toContain('subagent:c');
  });

  it('preserves unrelated layouts by reference and omits all-transient layouts', () => {
    const ordinary = layout({ changes: { contentComponent: 'changes' } }, [['changes']]);
    const transient = layout({ 'subagent:c': { contentComponent: 'subagent-session' } }, [
      ['subagent:c'],
    ]);
    const result = stripTransientSidePanelLayouts({ ordinary, transient, empty: undefined });
    expect(result.ordinary).toBe(ordinary);
    expect(result.transient).toBeUndefined();
  });

  it('strips by component as well as ID and repairs active group when its leaf disappears', () => {
    const source = layout(
      {
        observer: { contentComponent: 'subagent-directory' },
        files: { contentComponent: 'files' },
      },
      [['observer'], ['files']]
    );
    const result = stripTransientSidePanelLayouts({ p: source }).p;
    expect(result?.activeGroup).toBe('g1');
    expect(result?.grid.root).toMatchObject({
      data: [{ data: { activeView: 'files', views: ['files'] } }],
    });
  });

  it('prunes floating, popout and edge groups while preserving unrelated group geometry', () => {
    const source = layout(
      {
        'subagent:c': { contentComponent: 'subagent-session' },
        files: { contentComponent: 'files' },
        terminal: { contentComponent: 'terminal' },
      },
      [['files']]
    );
    const position = { left: 2, top: 3, width: 400, height: 500 };
    source.floatingGroups = [
      { data: { id: 'floating', views: ['subagent:c'], activeView: 'subagent:c' }, position },
      { data: { id: 'keep', views: ['terminal'], activeView: 'terminal' }, position },
    ];
    source.popoutGroups = [
      {
        data: { id: 'popout', views: ['subagent:c', 'terminal'], activeView: 'subagent:c' },
        position,
      },
    ];
    source.edgeGroups = {
      right: { visible: true, size: 250, group: { id: 'edge', views: ['subagent:c'] } },
    };
    const result = stripTransientSidePanelLayouts({ p: source }).p;
    expect(JSON.stringify(result)).not.toContain('subagent');
    expect(result?.floatingGroups).toEqual([source.floatingGroups[1]]);
    expect(result?.popoutGroups?.[0]).toMatchObject({
      position,
      data: { views: ['terminal'], activeView: 'terminal' },
    });
    expect(result?.edgeGroups?.right).toBeUndefined();
  });

  it('removes observer IDs from nested tab groups without discarding ordinary grouping', () => {
    const source = layout(
      {
        'subagent:c': { contentComponent: 'subagent-session' },
        files: { contentComponent: 'files' },
      },
      [['subagent:c', 'files']]
    );
    source.grid.root = {
      type: 'leaf',
      size: 600,
      data: {
        id: 'g0',
        views: ['subagent:c', 'files'],
        activeView: 'subagent:c',
        tabGroups: [
          {
            id: 'mixed',
            label: 'Work',
            collapsed: false,
            color: 'blue',
            panelIds: ['subagent:c', 'files'],
          },
          { id: 'observer-only', collapsed: false, panelIds: ['subagent:c'] },
        ],
      },
    };
    const result = stripTransientSidePanelLayouts({ p: source }).p;
    expect(JSON.stringify(result)).not.toContain('subagent:c');
    expect(result?.grid.root.data).toMatchObject({
      tabGroups: [{ id: 'mixed', color: 'blue', panelIds: ['files'] }],
    });
  });
});
