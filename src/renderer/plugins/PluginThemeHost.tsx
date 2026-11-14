import { useEffect } from 'react';
import { startPluginThemes } from '@/stores/pluginThemes';

/**
 * 插件主题宿主：只负责按已保存的选择加载插件调色板（light/dark 令牌 + 插件 CSS），
 * 停用/不可用/未选中时清空样式标签即恢复内置配色。
 *
 * 所有跟随应用外观的窗口（主窗口、设置、协作看板、独立设计窗口）都可以直接挂载：
 * 素材槽与背景图规则只认主窗口的 `data-enso` 挂点，所以不会把壁纸或装饰带进这些窗口。
 * 会话活动属性属于主窗口，见 `SessionActivityAttributes`。
 */
export function PluginThemeHost() {
  useEffect(startPluginThemes, []);
  return null;
}
