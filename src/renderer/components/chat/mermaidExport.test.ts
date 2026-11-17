import { describe, expect, it, vi } from 'vitest';
import {
  exportMermaidPng,
  MAX_CANVAS_SIDE,
  mermaidExportFileName,
  normalizeSvgMarkup,
  pngExportScale,
  svgViewBoxSize,
} from './mermaidExport';

describe('Mermaid export', () => {
  it('adds namespaces, fixes viewBox dimensions and keeps diagram styling', () => {
    const markup = normalizeSvgMarkup(
      '<svg width="100%" viewBox="-8 -8 316.5 2400" style="max-width:316.5px; background:red"><use xlink:href="#a"/></svg>'
    );
    expect(markup).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(markup).toContain('xmlns:xlink="http://www.w3.org/1999/xlink"');
    expect(markup).toContain('width="316.5"');
    expect(markup).toContain('height="2400"');
    expect(markup).toContain('background:red');
    expect(markup).not.toMatch(/max-width|100%/);
    expect(normalizeSvgMarkup(markup).match(/\sxmlns="/g)).toHaveLength(1);
    expect(normalizeSvgMarkup('invalid')).toBe('invalid');
  });

  it('validates sizes and makes safe filenames independent of preview zoom', () => {
    expect(svgViewBoxSize('<svg viewBox="0,0,120,3000">')).toEqual({ width: 120, height: 3000 });
    for (const box of ['0 0 0 10', '0 0 NaN 10', '0 0 Infinity 10', '0 0 -1 2']) {
      expect(svgViewBoxSize(`<svg viewBox="${box}">`)).toBeNull();
    }
    expect(svgViewBoxSize('<svg width="10">')).toBeNull();
    expect(mermaidExportFileName('svg', new Date(2024, 0, 2, 3, 4, 5))).toBe(
      'mermaid-20240102-030405.svg'
    );
    expect(pngExportScale(400, 600)).toBe(2);
    expect(12000 * (pngExportScale(400, 12000) ?? 0)).toBeLessThanOrEqual(MAX_CANVAS_SIDE);
    expect(pngExportScale(400, MAX_CANVAS_SIDE + 1)).toBeNull();
    for (const width of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(pngExportScale(width, 100)).toBeNull();
    }
  });

  const current = '<svg viewBox="0 0 100 50"><foreignObject/></svg>';
  it('exports PNG at 2x natural dimensions', async () => {
    const rasterize = vi.fn().mockResolvedValue('data:image/png;base64,AAAA');
    const download = vi.fn();
    expect(
      await exportMermaidPng({
        currentSvg: () => current,
        rerender: async () => '<svg viewBox="0 0 300 200"><text>a</text></svg>',
        rasterize,
        download,
      })
    ).toEqual({ kind: 'png' });
    expect(rasterize.mock.calls[0].slice(1)).toEqual([300, 200, 2]);
    expect(download).toHaveBeenCalledWith(
      'data:image/png;base64,AAAA',
      expect.stringMatching(/\.png$/)
    );
  });

  it.each(['render', 'foreignObject', 'too-large', 'draw'])(
    'falls back to SVG on %s failure',
    async (failure) => {
      const rasterize = vi.fn().mockRejectedValue(new Error('canvas failed'));
      const download = vi.fn();
      const result = await exportMermaidPng({
        currentSvg: () => current,
        rerender: async () => {
          if (failure === 'render') throw new Error('render failed');
          if (failure === 'foreignObject') return current;
          return `<svg viewBox="0 0 300 ${failure === 'too-large' ? 20000 : 200}"></svg>`;
        },
        rasterize,
        download,
      });
      expect(result.kind).toBe('svg');
      const [blob, name] = download.mock.calls[0];
      expect(name).toMatch(/\.svg$/);
      expect((blob as Blob).type).toBe('image/svg+xml');
      expect(await (blob as Blob).text()).toContain('foreignObject');
      if (failure !== 'draw') expect(rasterize).not.toHaveBeenCalled();
    }
  );

  it('reports failure if both PNG and fallback are unavailable', async () => {
    expect(
      await exportMermaidPng({
        currentSvg: () => null,
        rerender: async () => {
          throw new Error('render');
        },
        rasterize: vi.fn(),
        download: vi.fn(),
      })
    ).toEqual({ kind: 'failed' });
  });
});
