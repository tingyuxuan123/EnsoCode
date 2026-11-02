import { describe, expect, it } from 'vitest';
import { previewPoint, previewSwipe } from './previewViewport';

describe('预览画面坐标', () => {
  const rect = { left: 10, top: 20, width: 400, height: 300 };
  const frame = { width: 800, height: 600 };
  it('按实际图像矩形换算，不把缩放后的屏幕像素发送给电脑', () => {
    expect(previewPoint(210, 170, rect, frame)).toEqual({ x: 400, y: 300 });
    expect(previewPoint(410, 320, rect, frame)).toEqual({ x: 799, y: 599 });
    expect(previewPoint(-1, 170, rect, frame)).toBeNull();
  });
  it('小幅触摸视为点击，滑动按缩放换算滚动并限制单次距离', () => {
    expect(previewSwipe({ x: 100, y: 100 }, { x: 103, y: 105 }, rect, frame)).toBeNull();
    expect(previewSwipe({ x: 100, y: 100 }, { x: 100, y: 50 }, rect, frame)).toEqual({
      deltaX: 0,
      deltaY: 100,
    });
    expect(previewSwipe({ x: 100, y: 100 }, { x: 100, y: -9000 }, rect, frame)).toEqual({
      deltaX: 0,
      deltaY: 2000,
    });
  });
});
