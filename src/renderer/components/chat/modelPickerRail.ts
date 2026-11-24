/**
 * 模型选择浮层左侧「条目轨」的纯逻辑：条目 = 一个账号 / 网关，或虚拟模型。
 * 抽出来是因为这几件事都只在真机上才看得出来，算错会直接落到「点了 A 却列出 B 的模型」
 * 或者轨道整列消失：
 * - 打开浮层时该停在哪一条（当前模型所属的那个条目），
 * - 当前条目已经不在列表里（账号被删、设置页还没选模型）时退回哪一个，
 * - 只有一个条目时不画轨道（没有可切换的来源，空列只会让人以为还能切）。
 */

/** 虚拟模型不是 provider，但要和 provider 一样占一个轨道入口。 */
export const VIRTUAL_RAIL_KEY = 'virtual';

/** provider 条目键；前缀是为了不和虚拟模型的键撞车。 */
export function providerRailKey(providerId: string): string {
  return `provider:${providerId}`;
}

/** 打开时停在当前选中模型所属的条目；找不到就退回第一项，空清单返回 undefined。 */
export function pickRailKey(keys: readonly string[], activeProviderId: string): string | undefined {
  if (keys.length === 0) return undefined;
  const wanted =
    activeProviderId === VIRTUAL_RAIL_KEY ? VIRTUAL_RAIL_KEY : providerRailKey(activeProviderId);
  return keys.includes(wanted) ? wanted : keys[0];
}

/** 只有一个条目时不画轨道。 */
export function showsPickerRail(keys: readonly string[]): boolean {
  return keys.length > 1;
}
