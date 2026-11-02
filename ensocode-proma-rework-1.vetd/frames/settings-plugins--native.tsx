export const frame = { width: 960, height: 680, title: "设置 · 插件 · 安装预览" };

import { PluginsPage } from '../components/settings/extra/Assets';

/**
 * Enso 原生插件安装预览（ExtensionPluginInstallPreview）：先展开它申请的权限——
 * composer trigger、侧栏视图、工具、宿主 fs / net / MCP——再确认；主进程拥有完整 Node 权限，不是系统沙箱。
 */
export default function Screen() {
  return <PluginsPage dialog="install" />;
}
