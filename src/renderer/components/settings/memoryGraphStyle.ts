import type { GraphEdgeDto, GraphNodeDto } from '@shared/memory/graphDto';
import type cytoscape from 'cytoscape';

/**
 * Wiki 知识图谱（[[wikilink]]）的 Cytoscape 元素与样式。
 * 颜色必须在这里算出十六进制字符串：cytoscape 不认现代 CSS 变量/空格 hsl。
 */

export const NOTE_TYPE_HUES: Record<string, number> = {
  systems: 250,
  domains: 160,
  incidents: 350,
  practices: 140,
  workflows: 205,
  decisions: 35,
  preferences: 285,
  projects: 220,
  people: 330,
  notes: 190,
  note: 190,
};

export function hueFor(noteType: string): number {
  const key = noteType.trim().toLowerCase();
  if (NOTE_TYPE_HUES[key] !== undefined) return NOTE_TYPE_HUES[key];
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 17 + key.charCodeAt(i)) >>> 0;
  return h % 360;
}

const MIN_SIZE = 22;
const MAX_SIZE = 60;

/** 面积随关联度（入链+出链+1）线性增长，所以直径走平方根 */
export function nodeSize(linkCount: number, maxCount: number): number {
  const safeMax = Math.max(1, maxCount);
  const weight = Math.max(1, linkCount + 1);
  if (safeMax <= 1) return MIN_SIZE;
  const t = Math.sqrt(weight) / Math.sqrt(safeMax + 1);
  return Math.round(MIN_SIZE + (MAX_SIZE - MIN_SIZE) * Math.min(1, t));
}

export function toElements(
  nodes: readonly GraphNodeDto[],
  edges: readonly GraphEdgeDto[],
  dark: boolean
): cytoscape.ElementDefinition[] {
  const maxCount = Math.max(1, ...nodes.map((n) => n.linkCount));
  const ids = new Set(nodes.map((n) => n.id));
  return [
    ...nodes.map((n) => ({
      data: {
        id: n.id,
        label: n.title,
        size: nodeSize(n.linkCount, maxCount),
        color: hueToColor(hueFor(n.noteType), dark),
        noteType: n.noteType,
        status: n.status,
        linkCount: n.linkCount,
        spaceLabel: n.spaceLabel,
      },
    })),
    ...edges
      .filter((e) => ids.has(e.source) && ids.has(e.target) && e.source !== e.target)
      .map((e, idx) => ({
        data: {
          id: `${e.source}->${e.target}#${idx}`,
          source: e.source,
          target: e.target,
          label: e.label.replace(/_/g, ' ').toLowerCase(),
          width: 1.5,
        },
      })),
  ];
}

export interface LegendEntry {
  noteType: string;
  color: string;
  count: number;
}

/** 图例：当前图谱里出现的 Wiki 分类 + 配色 + 笔记数，按数量倒序 */
export function buildLegend(nodes: readonly GraphNodeDto[], dark: boolean): LegendEntry[] {
  const counts = new Map<string, number>();
  for (const n of nodes) counts.set(n.noteType, (counts.get(n.noteType) ?? 0) + 1);
  return [...counts.entries()]
    .map(([noteType, count]) => ({
      noteType,
      count,
      color: hueToColor(hueFor(noteType), dark),
    }))
    .sort((a, b) => b.count - a.count || a.noteType.localeCompare(b.noteType));
}

export function graphStylesheet(dark: boolean): cytoscape.StylesheetJson {
  const label = dark ? '#e7e7e9' : '#1c1c1f';
  const line = dark ? '#4b4b52' : '#c9c9d1';
  return [
    {
      selector: 'node',
      style: {
        'background-color': 'data(color)',
        'background-opacity': 0.88,
        width: 'data(size)',
        height: 'data(size)',
        label: 'data(label)',
        'font-size': 11,
        color: label,
        'text-valign': 'bottom',
        'text-margin-y': 4,
        'text-max-width': '130px',
        'text-wrap': 'ellipsis',
        'border-width': 0,
        'transition-property': 'opacity, border-width',
        'transition-duration': 150,
      },
    },
    {
      selector: 'edge',
      style: {
        width: 'data(width)',
        'line-color': line,
        'target-arrow-color': line,
        'target-arrow-shape': 'triangle',
        'arrow-scale': 0.8,
        'curve-style': 'bezier',
        opacity: 0.65,
      },
    },
    { selector: 'edge:selected, edge.highlighted', style: { opacity: 1 } },
    {
      selector: 'node:selected',
      style: { 'border-width': 3, 'border-color': label, 'background-opacity': 1 },
    },
    { selector: '.dimmed', style: { opacity: 0.18, 'text-opacity': 0.25 } },
  ] as unknown as cytoscape.StylesheetJson;
}

export function hueToColor(hue: number, dark: boolean): string {
  return hslToHex(hue, dark ? 0.62 : 0.68, dark ? 0.58 : 0.52);
}

function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x];
  const hex = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}
