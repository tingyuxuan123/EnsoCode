import { describe, expect, it } from 'vitest';
import { parseBrowserViewport, viewportToDip } from './viewport';

describe('parseBrowserViewport', () => {
  it('接受有限的正矩形，取整', () => {
    expect(parseBrowserViewport({ x: 10.4, y: 20.6, width: 300.2, height: 400 })).toEqual({
      x: 10,
      y: 21,
      width: 300,
      height: 400,
    });
  });
  it('拒绝 NaN / 负数 / 超大 / 多余字段 / 非对象', () => {
    expect(parseBrowserViewport(null)).toBeNull();
    expect(parseBrowserViewport({ x: Number.NaN, y: 0, width: 1, height: 1 })).toBeNull();
    expect(parseBrowserViewport({ x: -1, y: 0, width: 1, height: 1 })).toBeNull();
    expect(parseBrowserViewport({ x: 0, y: 0, width: 0, height: 1 })).toBeNull();
    expect(parseBrowserViewport({ x: 0, y: 0, width: 50000, height: 1 })).toBeNull();
    expect(parseBrowserViewport({ x: 0, y: 0, width: 1, height: 1, z: 1 })).toBeNull();
  });
});

describe('viewportToDip', () => {
  it.each([0.8, 1.25, 1.5, 2])('按四边换算为原生 DIP，缩放 %s', (zoom) => {
    const rect = { x: 301, y: 45, width: 511, height: 653 };
    expect(viewportToDip(rect, zoom)).toEqual({
      x: Math.round(rect.x * zoom),
      y: Math.round(rect.y * zoom),
      width: Math.round((rect.x + rect.width) * zoom) - Math.round(rect.x * zoom),
      height: Math.round((rect.y + rect.height) * zoom) - Math.round(rect.y * zoom),
    });
    expect(rect).toEqual({ x: 301, y: 45, width: 511, height: 653 });
  });

  it('相邻矩形换算后共用同一条边，不能各自取整留缝', () => {
    const left = viewportToDip({ x: 1, y: 1, width: 1, height: 3 }, 1.5);
    const right = viewportToDip({ x: 2, y: 1, width: 2, height: 3 }, 1.5);
    expect(left).toEqual({ x: 2, y: 2, width: 1, height: 4 });
    expect(right?.x).toBe((left?.x ?? 0) + (left?.width ?? 0));
  });

  it('隐藏视图与 100% 缩放保留语义，极小有效尺寸不变成零', () => {
    const rect = { x: 1, y: 1, width: 1, height: 1 };
    expect(viewportToDip(null, 1.5)).toBeNull();
    expect(viewportToDip(rect, 1)).toEqual(rect);
    expect(viewportToDip(rect, 0.25)).toEqual({ x: 0, y: 0, width: 1, height: 1 });
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_VALUE])(
    '无效缩放不生成错误的原生矩形：%s',
    (zoom) => {
      expect(viewportToDip({ x: 1, y: 1, width: 400, height: 300 }, zoom)).toBeNull();
    }
  );
});
