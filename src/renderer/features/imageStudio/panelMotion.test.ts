// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import { easeOutLayout, springStandard } from '@/lib/motion';
import { imageStudioPanelTransition, prefersReducedMotion } from './panelMotion';

describe('prefersReducedMotion', () => {
  it('跟随系统减少动态开关', () => {
    const media = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: query.includes('prefers-reduced-motion'),
    })) as unknown as typeof window.matchMedia;
    try {
      expect(prefersReducedMotion()).toBe(true);
    } finally {
      window.matchMedia = media;
    }
    expect(prefersReducedMotion()).toBe(false);
  });
});

describe('imageStudioPanelTransition', () => {
  it('展开沿用 Code 分栏同一条 spring', () => {
    expect(
      imageStudioPanelTransition({ resizing: false, reducedMotion: false, targetW: 296 })
    ).toBe(springStandard);
  });

  it('拖动分隔条时不给宽度加缓动，必须即时跟手', () => {
    expect(
      imageStudioPanelTransition({ resizing: true, reducedMotion: false, targetW: 296 })
    ).toEqual({ duration: 0 });
  });

  it('系统减少动态时立即落位，不做布局动画', () => {
    expect(
      imageStudioPanelTransition({ resizing: false, reducedMotion: true, targetW: 296 })
    ).toEqual({ duration: 0 });
    expect(
      imageStudioPanelTransition({ resizing: false, reducedMotion: true, targetW: 0 })
    ).toEqual({
      duration: 0,
    });
  });

  it('收起到 0 用无过冲 tween：spring 冲到负值会卡在末段', () => {
    expect(imageStudioPanelTransition({ resizing: false, reducedMotion: false, targetW: 0 })).toBe(
      easeOutLayout
    );
  });
});
