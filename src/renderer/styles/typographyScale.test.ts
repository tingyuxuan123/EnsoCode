import { readFileSync } from 'node:fs';
import { compile } from 'tailwindcss';
import { describe, expect, it } from 'vitest';

const components = [
  'chat/Composer',
  'chat/TimelineRow',
  'chat/Sidebar',
  'settings/SettingsContent',
  'settings/GeneralSettings',
  'ui/button',
  'ui/input',
];

function atRootSize(value: string, rootSize: number): number {
  const relative = /^calc\(([\d.]+)rem\s*\/\s*14\)$/.exec(value.trim());
  if (relative) return (Number(relative[1]) * rootSize) / 14;
  const fixed = /^([\d.]+)px$/.exec(value.trim());
  if (fixed) return Number(fixed[1]);
  const rem = /^([\d.]+)rem$/.exec(value.trim());
  if (rem) return Number(rem[1]) * rootSize;
  throw new Error(`Unexpected typography value: ${value}`);
}

describe('UI refresh preserves the configured interface font size', () => {
  it.each(components)(
    '%s typography scales with the root rather than freezing at design pixels',
    async (name) => {
      const source = readFileSync(new URL(`../components/${name}.tsx`, import.meta.url), 'utf8');
      const candidates = [
        ...source.matchAll(/(?:text|leading)-\[(?:calc\([\d.]+rem\/14\)|[\d.]+px)\]/g),
      ].map((match) => match[0]);
      expect(candidates.length).toBeGreaterThan(0);
      const css = (await compile('@tailwind utilities;')).build(candidates);
      const values = [...css.matchAll(/(?:font-size|line-height):\s*([^;]+);/g)].map(
        (match) => match[1]
      );
      expect(values.length).toBeGreaterThan(0);
      for (const value of values) {
        expect(atRootSize(value, 20)).toBeCloseTo((atRootSize(value, 14) * 20) / 14);
        expect(atRootSize(value, 32)).toBeCloseTo((atRootSize(value, 14) * 32) / 14);
      }
    }
  );

  it('keeps the checked switch thumb within the scaled track', async () => {
    const source = readFileSync(new URL('../components/ui/switch.tsx', import.meta.url), 'utf8');
    const candidates = [
      ...source.matchAll(/(?:w|h|size|px|data-checked:translate-x)-\[[^\]]+\]/g),
    ].map((match) => match[0]);
    const property = async (name: string, prefix: string) => {
      const css = (await compile('@tailwind utilities;')).build(
        candidates.filter((candidate) => candidate.startsWith(prefix))
      );
      const match = new RegExp(`(?:^|[;{\\n])\\s*${name}:\\s*([^;]+);`).exec(css);
      expect(match, `Missing ${name}`).not.toBeNull();
      return match?.[1] ?? '';
    };
    for (const rootSize of [14, 20, 32]) {
      const width = atRootSize(await property('width', 'w-'), rootSize);
      const padding = atRootSize(await property('padding-inline', 'px-'), rootSize);
      const thumb = atRootSize(await property('height', 'size-'), rootSize);
      const travel = atRootSize(await property('--tw-translate-x', 'data-checked:'), rootSize);
      expect(padding + travel + thumb).toBeCloseTo(width - padding);
    }
  });

  it('reserves a full scaled icon column before select option text', async () => {
    const source = readFileSync(new URL('../components/ui/select.tsx', import.meta.url), 'utf8');
    const candidates = [...source.matchAll(/(?:grid-cols|size)-\[[^\]]+\]/g)].map(
      (match) => match[0]
    );
    const css = (await compile('@tailwind utilities;')).build(candidates);
    const column = /grid-template-columns:\s*([^\s;]+)/.exec(css)?.[1];
    const icon = /width:\s*(calc\([^;]+\)|[\d.]+px);/.exec(css)?.[1];
    expect(column).toBeDefined();
    expect(icon).toBeDefined();
    for (const rootSize of [14, 20, 32]) {
      expect(atRootSize(column ?? '', rootSize)).toBeGreaterThanOrEqual(
        atRootSize(icon ?? '', rootSize)
      );
    }
  });
});
