import { useEffect } from 'react';
import { acquireNativeCaptionScrim, releaseNativeCaptionScrim } from '@/lib/nativeCaptionScrim';

/**
 * Hook：`active` 期间按遮罩之后的底色选择 Windows 原生按钮的符号对比色。
 *
 * `color` 必须和浮层实际的遮罩样式一致（如 `bg-black/75` 对应
 * `rgba(0, 0, 0, 0.75)`），否则合成出来的颜色仍然对不上。
 */
export function useNativeCaptionScrim(active: boolean, color: string): void {
  useEffect(() => {
    if (!active) return;
    acquireNativeCaptionScrim(color);
    return () => releaseNativeCaptionScrim(color);
  }, [active, color]);
}
