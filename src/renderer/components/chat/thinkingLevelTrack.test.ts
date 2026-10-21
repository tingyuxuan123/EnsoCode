import { describe, expect, it } from 'vitest';
import { levelFillPercent, levelRatios, showsThinkingSlider } from './thinkingLevelTrack';

describe('levelRatios', () => {
  it('把档位等分到 0..1，首档恒为 0、末档恒为 1', () => {
    expect(levelRatios(5)).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(levelRatios(2)).toEqual([0, 1]);
  });

  it('单档 / 空清单不产生除零位置', () => {
    expect(levelRatios(1)).toEqual([0]);
    expect(levelRatios(0)).toEqual([]);
  });
});

describe('levelFillPercent', () => {
  it('按当前档在轨道上的位置给填充宽度', () => {
    expect(levelFillPercent(0, 5)).toBe(0);
    expect(levelFillPercent(2, 5)).toBe(50);
    expect(levelFillPercent(4, 5)).toBe(100);
  });

  it('越界下标夹到区间，单档视为未填充', () => {
    expect(levelFillPercent(-3, 5)).toBe(0);
    expect(levelFillPercent(9, 5)).toBe(100);
    expect(levelFillPercent(0, 1)).toBe(0);
    expect(levelFillPercent(0, 0)).toBe(0);
  });
});

describe('showsThinkingSlider', () => {
  it('只有一个可用档时不给滑杆（没有可调范围）', () => {
    expect(showsThinkingSlider(0)).toBe(false);
    expect(showsThinkingSlider(1)).toBe(false);
    expect(showsThinkingSlider(2)).toBe(true);
  });
});
