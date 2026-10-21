import { describe, expect, it } from 'vitest';
import {
  levelRatio,
  levelRatios,
  levelTrackOffset,
  showsThinkingSlider,
  THINKING_SLIDER_THUMB_PX,
} from './thinkingLevelTrack';

describe('levelRatio', () => {
  it('把档位等分到 0..1，首档恒为 0、末档恒为 1', () => {
    expect(levelRatio(0, 5)).toBe(0);
    expect(levelRatio(2, 5)).toBe(0.5);
    expect(levelRatio(4, 5)).toBe(1);
  });

  it('越界下标夹到区间，单档 / 空清单不除零', () => {
    expect(levelRatio(-3, 5)).toBe(0);
    expect(levelRatio(9, 5)).toBe(1);
    expect(levelRatio(0, 1)).toBe(0);
    expect(levelRatio(0, 0)).toBe(0);
    expect(levelRatio(0, Number.NaN)).toBe(0);
  });
});

describe('levelRatios', () => {
  it('逐档给出与 levelRatio 一致的位置', () => {
    expect(levelRatios(5)).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(levelRatios(2)).toEqual([0, 1]);
  });

  it('单档 / 空清单不产生除零位置', () => {
    expect(levelRatios(1)).toEqual([0]);
    expect(levelRatios(0)).toEqual([]);
  });
});

describe('levelTrackOffset', () => {
  it('落点是从容器左边到滑块圆心：首末档各内缩半个滑块', () => {
    const half = THINKING_SLIDER_THUMB_PX / 2;
    const thumb = THINKING_SLIDER_THUMB_PX;
    const travel = `(100% - ${thumb}px)`;
    expect(levelTrackOffset(0, 5)).toBe(`calc(${half}px + ${travel} * 0)`);
    expect(levelTrackOffset(2, 5)).toBe(`calc(${half}px + ${travel} * 0.5)`);
    expect(levelTrackOffset(4, 5)).toBe(`calc(${half}px + ${travel} * 1)`);
  });

  it('起点恒为半个滑块，否则滑块与轨道端头对不上', () => {
    const half = THINKING_SLIDER_THUMB_PX / 2;
    const start = `calc(${half}px + (100% - ${THINKING_SLIDER_THUMB_PX}px) * 0)`;
    expect(levelTrackOffset(-3, 5)).toBe(start);
    expect(levelTrackOffset(0, 1)).toBe(start);
    expect(levelTrackOffset(0, 0)).toBe(start);
  });
});

describe('showsThinkingSlider', () => {
  it('只有一个可用档时不给滑杆（没有可调范围）', () => {
    expect(showsThinkingSlider(0)).toBe(false);
    expect(showsThinkingSlider(1)).toBe(false);
    expect(showsThinkingSlider(2)).toBe(true);
  });
});
