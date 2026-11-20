import type { GraphEdgeDto, GraphNodeDto } from '@shared/memory/graphDto';
import { describe, expect, it } from 'vitest';
import {
  buildLegend,
  graphStylesheet,
  hueFor,
  hueToColor,
  nodeSize,
  toElements,
} from './memoryGraphStyle';

function node(id: string, linkCount = 1, noteType = 'systems'): GraphNodeDto {
  return {
    id,
    spaceId: 'global',
    spaceLabel: 'Global',
    slug: id,
    title: id,
    noteType,
    status: 'verified',
    linkCount,
    isRaw: false,
    isArchived: false,
  };
}

const edge = (source: string, target: string): GraphEdgeDto => ({
  source,
  target,
  label: 'links_to',
});

describe('nodeSize', () => {
  it('grows with link count and stays bounded', () => {
    expect(nodeSize(0, 1)).toBe(22);
    expect(nodeSize(0, 100)).toBeLessThan(nodeSize(50, 100));
    expect(nodeSize(100, 100)).toBe(60);
    expect(nodeSize(500, 100)).toBe(60);
  });
});

describe('toElements', () => {
  it('drops edges whose endpoints were cut by the node limit and drops self-loops', () => {
    const elements = toElements(
      [node('a'), node('b')],
      [edge('a', 'ghost'), edge('a', 'a'), edge('a', 'b')],
      false
    );
    const edges = elements.filter((el) => 'source' in (el.data as Record<string, unknown>));
    expect(edges).toHaveLength(1);
    expect((edges[0].data as { source: string; target: string }).target).toBe('b');
  });

  it('always produces CSS hex color strings on nodes', () => {
    const elements = toElements(
      [node('small', 0, 'notes'), node('big', 9, 'incidents')],
      [],
      false
    );
    const dataOf = (id: string) => {
      const found = elements.find((el) => (el.data as { id: string }).id === id);
      if (!found) throw new Error(`missing node ${id}`);
      return found.data as { color: unknown; size: number };
    };
    expect(typeof dataOf('big').color).toBe('string');
    expect(dataOf('big').color).toBe(hueToColor(350, false));
    expect(dataOf('small').color).not.toBe(dataOf('big').color);
    expect(dataOf('big').size).toBeGreaterThan(dataOf('small').size);
  });
});

describe('stylesheet contract', () => {
  it('never maps background-color to a numeric field', () => {
    const sheet = graphStylesheet(false) as unknown as { style: Record<string, unknown> }[];
    const nodeStyle = sheet[0].style;
    const elements = toElements([node('a')], [], false);
    const mapped = String(nodeStyle['background-color']);
    const field = /^data\((.+)\)$/.exec(mapped)?.[1];
    if (field) {
      expect(typeof (elements[0].data as Record<string, unknown>)[field]).toBe('string');
    }
  });
});

describe('buildLegend', () => {
  it('lists note types present, most common first, with matching colors', () => {
    const legend = buildLegend(
      [node('a', 1, 'incidents'), node('b', 1, 'systems'), node('c', 1, 'incidents')],
      false
    );
    expect(legend.map((e) => e.noteType)).toEqual(['incidents', 'systems']);
    expect(legend[0].count).toBe(2);
    expect(legend[0].color).toBe(hueToColor(hueFor('incidents'), false));
  });
});
