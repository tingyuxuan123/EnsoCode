import { readFileSync } from 'node:fs';
import { compile } from 'tailwindcss';
import { describe, expect, it } from 'vitest';

describe('empty-state reveal layout', () => {
  it('keeps the project breadcrumb in a horizontal flex row', async () => {
    const source = readFileSync(new URL('./globals.css', import.meta.url), 'utf8');
    const css = (
      await compile(
        `${source.replace(/^@import.*$/gm, '')}\n@layer utilities { @tailwind utilities; }`
      )
    ).build(['flex']);
    const utilityDisplay = /\.flex\s*\{[^}]*display:\s*([^;]+);/.exec(css)?.[1];
    // Unlayered reveal styles outrank the layered layout utility, regardless of source order.
    const revealDisplay = [...css.matchAll(/\.t-stagger-line\s*\{([^}]+)\}/g)]
      .map((match) => /(?:^|;)\s*display:\s*([^;]+);/.exec(match[1])?.[1])
      .findLast((value) => value !== undefined);
    expect(revealDisplay ?? utilityDisplay).toBe('flex');
  });
});
