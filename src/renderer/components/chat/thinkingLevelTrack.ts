/**
 * 思考档滑杆的纯几何：滑块圆心、填充宽度、档位圆点、文字标签共用同一套落点，
 * 才不会出现"标签写着高档、滑块停在低档"这种只在真机上才看得出来的错位。
 * 抽出来是因为组件本身不做单测（观感靠真机截图验收），但这些数算错会直接
 * 让滑块指到错误的档位——"看着是高档、实际发的是低档"是最难发现的一类 bug。
 */

/**
 * 滑块直径（px）。轨道内缩、填充端点、`::-webkit-slider-thumb` 尺寸都按它对齐，
 * 改一处必须同步改组件——这里用 px 而不是 rem，rem 会随根字号缩放，几何就对不上了。
 */
export const THINKING_SLIDER_THUMB_PX = 28;

/** 某档在滑块可走行程上的比例位置（0..1）；越界夹到区间，单档/非法数量恒为 0 */
export function levelRatio(index: number, count: number): number {
  if (!Number.isFinite(count) || count < 2) return 0;
  const clamped = Math.min(Math.max(index, 0), count - 1);
  return clamped / (count - 1);
}

/** 每档在轨道上的比例位置；单档返回 [0]，空清单返回 []（不产生除零） */
export function levelRatios(count: number): number[] {
  if (!Number.isFinite(count) || count <= 0) return [];
  if (count === 1) return [0];
  return Array.from({ length: count }, (_, index) => levelRatio(index, count));
}

/**
 * 档位落点的 CSS 长度：从容器左边缘量到滑块圆心。首末档各内缩半个滑块，
 * 所以首档落在半个滑块处——滑块正好压住轨道圆头，而不是探到轨道外面。
 */
export function levelTrackOffset(index: number, count: number): string {
  const half = THINKING_SLIDER_THUMB_PX / 2;
  const travel = `(100% - ${THINKING_SLIDER_THUMB_PX}px)`;
  return `calc(${half}px + ${travel} * ${levelRatio(index, count)})`;
}

/** 只有一个可用档时没有可调范围：禁用滑杆会让人以为能调或坏了，直接不给 */
export function showsThinkingSlider(count: number): boolean {
  return Number.isFinite(count) && count > 1;
}
