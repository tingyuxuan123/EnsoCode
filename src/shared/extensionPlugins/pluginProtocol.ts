import type { SettingsDeepLink } from '../settingsDeepLink';
import { parsePluginInstallUrl } from './installUrl';
export function pluginInstallUrlFromLink(raw: string): string | null {
  try {
    const url = new URL(raw.trim());
    if (
      url.protocol !== 'enso:' ||
      url.hostname !== 'install-plugin' ||
      (url.pathname !== '' && url.pathname !== '/') ||
      url.username ||
      url.password ||
      url.port ||
      url.hash ||
      url.searchParams.getAll('url').length !== 1
    )
      return null;
    const inner = url.searchParams.get('url');
    if (!inner) return null;
    const parsed = parsePluginInstallUrl(inner);
    return parsed.ok ? parsed.url.href : null;
  } catch {
    return null;
  }
}
export function pluginInstallUrlsFromArgv(argv: readonly string[]): string[] {
  return [
    ...new Set(argv.map(pluginInstallUrlFromLink).filter((url): url is string => url !== null)),
  ];
}
export function pluginInstallSettingsLink(url: string): SettingsDeepLink {
  return { category: 'plugins', rowId: 'plugins.enso', pluginInstallUrl: url };
}
export function pluginFocusSettingsLink(pluginId: string): SettingsDeepLink {
  return { category: 'plugins', rowId: 'plugins.enso', pluginId };
}
