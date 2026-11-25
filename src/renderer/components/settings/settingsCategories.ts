import type { SettingsCategory } from './constants';

/**
 * 工作流分页跟随内置工具开关显隐：功能没开就不该占一个入口。
 *
 * 关掉后仍能重新打开——「内置工具」页会遍历 BUILTIN_TOOLS，开关都在那里，
 * 所以隐藏入口不会造成没法再启用的死锁。
 */

/** 依赖某个内置工具才显示的分页 */
const TOOL_GATED: Partial<Record<SettingsCategory, string>> = {
  workflows: 'workflow',
};

export function isCategoryVisible(
  category: SettingsCategory,
  disabledBuiltinTools: readonly string[]
): boolean {
  const tool = TOOL_GATED[category];
  return !tool || !disabledBuiltinTools.includes(tool);
}

export function visibleCategories<T extends { id: SettingsCategory }>(
  categories: readonly T[],
  disabledBuiltinTools: readonly string[]
): T[] {
  return categories.filter((c) => isCategoryVisible(c.id, disabledBuiltinTools));
}

/**
 * 当前分页被隐藏时该落到哪里。回到「内置工具」而不是「通用」：
 * 用户刚把它关掉（或 deeplink 指向了一个未启用的功能），
 * 落在能重新打开它的地方才合理。
 */
export function resolveActiveCategory(
  active: SettingsCategory,
  disabledBuiltinTools: readonly string[],
  known: readonly SettingsCategory[]
): SettingsCategory {
  // 已退役分页（旧进程 / 热更新送来的 stale category）不在导航集合里，回落通用页
  if (!known.includes(active)) return 'general';
  if (isCategoryVisible(active, disabledBuiltinTools)) return active;
  return 'tools';
}
