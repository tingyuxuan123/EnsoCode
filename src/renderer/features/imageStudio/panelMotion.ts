import type { Transition } from 'framer-motion';
import { sidePanelWidthTransition } from '@/components/sidepanel/sidePanelWidthAnim';

/** 与项目其它动效一致：直接读系统「减少动态」，开启时布局不做补间。 */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

/**
 * 画图页左右分栏直接复用 Code 右侧面板的宽度契约：打开 springStandard、
 * 收起到 0 用无过冲 tween（spring 冲到负值会被浏览器丢弃，卡在末段再突然归零）。
 * 拖动分隔条和系统「减少动态」都要即时跟手，不加补间。
 */
export function imageStudioPanelTransition(input: {
  resizing: boolean;
  reducedMotion: boolean;
  targetW: number;
}): Transition {
  return sidePanelWidthTransition({
    skip: input.resizing || input.reducedMotion,
    cover: false,
    targetW: input.targetW,
  });
}
