import { describe, expect, it } from 'vitest';
import { screenshotPlan } from './screenshot';

const page = { width: 1000, height: 800, scrollX: 0, scrollY: 400, documentWidth: 1000, documentHeight: 100000, deviceScaleFactor: 3 };
describe('截图预算与坐标', () => {
  it('viewport 使用当前滚动偏移；整页缩小到有界像素预算', () => {
    expect(screenshotPlan({}, page).clip).toMatchObject({ x: 0, y: 400, width: 1000, height: 800 });
    const full = screenshotPlan({ fullPage: true }, page);
    expect(full.width * full.height).toBeLessThanOrEqual(8_000_000);
    expect(full.height).toBeLessThanOrEqual(16384);
    expect(full.clip.height).toBe(100000);
  });
  it('区域必须完整位于已加载文档边界，拒绝非有限数与混合选择', () => {
    for (const request of [{ clip: { x: -1, y: 0, width: 1, height: 1 } }, { clip: { x: 0, y: 0, width: Infinity, height: 1 } }, { fullPage: true, ref: 'e1' }, { clip: { x: 999, y: 0, width: 20, height: 1 } }]) expect(() => screenshotPlan(request, page)).toThrow();
    expect(screenshotPlan({ clip: { x: 10, y: 20, width: 100, height: 100 } }, page).clip).toMatchObject({ x: 10, y: 20, width: 100, height: 100 });
  });
});
