export interface CollapsibleItemWidth {
  /** 带文字时的宽度 */
  full: number;
  /** 只剩图标时的宽度 */
  compact: number;
}

export interface ToolbarCollapse {
  /** 从最不重要的一项起，只显示图标的项数 */
  compact: number;
  /** 从最不重要的一项起，收进「…」菜单的项数（这些项也计入 compact） */
  overflow: number;
}

/**
 * 工具行逐级收起：先把项目一个一个收成图标，全是图标还放不下，再一个一个收进「…」。
 * items 按收起优先级排列（最不重要的在前）；返回第一个放得下的级别。
 */
export function pickToolbarCollapse(
  items: CollapsibleItemWidth[],
  available: number,
  { gap, moreWidth }: { gap: number; moreWidth: number }
): ToolbarCollapse {
  const count = items.length;
  if (count === 0 || !Number.isFinite(available)) return { compact: 0, overflow: 0 };
  for (let level = 0; level <= count * 2; level++) {
    const compact = Math.min(level, count);
    const overflow = Math.max(0, level - count);
    let width = 0;
    let shown = 0;
    for (let index = overflow; index < count; index++) {
      const item = items[index];
      if (!item) continue;
      width += index < compact ? item.compact : item.full;
      shown += 1;
    }
    if (overflow > 0) {
      width += moreWidth;
      shown += 1;
    }
    width += gap * Math.max(0, shown - 1);
    if (width <= available) return { compact, overflow };
  }
  return { compact: count, overflow: count };
}
