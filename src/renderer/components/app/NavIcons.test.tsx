import { parseHTML } from 'linkedom';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CodeWorkspaceIcon, DesignGalleryIcon, ExtensionsIcon, ImageStudioIcon } from './NavIcons';

function renderSvg(element: React.ReactElement) {
  const html = renderToStaticMarkup(element);
  return parseHTML(html).document.querySelector('svg');
}

describe('NavIcons', () => {
  it('renders bespoke non-interactive SVGs with unified viewBox and custom className', () => {
    const cases = [
      { Comp: CodeWorkspaceIcon, attr: 'data-rail-glyph', glyph: 'code' },
      { Comp: ImageStudioIcon, attr: 'data-rail-glyph', glyph: 'images' },
      { Comp: DesignGalleryIcon, attr: 'data-rail-glyph', glyph: 'design' },
      { Comp: ExtensionsIcon, attr: 'data-nav-glyph', glyph: 'extensions' },
    ] as const;

    for (const { Comp, attr, glyph } of cases) {
      const svg = renderSvg(createElement(Comp, { className: 'size-[19px]' }));
      expect(svg, glyph).not.toBeNull();
      expect(svg?.getAttribute('aria-hidden')).toBe('true');
      expect(svg?.getAttribute('viewBox')).toBe('0 0 24 24');
      expect(svg?.getAttribute(attr)).toBe(glyph);
      expect(svg?.getAttribute('class')).toContain('size-[19px]');
      expect(svg?.getAttribute('class')).not.toContain('lucide-');
    }
  });

  it('adds subtle duotone fill layers only when active on enclosed icons', () => {
    const idleImage = renderSvg(createElement(ImageStudioIcon, { active: false }));
    const activeImage = renderSvg(createElement(ImageStudioIcon, { active: true }));
    expect(idleImage?.querySelector('[data-active-fill]')).toBeNull();
    expect(activeImage?.querySelector('rect[data-active-fill]')).not.toBeNull();
    // 开放式边框路径必须保持无填充，避免未闭合路径产生斜角填充条纹
    for (const path of Array.from(activeImage?.querySelectorAll('path') ?? [])) {
      if (!path.hasAttribute('data-spark')) {
        expect(path.getAttribute('fill')).not.toBe('currentColor');
      }
    }

    const idleDesign = renderSvg(createElement(DesignGalleryIcon, { active: false }));
    const activeDesign = renderSvg(createElement(DesignGalleryIcon, { active: true }));
    expect(idleDesign?.querySelector('[data-active-fill]')).toBeNull();
    expect(activeDesign?.querySelector('circle[data-active-fill]')).not.toBeNull();

    const idleExt = renderSvg(createElement(ExtensionsIcon, { active: false }));
    const activeExt = renderSvg(createElement(ExtensionsIcon, { active: true }));
    expect(idleExt?.querySelector('[data-active-fill]')).toBeNull();
    expect(activeExt?.querySelector('rect[data-active-fill]')).not.toBeNull();
  });
});
