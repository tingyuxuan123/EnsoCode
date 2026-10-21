/**
 * 思考档滑杆的纯几何：档位等分到 0..1，填充宽度按当前下标算。
 * 抽出来是因为组件本身不做单测（渲染细节靠真机截图验收），但这些数算错会直接
 * 让滑块指到错误的档位——"看着是高档、实际发的是低档"是最难发现的一类 bug。
 */

/** 每档在轨道上的比例位置；单档返回 [0]，空清单返回 []（不产生除零） */
export function levelRatios(count: number): number[] {
  if (!Number.isFinite(count) || count <= 0) return [];
  if (count === 1) return [0];
  return Array.from({ length: count }, (_, index) => index / (count - 1));
}

/** 填充百分比（0..100）；下标越界夹到区间，单档视为未填充 */
export function levelFillPercent(index: number, count: number): number {
  if (!Number.isFinite(count) || count < 2) return 0;
  const clamped = Math.min(Math.max(index, 0), count - 1);
  return Math.round((clamped / (count - 1)) * 100);
}

/** 只有一个可用档时没有可调范围：禁用滑杆会让人以为能调或坏了，直接不给 */
export function showsThinkingSlider(count: number): boolean {
  return Number.isFinite(count) && count > 1;
}
