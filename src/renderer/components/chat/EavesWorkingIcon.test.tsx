import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EavesWorkingIcon } from './EavesWorkingIcon';

const render = () => renderToStaticMarkup(createElement(EavesWorkingIcon));

describe('EavesWorkingIcon', () => {
  it('renders an accessible 22px Eaves mark without changing the footer footprint', () => {
    const html = render();
    expect(html).toContain('<svg');
    expect(html).toContain('viewBox="0 0 100 100"');
    expect(html).toContain('role="img"');
    expect(html).toMatch(/aria-label="[^"]+"/);
    expect(html).toContain('size-[calc(22rem/14)] shrink-0');
    expect(html).toContain('d="M10 22 Q14 31 25 32 L75 32 Q86 31 90 22"');
    expect(html).not.toContain('animate-ping');
  });

  it('keeps the eave still and animates two current-color rain strands and one brand drop', () => {
    const html = render();
    const paths = html.match(/<path\b[^>]*>/g) ?? [];
    expect(paths).toHaveLength(3);
    expect(paths[0]).not.toContain('animate-');
    expect(paths[1]).toContain('animate-eaves-rain-left');
    expect(paths[1]).toContain('d="M28 30 V100"');
    expect(paths[2]).toContain('animate-eaves-rain-right');
    expect(paths[2]).toContain('d="M72 30 V100"');
    expect(html).toContain('stroke="currentColor"');
    const drops = html.match(/<circle\b[^>]*>/g) ?? [];
    expect(drops).toHaveLength(1);
    expect(drops[0]).toContain('fill-brand');
    expect(drops[0]).toContain('animate-eaves-drop');
    expect(drops[0]).toContain('cy="66"');
  });

  it('disables all three animations for reduced motion, leaving a visible static drop', () => {
    const html = render();
    expect(html.match(/motion-reduce:animate-none/g)).toHaveLength(3);
    const drop = html.match(/<circle\b[^>]*>/)?.[0];
    expect(drop).not.toMatch(/opacity="0"|scale\(0\)/);
  });
});
